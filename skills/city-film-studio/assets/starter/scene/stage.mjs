import * as THREE from 'three';
import {readDirection,addLandmarks,directedPose} from './direction.mjs';

// The imported rings are east/north metres. Ground north is world -Z.
// Replace this massing shot with the city's authored route and foreground.
export async function buildStage(config) {
  const response = await fetch('./scene/city.json');
  if (!response.ok) throw Error('Prepare scene/city.json with prepare_city.py first.');
  const model = await response.json();
  const direction=await readDirection();
  const replaced=new Set(direction.landmarks.flatMap(s=>s.replaces??[]));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202a49);
  const camera = new THREE.PerspectiveCamera(42, 1, .3, 15000);
  const bounds = new THREE.Box3();
  const anchors = [];
  const walls = [];
  const uvs = [];
  const seeds = [];
  const roofs = [];
  for (const [i, building] of model.buildings.entries()) {
    const rings = building.rings.map(r => r.map(([x,north]) => new THREE.Vector2(x,north)));
    const height = building.height;
    let buildingSeed=2166136261;
    for(const c of String(building.id))buildingSeed=Math.imul(buildingSeed^c.charCodeAt(0),16777619)>>>0;
    if(replaced.has(building.id)){
      for(const p of rings[0])bounds.expandByPoint(new THREE.Vector3(p.x,height,-p.y));
      continue;
    }
    const points = rings.flat();
    for (const tri of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1))) {
      for (const idx of tri) roofs.push(points[idx].x,height,-points[idx].y);
    }
    for (const ring of rings) {
      for (let j=0;j<ring.length;j++) {
        const a=ring[j], b=ring[(j+1)%ring.length], width=a.distanceTo(b);
        for (const [vertex,y,u] of [[a,0,0],[b,0,width],[b,height,width],[a,0,0],[b,height,width],[a,height,0]]) {
          walls.push(vertex.x,y,-vertex.y);
          uvs.push(u,y);
          seeds.push((buildingSeed+j*17)%65521);
        }
        bounds.expandByPoint(new THREE.Vector3(a.x,height,-a.y));
      }
    }
    if (i % Math.max(1,Math.ceil(model.buildings.length/12))===0) {
      const point=rings[0][0];
      anchors.push(new THREE.Vector3(point.x,height,-point.y));
    }
  }
  function mesh(vertices, material) {
    const geom=new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
    const object=new THREE.Mesh(geom,material);
    scene.add(object);
    return geom;
  }
  const wall=mesh(walls,new THREE.ShaderMaterial({
    side:THREE.DoubleSide,
    vertexShader:'attribute float seed; varying vec2 v; flat varying float id; void main(){v=uv;id=seed;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: [
      'varying vec2 v; flat varying float id;',
      'float hash(vec2 p){uvec2 k=uvec2(ivec2(floor(p)));uint h=(k.x*1597334677u)^(k.y*3812015801u);h^=h>>16u;h*=2246822519u;h^=h>>13u;return float(h>>8u)/16777216.;}',
      'void main(){vec2 p=v/vec2(3.05,3.5);vec2 cell=floor(p);vec2 dist=abs(fract(p)-.5);',
      'vec2 edge=max(fwidth(p),vec2(.002));vec2 pane=1.-smoothstep(vec2(.29,.30)-edge,vec2(.29,.30)+edge,dist);',
      'float lit=step(.6,hash(cell+id));float farFade=1.-smoothstep(.25,.70,max(edge.x,edge.y));',
      'vec3 wall=mix(vec3(.037,.052,.082),vec3(.081,.061,.052),hash(vec2(id)));',
      'vec3 lamp=mix(vec3(.44,.29,.15),vec3(.76,.48,.22),hash(cell+id+1.));',
      'gl_FragColor=vec4(wall+lamp*mix(.055,lit*pane.x*pane.y,farFade),1.);}'
    ].join('\n')
  }));
  wall.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  wall.setAttribute('seed',new THREE.Float32BufferAttribute(seeds,1));
  mesh(roofs,new THREE.MeshBasicMaterial({color:0x47536b,side:THREE.DoubleSide}));
  bounds.min.y=0;
  const size=bounds.getSize(new THREE.Vector3()), center=bounds.getCenter(new THREE.Vector3());
  const radius=Math.max(size.x,size.z,40)*.65;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(radius*15,radius*15),new THREE.MeshBasicMaterial({color:0x262d35}));
  ground.rotation.x=-Math.PI/2;ground.position.set(center.x,-.05,center.z);scene.add(ground);
  const look = new THREE.Vector3(center.x,size.y*.15,center.z);
  camera.far=Math.max(3000,radius*12+size.y*4);
  function pose(phase,aspect) {
    const angle=phase*2*Math.PI, distance=radius*1.8;
    camera.aspect=aspect;
    camera.position.set(center.x+Math.cos(angle)*distance,size.y+radius*(.62+.12*Math.sin(angle)),center.z+Math.sin(angle)*distance);
    camera.lookAt(look);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  }
  await addLandmarks(scene,anchors,direction.landmarks);
  return {scene,camera,anchors,pose:direction.shots.length?directedPose(direction.shots,camera,config.loop!==false):pose};
}
