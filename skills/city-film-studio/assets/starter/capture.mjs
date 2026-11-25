import * as THREE from 'three';
import {buildStage} from './scene/stage.mjs';

async function start() {
  const config=await (await fetch('./film.json')).json();
  const query=new URLSearchParams(location.search);
  const capture=query.has('capture');
  const previewScale=Math.min(1,960/Math.max(config.width,config.height));
  const W=Number(query.get('w')||Math.round(config.width*previewScale)), H=Number(query.get('h')||Math.round(config.height*previewScale));
  const render=new THREE.WebGLRenderer({antialias:!capture,alpha:false,powerPreference:'high-performance'});
  render.setSize(W,H,false);
  render.domElement.style.width='min(100vw,'+(100*W/H)+'vh)';
  document.body.append(render.domElement);
  const gl=render.getContext();
  const stage=await buildStage(config);
  const {scene,camera,anchors,pose}=stage;
  if (!render.extensions.has('EXT_color_buffer_float')) throw Error('WebGL 2 floating-point color buffers required.');
  const output=new THREE.WebGLRenderTarget(W,H,{depthBuffer:false});
  const float={type:THREE.HalfFloatType,format:THREE.RGBAFormat};
  const frame=new THREE.WebGLRenderTarget(W,H,float);
  frame.samples=Math.min(Number(query.get('msaa')||0),gl.getParameter(gl.MAX_SAMPLES));
  const sum=new THREE.WebGLRenderTarget(W,H,{...float,depthBuffer:false});
  const screen=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const geometry=new THREE.PlaneGeometry(2,2);
  function pass(uniforms,fragment,blend=THREE.NoBlending) {
    const material=new THREE.ShaderMaterial({uniforms,blending:blend,transparent:blend!==THREE.NoBlending,depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment});
    const group=new THREE.Scene();group.add(new THREE.Mesh(geometry,material));
    return group;
  }
  const weight={value:1};
  const accumulate=pass({tex:{value:frame.texture},weight},'uniform sampler2D tex; uniform float weight; varying vec2 v; void main(){gl_FragColor=vec4(texture2D(tex,v).rgb*weight,1.);}',THREE.AdditiveBlending);
  const resolve=pass({tex:{value:sum.texture},packed:{value:capture}},[
    'uniform sampler2D tex;uniform bool packed;varying vec2 v;',
    'void main(){vec2 uv=packed?vec2(v.x,1.-v.y):v;vec3 a=max(texture2D(tex,uv).rgb,vec3(0.));',
    'vec3 c=clamp(a*(2.51*a+.03)/(a*(2.43*a+.59)+.14),0.,1.);',
    'if(!packed){gl_FragColor=vec4(mix(12.92*c,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c)),1.);return;}',
    'c=mix(4.5*c,1.099*pow(c,vec3(.45))-.099,step(vec3(.018),c));',
    'uvec3 val=uvec3(floor(c*1023.+.5));uint k=(val.r<<20u)|(val.g<<10u)|val.b;',
    'gl_FragColor=vec4(float(k&255u),float((k>>8u)&255u),float((k>>16u)&255u),float((k>>24u)&255u))/255.;}'
  ].join('\n'));
  const pixels=new Uint8Array(W*H*4);
  function setTime(time) {
    const phase=config.loop===false?Math.max(0,Math.min(1,time/Math.max(1,config.frames-1))):((time%config.frames)+config.frames)%config.frames/config.frames;
    pose(phase,W/H);
  }
  function positions(t) {
    setTime(t);return anchors.map(p=>p.clone().project(camera));
  }
  function radical(i,base) {
    let x=0,f=1/base;
    for (;i>0;i=Math.floor(i/base),f/=base) x+=(i%base)*f;
    return x;
  }
  function draw(time,options) {
    const exposure=options.shutter;
    const before=positions(time-exposure/2), after=positions(time+exposure/2);
    let movement=0;
    for(let i=0;i<before.length;i++){
      const a=before[i],b=after[i];
      if(Math.abs(a.z)>1||Math.abs(b.z)>1||Math.abs(a.x)>1.3||Math.abs(a.y)>1.3)continue;
      movement=Math.max(movement,Math.hypot((b.x-a.x)*W/2,(b.y-a.y)*H/2));
    }
    let k=options.samples;
    while(k<options.maxSamples&&movement/k>config.pixelsPerSample) k=Math.min(k*2,options.maxSamples);
    weight.value=1/k;
    render.setRenderTarget(sum);render.setClearColor(0,0);render.clear();
    for(let s=0;s<k;s++) {
      setTime(time+exposure*((s+.5)/k-.5));
      if(k>1){
        const e=camera.projectionMatrix.elements, dx=2*(radical(s+1,2)-.5)/W,dy=2*(radical(s+1,3)-.5)/H;
        for(let c=0;c<4;c++){e[4*c]+=dx*e[4*c+3];e[4*c+1]+=dy*e[4*c+3];}
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
      render.setRenderTarget(frame);render.render(scene,camera);
      render.setRenderTarget(sum);render.autoClear=false;render.render(accumulate,screen);render.autoClear=true;
    }
    render.setRenderTarget(capture?output:null);render.render(resolve,screen);
    return k;
  }
  if(capture) {
    window.cityFrame=async(index,opts)=>{
      const k=draw(index,opts);
      render.readRenderTargetPixels(output,0,0,W,H,pixels);
      if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('Frame readback failed.');
      const result=await fetch('/frame/'+index,{method:'POST',body:pixels});
      if(!result.ok)throw Error('Encoder rejected frame '+index);
      return k;
    };
  }else{
    const epoch=performance.now();
    function play(now){draw((now-epoch)*config.fps/1000,{samples:1,maxSamples:1,shutter:0});requestAnimationFrame(play);}
    requestAnimationFrame(play);
  }
}
start().catch(e=>{window.cityError=e.message;document.querySelector('#error').textContent=e.message;console.error(e);});
