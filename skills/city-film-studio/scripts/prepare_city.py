"""Convert a local WGS84 building footprint layer to editable, metre-scale rings."""
import argparse
import json
import math
from collections import Counter
from pathlib import Path


def positive(value):
    try:
        n = float(value)
        return n if math.isfinite(n) and n > 0 else None
    except (ValueError, TypeError):
        return None


def convert(data, args):
    lon, lat = args.origin
    if not -180 <= lon <= 180 or not -85 < lat < 85:
        raise ValueError('Supply longitude, latitude in degrees for a local urban district.')
    north = math.pi * 6371008.8 / 180
    east = north * math.cos(math.radians(lat))
    def ring(points):
        result = []
        for p in points:
            x, y = p[:2]
            if not (-180 <= x <= 180 and -90 <= y <= 90):
                raise ValueError('Expected WGS84 degrees. Reproject the input layer first.')
            delta = (x - lon + 180) % 360 - 180
            pt = [round(delta * east, 2), round((y-lat) * north, 2)]
            if max(map(abs, pt)) > 40000:
                raise ValueError('Clip the layer to a local district around the specified origin.')
            if not result or result[-1] != pt:
                result.append(pt)
        if len(result) > 1 and result[0] == result[-1]:
            result.pop()
        if len(set(map(tuple,result))) < 3:
            return []
        area2 = sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(result,result[1:]+result[:1]))
        return result if abs(area2) > 0.01 else []
    buildings = []
    skips = Counter()
    for i, feature in enumerate(data['features']):
        geom = feature.get('geometry') or {}
        kind = geom.get('type')
        if kind not in ('Polygon', 'MultiPolygon'):
            skips['nonpolygon'] += 1
            continue
        props = feature.get('properties') or {}
        value = positive(props.get(args.height_field))
        floors = positive(props.get(args.levels_field))
        if value:
            h, basis = value*(0.3048 if args.unit=='ft' else 1), 'source-height'
        elif floors:
            h, basis = floors*args.floor_metres, 'estimated-from-levels'
        elif args.fallback:
            h, basis = args.fallback, 'assumed'
        else:
            skips['no-height'] += 1
            continue
        parts = [geom['coordinates']] if kind=='Polygon' else geom['coordinates']
        for j, polygon in enumerate(parts):
            rings = [ring(r) for r in polygon]
            if not rings or not rings[0]:
                skips['degenerate-exterior'] += 1
                continue
            key = props.get(args.id_field) if args.id_field else feature.get('id')
            buildings.append(dict(id=f'{i if key is None else key}.{j}', height=round(h,3),
                                  basis=basis, rings=[r for r in rings if r]))
    if not buildings:
        raise ValueError(f'No usable footprints. Skipped {dict(skips)}. Check units and fields.')
    return dict(city=args.city, source=args.source, origin=args.origin, axes='east,north; metres',
                counts=dict(Counter(b['basis'] for b in buildings)), skipped=dict(skips), buildings=buildings)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input',type=Path)
    p.add_argument('output',type=Path)
    p.add_argument('--city',required=True)
    p.add_argument('--source',required=True,help='Dataset title, attribution or source URL')
    p.add_argument('--origin',type=float,nargs=2,required=True,metavar=('LON','LAT'))
    p.add_argument('--height-field',default='height')
    p.add_argument('--unit',choices=['m','ft'],default='m',help='Units of the supplied height field')
    p.add_argument('--levels-field',default='building:levels')
    p.add_argument('--floor-metres',type=float,default=3.2)
    p.add_argument('--fallback',type=float,help='Explicit assumed height in metres for features missing both fields')
    p.add_argument('--id-field')
    args=p.parse_args()
    if not positive(args.floor_metres) or (args.fallback is not None and not positive(args.fallback)):
        p.error('Floor height and fallback must be finite positive metres.')
    data=json.loads(args.input.read_text(encoding='utf-8-sig'))
    if data.get('type')!='FeatureCollection':
        p.error('Expected a GeoJSON FeatureCollection containing Polygon or MultiPolygon features.')
    model=convert(data,args)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf8') as f:
        json.dump(model,f,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    print(len(model['buildings']),model['counts'],'skipped',model['skipped'])
