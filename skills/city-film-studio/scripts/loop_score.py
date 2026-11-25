"""Make an exact-duration PCM loop from a recording with a repeating backing phrase."""
import argparse
import os
import subprocess
import struct
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR=48000


def curve(t,first,last):
    return .5-.5*np.cos(np.pi*np.clip((t-first)/(last-first),0,1))


def write_wave(path, audio, loop):
    pcm=np.rint(audio*8388608).clip(-8388608,8388607).astype('<i4')
    packed=pcm.reshape(-1).view(np.uint8).reshape(-1,4)[:,:3].copy()
    with path.open('xb') as dest:
        with wave.open(dest,'wb') as w:
            w.setparams((audio.shape[1],3,SR,len(audio),'NONE','not compressed'))
            w.writeframes(packed.tobytes())
        if loop:
            meta=struct.pack('<15I',0,0,round(1e9/SR),60,0,0,0,1,0,0,0,0,len(audio)-1,0,0)
            dest.seek(0,2);dest.write(b'smpl'+struct.pack('<I',len(meta))+meta)
            size=dest.tell();dest.seek(4);dest.write(struct.pack('<I',size-8))


def render(args):
    import json
    ff=os.environ.get('FFMPEG','ffmpeg');probe=os.environ.get('FFPROBE','ffprobe')
    meta=json.loads(subprocess.check_output([probe,'-v','error','-select_streams','a:0','-show_entries','stream=channels','-of','json',args.recording]))
    channels=meta['streams'][0]['channels']
    if channels not in (1,2):raise ValueError('Choose a mono or stereo mix.')
    data=subprocess.check_output([ff,'-v','error','-i',args.recording,'-map','0:a:0','-ar',str(SR),'-f','f64le','-'])
    x=np.frombuffer(data,'<f8').reshape(-1,channels)
    if args.fps<=0 or args.frames<=0:raise ValueError('FPS and frame count must be positive.')
    total=round(args.frames*SR/args.fps);entry=round(args.entry*SR)
    begin,end=[round(s*SR) for s in args.join]
    margin=round(.032*SR)
    if not (0<begin<end<total and entry+begin-total>margin and entry+end+margin<len(x)):
        raise ValueError('The recording must cover both passages, including the lead-in to the chosen first sample.')
    alignment=[]
    if args.offset_ms is None:
        if not args.hits or len(args.hits)<2:raise ValueError('Provide at least two --hits, or a known --offset-ms.')
        y=signal.sosfiltfilt(signal.butter(3,[1500,7000],fs=SR,btype='bandpass',output='sos'),x.mean(1))
        for t in args.hits:
            i=round(t*SR);length=round(.20*SR)
            if i<margin or i+total+length+margin>len(y):raise ValueError('Hit is outside recording coverage.')
            repeated=y[i+total:i+total+length];base=y[i-margin:i+length+margin]
            power=signal.convolve(base**2,np.ones(length),'valid',method='fft')*np.dot(repeated,repeated)
            corr=signal.correlate(base,repeated,'valid',method='fft')/np.sqrt(np.maximum(power,1e-20))
            j=int(corr.argmax());alignment.append((margin-j,float(corr[j])))
        lag=round(np.median([n for n,_ in alignment]))
        if any(abs(n-lag)>round(SR*.001) or quality<.45 for n,quality in alignment):
            raise ValueError(f'No consistent shared transient at those hits: {alignment}. Select a different phrase or edit the score manually.')
    else:
        lag=round(args.offset_ms/1000*SR)
        if abs(lag)>margin:raise ValueError('Offset must be within 32 ms. Recut the musical phrase for larger differences.')
    # Correct the small grid drift progressively, then use uninterrupted source at the wrap.
    lead=max(0,begin-round(SR*2))
    t=np.arange(end)
    pos=entry+t+lag*curve(t,lead,end)
    if np.any(np.diff(pos)<=0):raise ValueError('Insufficient room for timing correction.')
    def read(indices):
        # Windowed sinc retains high-frequency transients during fractional clock correction.
        near=np.rint(indices).astype(int)
        a=x[near].copy()
        ids=np.flatnonzero(abs(indices-near)>1e-7)
        for block in np.array_split(ids,max(1,len(ids)//2048)):
            u=indices[block,None];j=np.floor(u).astype(int)+np.arange(-19,21)
            if j.size and (j.min()<0 or j.max()>=len(x)):raise ValueError('Source handles too short.')
            delta=u-j;weights=np.sinc(delta)*np.sinc(delta/20)
            a[block]=np.einsum('ij,ijc->ic',weights,x[j])/weights.sum(1)[:,None]
        return a
    old=read(pos)
    new=read(pos[begin:]-(total+lag))
    weight=curve(np.arange(begin,end),begin,end-1)[:,None]
    old[begin:]=old[begin:]*(1-weight)+new*weight
    music=np.concatenate((old,x[entry+end-total:entry]))*10**(args.gain_db/20)
    if len(music)!=total or np.max(abs(music))>=1:raise ValueError('Invalid length or clipped samples; check gain.')
    excerpt=min(4*SR,len(music)//2)
    for path in [args.output,args.audition]:
        if path is not None and (path.exists() or path.suffix.lower()!='.wav'):raise ValueError('Use a new WAV output path.')
    if args.audition and args.output.resolve()==args.audition.resolve():raise ValueError('Choose distinct output paths.')
    write_wave(args.output,music,True)
    if args.audition:write_wave(args.audition,np.concatenate((music[-excerpt:],music[:excerpt])),False)
    print(f'{total} samples/channel, {total/SR:.6f} s, offset {lag} samples; audition wrap at {excerpt/SR:.3f} s')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('recording',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--entry',type=float,required=True,help='First sample time in the original recording, seconds.')
    p.add_argument('--join',type=float,nargs=2,required=True,help='Start and end of the transition on the output timeline.')
    p.add_argument('--frames',type=int,required=True);p.add_argument('--fps',type=int,required=True)
    p.add_argument('--hits',type=float,nargs='+',help='Earlier source times of repeated percussion hits, in seconds.')
    p.add_argument('--offset-ms',type=float,help='Known grid offset, e.g. 0 for an already sample-aligned beat.')
    p.add_argument('--gain-db',type=float,default=0);p.add_argument('--audition',type=Path)
    render(p.parse_args())
