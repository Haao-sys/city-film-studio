"""Package the studio starter, its authored assets, the signed score and offline Three.js preview runtime."""
import argparse
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path


def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else digest_stream(f)


def digest_stream(f):
    result=hashlib.sha256()
    for chunk in iter(lambda:f.read(1048576),b''):result.update(chunk)
    return result.hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('project',type=Path);p.add_argument('bundle',type=Path)
    p.add_argument('--score',type=Path);p.add_argument('--master',type=Path)
    args=p.parse_args()
    root=args.project.resolve(strict=True);dest=args.bundle.resolve()
    if dest.exists() or dest.suffix.lower()!='.zip':p.error('Use a new ZIP output name.')
    if dest.is_relative_to(root/'scene'):p.error('Put the deliverable outside scene/.')
    cfg=json.loads((root/'film.json').read_bytes())
    score=args.score or (root/cfg['score'] if cfg.get('score') else None)
    if args.master:
        from check_film import inspect
        verification=inspect(args.master,cfg,True,score)
        if verification['audio'] and not score:p.error('Supply the approved score for the master with audio.')
    files={n:root/n for n in ('index.html','capture.mjs','render.mjs','check-route.mjs','package.json','package-lock.json')}
    def collect(base):
        for file in sorted(base.iterdir()):
            if file.name.startswith('.') or file.is_symlink() or getattr(file,'is_junction',lambda:False)() or file.resolve()!=file:
                raise ValueError(f'Remove hidden files or replace file links before packaging: {file.name}')
            if file.is_dir():collect(file)
            else:files[file.relative_to(root).as_posix()]=file
    if (root/'scene').resolve()!=root/'scene':p.error('Use a physical scene directory.')
    collect(root/'scene')
    three=root/'node_modules/three'
    files['node_modules/three/LICENSE']=three/'LICENSE'
    files['node_modules/three/build/three.module.js']=three/'build/three.module.js'
    # GLTFLoader can reference further addons selected by the model's extensions.
    # Keep the pinned addon tree, including its codec resources.
    collect(three/'examples/jsm')
    if score:
        cfg['score']='audio/score'+score.suffix.lower()
        files[cfg['score']]=score
    approved={}
    if args.master:approved['video_sha256']=digest(args.master)
    if score:approved['score_sha256']=digest(score)
    dest.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        pending=Path(tmp)/'package.zip'
        with zipfile.ZipFile(pending,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for name,file in files.items():z.write(file,'city-project/'+name)
            z.writestr('city-project/film.json',json.dumps(cfg,ensure_ascii=False,indent=2))
            if approved:z.writestr('city-project/approved.json',json.dumps(approved,indent=2))
            z.writestr('city-project/OPEN.txt',
                        'Offline preview: python -m http.server 8000 --bind 127.0.0.1\nOpen http://127.0.0.1:8000/index.html\n'
                        'Re-render: npm ci, then node node_modules/playwright/cli.js install chromium\n'
                        'Set FFmpeg and ffprobe on PATH, then node render.mjs master new-film.mp4\n')
        with zipfile.ZipFile(pending) as z:
            if z.testzip() is not None:raise ValueError('Archive CRC failed.')
        with pending.open('rb') as src,dest.open('xb') as dst:
            shutil.copyfileobj(src,dst)
    print(dest, dest.stat().st_size)


if __name__=='__main__':
    main()
