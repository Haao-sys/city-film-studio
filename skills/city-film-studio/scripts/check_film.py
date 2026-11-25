"""Verify master media timing; report visual jumps in context of adjacent frames."""
import argparse
import hashlib
import json
import os
import subprocess
from fractions import Fraction
from pathlib import Path

import numpy as np


def inspect(movie, cfg, master, score):
    ff=os.environ.get('FFMPEG','ffmpeg')
    probe=os.environ.get('FFPROBE','ffprobe')
    def metadata(*args):
        return json.loads(subprocess.check_output([probe,'-v','error',*args,'-of','json',movie]))
    streams=metadata('-show_streams')['streams']
    v=next(s for s in streams if s['codec_type']=='video')
    a=next((s for s in streams if s['codec_type']=='audio'),None)
    n,fps=cfg['frames'],cfg['fps']
    duration=Fraction(n,fps)
    if Fraction(v['avg_frame_rate'])!=fps or int(v['nb_frames'])!=n:
        raise ValueError('Frame rate or frame count mismatch.')
    if master and (v['width'],v['height'],v['pix_fmt'],v['color_space'],v['color_primaries'],v['color_transfer'])!=(cfg['width'],cfg['height'],'yuv420p10le','bt709','bt709','bt709'):
        raise ValueError('Master dimensions, bit depth or color metadata differ from the specified profile.')
    ticks=Fraction(v['time_base'])
    pts=sorted(int(p['pts']) for p in metadata('-select_streams','v:0','-show_packets','-show_entries','packet=pts')['packets'])
    if len(pts)!=n or any(t*ticks!=Fraction(i,fps) for i,t in enumerate(pts)):
        raise ValueError('Nonuniform or shifted image timestamps.')
    if a:
        rate=int(a['sample_rate'])
        if int(a['start_pts'])!=0 or abs(int(a['duration_ts'])*Fraction(a['time_base'])-duration)>Fraction(1,rate):
            raise ValueError('Audio timing differs by more than one sample.')
    if score and not a:raise ValueError('Requested score is missing.')
    def pcm(p):
        return np.frombuffer(subprocess.check_output([ff,'-v','error','-i',p,'-map','0:a:0','-ar',str(rate),'-f','f32le','-']),'<f4').astype(float)
    sound={}
    if score:
        expected,actual=pcm(score),pcm(movie)
        length=round(duration*rate)*int(a['channels'])
        if abs(len(expected)-length)>int(a['channels']) or abs(len(actual)-length)>int(a['channels']):
            raise ValueError('Decoded audio sample count or channel layout differs.')
        for name,idx in [('whole',slice(None)),('wrap',np.r_[max(0,length-rate//4):length,0:min(rate//4,length)])]:
            count=min(len(expected),len(actual),length)
            ref=expected[:count];got=actual[:count]
            if not isinstance(idx,slice):idx=idx[idx<count]
            ref=ref[idx];got=got[idx]
            noise=np.linalg.norm(got-ref);signal=np.linalg.norm(ref)
            relative_error=float(noise/max(signal,np.sqrt(len(ref))*1e-5))
            sound[name+'_relative_rms_error']=round(relative_error,5)
            if relative_error>.16:raise ValueError('Encoded audio departs from reference in '+name)
    w,h=160,90
    args=[ff,'-nostdin','-v','error','-xerror','-i',movie,'-map','0:v:0','-vf',f'scale={w}:{h}:flags=area,format=gray','-fps_mode','passthrough','-f','rawvideo','pipe:1']
    deltas=[];unique=set();first=last=None;count=0
    with subprocess.Popen(args,stdout=subprocess.PIPE) as proc:
        while block:=proc.stdout.read(w*h):
            if len(block)!=w*h:raise ValueError('Incomplete decoded frame.')
            frame=np.frombuffer(block,np.uint8).astype(np.int16)
            unique.add(hashlib.sha256(block).digest())
            if last is None:first=frame
            else:deltas.append(float(abs(frame-last).mean()))
            last=frame;count+=1
        if proc.wait() or count!=n:raise ValueError('Full decode failed.')
    peak=sorted(range(len(deltas)),key=deltas.__getitem__,reverse=True)[:4]
    report=dict(frames=n,distinct_thumbnails=len(unique),width=v['width'],height=v['height'],seconds=float(duration),
                audio=bool(a),audio_check=sound,largest_changes_seconds=[round((i+1)/fps,4) for i in peak])
    if cfg.get('loop',True):
        report['wrap_mean_difference']=round(float(abs(last-first).mean()),3)
        report['nearby_mean_difference']=[round(x,3) for x in deltas[-3:]+deltas[:3]]
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('movie',type=Path);p.add_argument('film',type=Path)
    p.add_argument('--master',action='store_true');p.add_argument('--score',type=Path)
    a=p.parse_args()
    print(json.dumps(inspect(a.movie,json.loads(a.film.read_bytes()),a.master,a.score),indent=2))
