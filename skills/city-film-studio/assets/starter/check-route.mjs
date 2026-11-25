import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {directedPose} from './scene/direction.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n)));
const film=read('film.json'), direction=read('scene/direction.json');
if(!direction.shots.length)throw Error('Author shots in scene/direction.json first.');
const replaced=new Set(direction.landmarks.flatMap(m=>m.replaces??[]));
const blocks=read('scene/city.json').buildings.filter(b=>!replaced.has(b.id)).map(b=>{
  let xmin=Infinity,xmax=-Infinity,nmin=Infinity,nmax=-Infinity;
  for(const [x,n] of b.rings[0]){
    xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);nmin=Math.min(nmin,n);nmax=Math.max(nmax,n);
  }
  return {...b,xmin,xmax,nmin,nmax};
});
function inside(x,n,ring){
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [a,b]=ring[j], [c,d]=ring[i];
    if((b>n)!==(d>n)&&x<(c-a)*(n-b)/(d-b)+a)hit=!hit;
  }
  return hit;
}
const camera=new THREE.PerspectiveCamera(42,1,.3,20000);
const pose=directedPose(direction.shots,camera,film.loop!==false);
const spans=[];
let previous;
for(let i=0;i<film.frames;i++){
  const phase=film.loop===false?i/Math.max(1,film.frames-1):i/film.frames;
  pose(phase,film.width/film.height);
  const {x,y,z}=camera.position,n=-z;
  const hit=blocks.find(b=>y>=0&&y<=b.height&&x>=b.xmin&&x<=b.xmax&&n>=b.nmin&&n<=b.nmax
    &&inside(x,n,b.rings[0])&&!b.rings.slice(1).some(r=>inside(x,n,r)));
  if(hit){
    if(previous?.id===hit.id)previous.lastFrame=i;
    else{previous={id:hit.id,basis:hit.basis,firstFrame:i,lastFrame:i};spans.push(previous);}
  }else previous=undefined;
}
console.log(JSON.stringify({sampledCameraFrames:film.frames,footprintIntersections:spans},null,2));
if(spans.length)process.exitCode=2;
