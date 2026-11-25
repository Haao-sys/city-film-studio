import * as THREE from 'three';
import {blendProjection} from './lens.mjs';

export async function readDirection() {
  const r=await fetch(new URL('./direction.json',import.meta.url));
  if(!r.ok)throw Error('Missing scene/direction.json');
  return r.json();
}

export async function addLandmarks(scene,anchors,items) {
  if(!items.length)return;
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const loader=new GLTFLoader();
  scene.add(new THREE.HemisphereLight(0xc9d6ff,0x8a7166,1.5));
  const light=new THREE.DirectionalLight(0xffd2a5,2.3);
  light.position.set(-80,110,55);scene.add(light);
  for(const item of items) {
    const {scene:object}=await loader.loadAsync(new URL(item.file,import.meta.url).href);
    object.position.fromArray(item.position);
    object.scale.setScalar(item.scale??1);
    object.rotation.y=THREE.MathUtils.degToRad(item.yaw??0);
    scene.add(object);object.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(object);
    anchors.push(box.getCenter(new THREE.Vector3()),box.max.clone());
  }
}

// Monotone component tangents avoid overshooting a close façade on the way into a shot.
function tangent(a,b,c,h1,h2) {
  const left=(b-a)/h1,right=(c-b)/h2;
  if(left*right<=0)return 0;
  const w1=2*h2+h1,w2=h2+2*h1;
  return (w1+w2)/(w1/left+w2/right);
}
export function directedPose(shots,camera,loop) {
  if(shots.length<2)throw Error('Supply at least two camera keys, at phases 0 and 1.');
  const knots=shots.map(s=>{
    const v=[...s.eye,...s.look,s.width,s.parallel??0];
    if(v.length!==8||!v.every(Number.isFinite)||!(s.width>0)||v[7]<0||v[7]>1||!Number.isFinite(s.at))throw Error('Invalid shot key.');
    return {t:s.at,v};
  });
  const last=knots.length-1;
  if(knots[0].t!==0||knots[last].t!==1||knots.some((k,i)=>i&&k.t<=knots[i-1].t))throw Error('Shot phases must increase from 0 to 1.');
  if(loop&&knots[0].v.some((x,j)=>x!==knots[last].v[j]))throw Error('Repeat the opening pose at phase 1, or set loop to false in film.json.');
  const slopes=knots.map((k,i)=>k.v.map((x,j)=>{
    if(!loop&&(i===0||i===last))return 0;
    const a=knots[i===0?last-1:i-1],c=knots[i===last?1:i+1];
    const before=i===0?1-a.t:k.t-a.t, after=i===last?c.t:c.t-k.t;
    return tangent(a.v[j],x,c.v[j],before,after);
  }));
  const look=new THREE.Vector3();
  return (phase,aspect)=>{
    let i=0;
    while(i<last-1&&phase>knots[i+1].t)i++;
    const a=knots[i],b=knots[i+1],span=b.t-a.t,t=(phase-a.t)/span,u=1-t;
    const v=a.v.map((x,j)=>(1+2*t)*u*u*x+t*u*u*span*slopes[i][j]+t*t*(3-2*t)*b.v[j]-t*t*u*span*slopes[i+1][j]);
    camera.position.set(...v.slice(0,3));look.set(...v.slice(3,6));camera.aspect=aspect;
    camera.lookAt(look);camera.updateMatrixWorld();
    const distance=camera.position.distanceTo(look);
    blendProjection(camera,distance,v[6],v[7]);
  };
}
