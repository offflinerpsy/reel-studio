#!/usr/bin/env python3
"""Probe/decode an encoded reel, make phone QA frames and package editable source."""
import argparse, hashlib, json, math, re, subprocess, sys, zipfile
from pathlib import Path


def run(args):
    return subprocess.run(args,check=True,capture_output=True,text=True)


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('project',type=Path);ap.add_argument('movie',type=Path);args=ap.parse_args()
    p=args.project.resolve();movie=args.movie if args.movie.is_absolute() else p/args.movie
    build=json.loads((p/'qa/build.json').read_text());qa=p/'qa';frames=qa/'frames';frames.mkdir(exist_ok=True)
    probe=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(movie)]).stdout)
    v=next(s for s in probe['streams'] if s['codec_type']=='video');a=[s for s in probe['streams'] if s['codec_type']=='audio']
    errors=[]
    if (v['width'],v['height'])!=(1080,1920): errors.append('Wrong dimensions')
    if v['codec_name']!='h264': errors.append('Expected H.264')
    num,den=map(int,v['r_frame_rate'].split('/'))
    if abs(num/den-30)>.001: errors.append('Wrong FPS')
    if abs(float(probe['format']['duration'])-build['duration'])>.05: errors.append('Wrong duration')
    spec=json.loads((p/'reel.json').read_text());expected_audio='audio' in spec
    if expected_audio and not a: errors.append('Expected audio stream missing')
    decode=run(['ffmpeg','-v','error','-i',str(movie),'-f','null','-'])
    if decode.stderr.strip(): errors.append('Decode emitted errors')
    (qa/'decode.log').write_text(decode.stderr)
    audio_stats=None
    if a:
        audio=run(['ffmpeg','-hide_banner','-nostats','-i',str(movie),'-af','loudnorm=I=-16:TP=-2:LRA=7:print_format=json','-f','null','-'])
        audio_stats=json.loads(re.findall(r'\{[^{}]*\}',audio.stderr)[-1])
        (qa/'audio.json').write_text(json.dumps(audio_stats,indent=2)+'\n')
        if float(audio_stats['input_tp'])>-.5: errors.append('Decoded audio true peak too high; master/re-encode')
        if float(audio_stats['input_i'])> -10 or float(audio_stats['input_i']) < -23: errors.append('Unexpected program loudness; check original score and final audio mux')
    from PIL import Image,ImageDraw
    cells=[]
    for i,s in enumerate(build['scenes']):
        target=frames/f'{i+1:02d}.jpg'
        run(['ffmpeg','-v','error','-y','-ss',str(s['sample']),'-i',str(movie),'-frames:v','1','-q:v','2',str(target)])
        im=Image.open(target).convert('RGB').resize((270,480));overlay=Image.new('RGBA',im.size,(0,0,0,0));d=ImageDraw.Draw(overlay)
        safe=build['safe'];x=round(safe['x']/4);y=round(safe['y']/4);right=round((safe['x']+safe['width'])/4);bottom=round((safe['y']+safe['height'])/4)
        for box in [(0,0,269,y),(0,bottom,269,479),(0,y,x, bottom),(right,y,269,bottom)]: d.rectangle(box,fill=(234,38,56,65))
        d.rectangle((x,y,right,bottom),outline=(255,255,255,190),width=1)
        tile=Image.new('RGB',(290,518),'#252525');tile.paste(Image.alpha_composite(im.convert('RGBA'),overlay).convert('RGB'),(10,22))
        ImageDraw.Draw(tile).text((10,5),f'{i+1:02d}  {s["sample"]:.2f}s',fill='white');cells.append(tile)
    cols=min(4,len(cells));sheet=Image.new('RGB',(cols*290,math.ceil(len(cells)/cols)*518),'#252525')
    for i,tile in enumerate(cells):sheet.paste(tile,((i%cols)*290,(i//cols)*518))
    sheet.save(qa/'phone-contact-sheet.jpg',quality=90)
    # Only known source/asset paths. Do not sweep credentials, other media, logs or unrelated files.
    include=[p/n for n in ['reel.json','build.py','music.py','verify.py','render.py','review.py','index.html','package.json','hyperframes.json','AGENTS.md']]
    include+=list((p/'assets/runtime').rglob('*'))+list((p/'compositions').glob('*.html'))+[qa/'build.json',qa/'generated.json']
    from build import relative_file
    for scene in spec['scenes']:
        if 'asset' in scene:include.append(relative_file(p,scene['asset']))
    if 'audio' in spec:include.append(relative_file(p,spec['audio']))
    include += [p/'assets/music-provenance.json',p/'assets/image-provenance.json']
    assets=[f for f in include if f.is_file() and not f.is_symlink() and '__pycache__' not in f.parts]
    archive=p/'renders/editable.zip';archive.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(set(assets)):z.write(f,f.relative_to(p))
    with zipfile.ZipFile(archive) as z:
        if z.testzip():errors.append('ZIP CRC failure')
    measured_audio={k:audio_stats[k] for k in ('input_i','input_tp','input_lra','input_thresh')} if audio_stats else None
    receipt=dict(movie=str(movie.resolve()),sha256=sha(movie),bytes=movie.stat().st_size,duration=float(probe['format']['duration']),frames=v.get('nb_frames'),dimensions=[v['width'],v['height']],fps=num/den,audio_measured=measured_audio,decode='failed' if decode.stderr.strip() else 'passed',archive=str(archive),archive_sha256=sha(archive),visual_review='pending',listening_review='not_claimed',errors=errors)
    (qa/'RECEIPT.json').write_text(json.dumps(receipt,indent=2)+'\n');(qa/'ffprobe.json').write_text(json.dumps(probe,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
    if errors:sys.exit(1)


if __name__=='__main__':main()
