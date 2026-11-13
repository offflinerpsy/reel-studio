#!/usr/bin/env python3
"""Render serially, then mux the actual source score with tested AAC settings."""
import argparse, hashlib, json, os, subprocess, uuid
from pathlib import Path


def video_digest(path):
    proc=subprocess.Popen(['ffmpeg','-v','error','-i',str(path),'-map','0:v:0','-c:v','copy','-f','h264','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    h=hashlib.sha256()
    for block in iter(lambda:proc.stdout.read(1024*1024),b''):h.update(block)
    error=proc.stderr.read();code=proc.wait()
    if code:raise RuntimeError(error.decode())
    return h.hexdigest()


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('project',type=Path);ap.add_argument('--output',default='renders/final.mp4');ap.add_argument('--video',help='Accepted existing video for an audio-only revision; skip visual render');ap.add_argument('--fps',type=int,choices=[30],default=30);ap.add_argument('--quality',choices=['high','medium','low'],default='high');ap.add_argument('--workers',type=int,choices=[1],default=1);args=ap.parse_args()
    p=args.project.resolve();target=(p/args.output).resolve()
    if p not in target.parents:ap.error('Output must be inside project')
    if target.exists():ap.error('Output exists; use a new versioned filename')
    spec=json.loads((p/'reel.json').read_text());build=json.loads((p/'qa/build.json').read_text())
    target.parent.mkdir(parents=True,exist_ok=True)
    raw=(p/args.video).resolve() if args.video else target.parent/f'.render-{uuid.uuid4().hex}.mp4'
    env=os.environ.copy()
    if not args.video:
        with (p/'qa/render.log').open('w') as log:
            subprocess.run(['npx','--yes','hyperframes@0.8.36','render','.','--output',str(raw),'--fps','30','--quality',args.quality,'--workers','1'],cwd=p,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    else:
        probe=json.loads(subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(raw)],check=True,capture_output=True,text=True).stdout)
        v=next(s for s in probe['streams'] if s['codec_type']=='video')
        if (v['width'],v['height'])!=(1080,1920) or abs(float(probe['format']['duration'])-build['duration'])>.05:ap.error('Existing video dimensions/duration do not match the brief')
    fingerprint=video_digest(raw)
    if 'audio' in spec:
        from core import relative_file
        audio=relative_file(p,spec['audio'])
        subprocess.run(['ffmpeg','-v','error','-n','-i',str(raw),'-i',str(audio),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','384k','-aac_pns','0','-aac_ms','0','-ar','48000','-ac','2','-af','apad','-t',str(build['duration']),'-movflags','+faststart',str(target)],check=True)
        if video_digest(target)!=fingerprint:raise RuntimeError('Video changed during audio mux; keep intermediates for diagnosis')
        if not args.video:raw.unlink()
    elif args.video:
        import shutil
        shutil.copy2(raw,target)
    else:raw.replace(target)
    (p/'qa/render-receipt.json').write_text(json.dumps(dict(movie=str(target),video_stream_sha256=fingerprint,audio_source=spec.get('audio'),aac={'bitrate':384000,'pns':False,'ms':False} if 'audio' in spec else None),indent=2)+'\n')
    print(f'Rendered {target}; source score muxed without changing video. Run verify.py next.')


if __name__=='__main__':main()
