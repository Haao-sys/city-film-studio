import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';

const root=path.dirname(fileURLToPath(import.meta.url));
const {positionals:[mode,destination],values}=parseArgs({allowPositionals:true,options:{
  cache:{type:'string'},audio:{type:'string'},frame:{type:'string'}
}});
if(!['draft','master','proof'].includes(mode)||!destination)throw Error('node render.mjs draft|master output.mp4 [--audio score.wav] [--cache DIR], or proof output.png --frame N');
const out=path.resolve(destination), proof=mode==='proof', draft=mode==='draft';
if(fs.existsSync(out)||path.extname(out).toLowerCase()!==(proof?'.png':'.mp4'))throw Error('Use a new output filename with the correct extension.');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'film.json')));
for(const key of ['width','height','fps','frames','samples','maxSamples','msaa']){
  if(!Number.isInteger(cfg[key])||cfg[key]<(key==='msaa'?0:1))throw Error('Invalid '+key);
}
if(cfg.maxSamples<cfg.samples||!(cfg.pixelsPerSample>0)||!(cfg.shutter>=0&&cfg.shutter<=1)||cfg.width%2||cfg.height%2)throw Error('Invalid sampling or dimensions.');
const proofFrame=Number(values.frame??0);
if(proof&&(!Number.isInteger(proofFrame)||proofFrame<0||proofFrame>=cfg.frames))throw Error('Proof frame is outside the film.');
const scale=draft?Math.min(1,960/Math.max(cfg.width,cfg.height)):1;
const W=Math.max(2,Math.round(cfg.width*scale/2)*2),H=Math.max(2,Math.round(cfg.height*scale/2)*2);
const opts=draft?{samples:1,maxSamples:1,shutter:0}:{samples:cfg.samples,maxSamples:cfg.maxSamples,shutter:cfg.shutter};
const ff=process.env.FFMPEG||'ffmpeg', pr=process.env.FFPROBE||'ffprobe';
function info(p){
  return JSON.parse(execFileSync(pr,['-v','error','-show_streams','-of','json',p],{windowsHide:true})).streams;
}
const audio=values.audio?path.resolve(values.audio):(cfg.score?path.resolve(root,cfg.score):undefined);
if(audio&&!proof){
  const a=info(audio).find(s=>s.codec_type==='audio');
  if(!a||!(Math.abs(Number(a.duration)-cfg.frames/cfg.fps)<=1/Number(a.sample_rate)+1e-6))throw Error('Supply a score edited to the film duration.');
}
function files(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
    const p=path.join(dir,e.name);
    if(e.isDirectory())return files(p);
    if(!e.isFile())throw Error('Place real project assets in scene/: '+p);
    return [p];
  });
}
const hash=createHash('sha256').update(mode);
for(const name of ['film.json','index.html','capture.mjs','render.mjs','package.json',...(fs.existsSync(path.join(root,'package-lock.json'))?['package-lock.json']:[])]){
  hash.update(name).update(fs.readFileSync(path.join(root,name)));
}
for(const p of files(path.join(root,'scene'))){
  hash.update(path.relative(root,p).split(path.sep).join('/'));
  for await(const block of fs.createReadStream(p))hash.update(block);
}
const cache=path.join(path.resolve(values.cache||path.join(root,'render-cache')),hash.digest('hex').slice(0,24));
fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(path.dirname(out),{recursive:true});
const scratch=fs.mkdtempSync(path.join(cache,'job-'));
let sink,index=-1;
const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.glb':'model/gltf-binary'};
const server=http.createServer(async(req,res)=>{
  try{
    const uri=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method==='POST'&&uri==='/frame/'+index&&sink){
      const parts=[];let count=0;
      for await(const part of req){count+=part.length;if(count>W*H*4)throw Error('Oversized frame');parts.push(part);}
      if(count!==W*H*4)throw Error('Incomplete frame');
      await sink(Buffer.concat(parts,count));res.writeHead(204).end();return;
    }
    if(req.method!=='GET'||!(/^\/(index\.html|capture\.mjs|film\.json)$/.test(uri)||/^\/(scene|node_modules\/three)\//.test(uri))){
      res.writeHead(404).end();return;
    }
    const p=path.resolve(root,'.'+uri);
    if(!p.startsWith(root+path.sep)||!fs.statSync(p).isFile())throw Error('Invalid asset');
    res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream'});
    fs.createReadStream(p).on('error',()=>res.destroy()).pipe(res);
  }catch(e){res.writeHead(400).end(e.message);}
});
const input=['-f','rawvideo','-pixel_format','x2rgb10le','-video_size',W+'x'+H,'-framerate',String(cfg.fps),'-i','pipe:0'];
const color=['-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709'];
const filter='format=gbrp16le,zscale=matrixin=gbr:matrix=709:rangein=full:range=limited:dither=error_diffusion,format=yuv420p10le';
let browser,page,failure;
async function open(){
  browser=await chromium.launch({headless:true,args:['--enable-gpu','--ignore-gpu-blocklist',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
  page=await browser.newPage();
  page.on('pageerror',e=>{failure=e.message;});
  page.on('console',m=>{if(m.type()==='error')failure=m.text();});
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?capture=1&w='+W+'&h='+H+'&msaa='+(draft?0:cfg.msaa),{waitUntil:'commit'});
  await page.waitForFunction(()=>window.cityFrame||window.cityError,null,{timeout:150000});
  const err=await page.evaluate(()=>window.cityError);if(err||failure)throw Error(err||failure);
}
async function capture(i){
  if(!page)await open();index=i;
  await page.evaluate(([n,o])=>window.cityFrame(n,o),[i,opts]);
  if(failure)throw Error(failure);
}
function validReel(p,n){
  if(!fs.existsSync(p))return false;
  try{const [v]=info(p);return Number(v.nb_frames)===n&&v.width===W&&v.height===H&&v.pix_fmt==='yuv420p10le';}
  catch{return false;}
}
async function reel(from,to,p){
  const temp=path.join(scratch,path.basename(p));
  const proc=spawn(ff,['-nostdin','-v','error',...input,'-vf',filter,'-an','-c:v','libx265','-preset',draft?'ultrafast':'medium',
    '-crf',draft?'23':'12','-x265-params','pools=4:frame-threads=2:log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709',
    ...color,'-tag:v','hvc1',temp],{stdio:['pipe','ignore','inherit'],windowsHide:true});
  const ended=once(proc,'close');ended.catch(()=>{});proc.stdin.on('error',()=>{});
  try{
    sink=buf=>new Promise((ok,no)=>proc.stdin.write(buf,err=>err?no(err):ok()));
    for(let i=from;i<to;i++)await capture(i);
    proc.stdin.end();const [code]=await ended;
    if(code!==0||!validReel(temp,to-from))throw Error('Incomplete encoded reel '+from);
    fs.renameSync(temp,p);
  }finally{sink=null;if(proc.exitCode===null)proc.kill();}
}
// Verify the staged file before copying it to a new output name.
const staging=fs.mkdtempSync(path.join(path.dirname(out),'.city-film-'));
const pending=path.join(staging,path.basename(out));
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  if(proof){
    sink=buf=>{execFileSync(ff,['-nostdin','-v','error',...input,'-frames:v','1','-vf','format=gbrp16le,zscale=transferin=709:transfer=iec61966-2-1:primariesin=709:primaries=709:matrixin=gbr:matrix=gbr:rangein=full:range=full,format=rgb48be',pending],{input:buf,windowsHide:true});};
    await capture(proofFrame);
  }else{
    const entries=[];
    for(let i=0;i<cfg.frames;i+=120){
      const j=Math.min(i+120,cfg.frames),name='reel-'+i+'-'+j+'.mp4',p=path.join(cache,name);
      if(!validReel(p,j-i))await reel(i,j,p);
      entries.push("file '"+name+"'");console.log(j+'/'+cfg.frames);
    }
    const listing=path.join(cache,'sequence.ffconcat');
    fs.writeFileSync(listing,'ffconcat version 1.0\n'+entries.join('\n')+'\n');
    execFileSync(ff,['-nostdin','-v','error','-f','concat','-safe','1','-i',listing,...(audio?['-i',audio]:[]),
      '-map','0:v:0',...(audio?['-map','1:a:0','-c:a','aac','-b:a','256k']:['-an']),
      '-c:v','copy',...color,'-tag:v','hvc1','-video_track_timescale',String(cfg.fps*1000),'-movflags','+faststart+write_colr',pending],{windowsHide:true});
    if(!validReel(pending,cfg.frames))throw Error('Final frame count mismatch');
  }
  fs.copyFileSync(pending,out,fs.constants.COPYFILE_EXCL);console.log(out);
}finally{
  await browser?.close();server.close();
  if(fs.existsSync(pending))fs.unlinkSync(pending);
  fs.rmdirSync(staging);
  for(const n of fs.readdirSync(scratch))fs.unlinkSync(path.join(scratch,n));
  fs.rmdirSync(scratch);
}
