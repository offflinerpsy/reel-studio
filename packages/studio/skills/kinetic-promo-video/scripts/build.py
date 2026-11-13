#!/usr/bin/env python3
"""Compile a small creative brief into a self-contained portrait HyperFrames project."""
import argparse
import hashlib
import html
import json
import math
from pathlib import Path
import re
import shutil
import sys

VERSION = '1.0.0'
PALETTES = {
    'acid': dict(ink='#10120f', light='#f4f2e9', accent='#d9ff43', soft='#b8a6ff'),
    'cobalt': dict(ink='#0a1934', light='#f6f2e9', accent='#2557e8', soft='#bdd6f6'),
    'ember': dict(ink='#241810', light='#faf1df', accent='#e65b25', soft='#edc4ad'),
    'editorial': dict(ink='#171717', light='#f2eee5', accent='#f7d632', soft='#cbc7bf'),
}
W, H = 1080, 1920
SAFE = dict(x=106, y=290, width=756, height=950)
FONTS = "@font-face{font-family:Anton;src:url('assets/runtime/Anton.ttf')}@font-face{font-family:Manrope;src:url('assets/runtime/Manrope.ttf');font-weight:200 800}"


def read(path):
    return json.loads(Path(path).read_text())


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')


def fail(message):
    raise ValueError(message)


def relative_file(project, value):
    if not isinstance(value, str) or Path(value).is_absolute():
        fail('Media must have a project-relative file path')
    local = project / value
    if local.is_symlink(): fail('Copy media into the project; symlink media is not portable')
    candidate = local.resolve()
    if project.resolve() not in candidate.parents or not candidate.is_file():
        fail(f'Missing or out-of-project media: {value}')
    return candidate


def luminance(color):
    vals = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    vals = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in vals]
    return sum(a*b for a, b in zip(vals, [.2126, .7152, .0722]))


def contrast(a, b):
    aa, bb = sorted([luminance(a), luminance(b)])
    return (bb + .05) / (aa + .05)


def text_list(value, field, maximum):
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        fail(f'{field} requires 1–{maximum} text lines')
    if any(not isinstance(x, str) or not x.strip() or '\n' in x or len(x) > 90 for x in value):
        fail(f'{field} contains empty, multiline, or excessively long text')
    return [x.strip() for x in value]


def validate(spec, project):
    if not isinstance(spec, dict): fail('Brief must be an object')
    if not isinstance(spec.get('title'), str) or not spec['title'].strip(): fail('title is required')
    if not re.fullmatch(r'[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?', spec.get('language', '')): fail('language must be a language tag')
    bpm = spec.get('bpm')
    if isinstance(bpm, bool) or not isinstance(bpm, (int, float)) or not 90 <= bpm <= 140: fail('bpm must be 90–140')
    palette = spec.get('palette')
    if isinstance(palette, str): palette = PALETTES.get(palette)
    if not isinstance(palette, dict) or set(palette) != {'ink','light','accent','soft'}: fail('Unknown/incomplete palette')
    if any(not isinstance(c,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', c) for c in palette.values()): fail('Palette needs #RRGGBB colors')
    if spec.get('background','tunnel') not in ('tunnel','panels','rings'): fail('Unknown background')
    if spec.get('fonts','auto') not in ('auto','Anton','Manrope'): fail('Unknown font option')
    if not isinstance(spec.get('seed',42),int): fail('seed must be an integer')
    scenes = spec.get('scenes')
    if not isinstance(scenes,list) or not 2 <= len(scenes) <= 30: fail('Use 2–30 scenes')
    duration = 0
    for i,s in enumerate(scenes):
        prefix = f'Scene {i+1}'
        if not isinstance(s,dict): fail(prefix+' must be an object')
        kind = s.get('kind','type')
        if kind not in ('type','stack','cutout','portrait','cta'): fail(prefix+' has unknown kind')
        if isinstance(s.get('beats'),bool) or not isinstance(s.get('beats'),(int,float)) or not 4 <= s['beats'] <= 24: fail(prefix+' beats must be 4–24')
        s['lines'] = text_list(s.get('lines'),prefix+' lines',2 if kind in ('cutout','portrait','cta') else 3)
        if s.get('tone','light') not in palette: fail(prefix+' has unknown tone')
        if s.get('motion','slide') not in ('slide','slam','rise','hinge'): fail(prefix+' has unknown motion')
        if s.get('motif','none') not in ('none','disc','bars','stamp'): fail(prefix+' has unknown motif')
        if 'emphasis' in s and (type(s['emphasis']) is not int or not 0 <= s['emphasis'] < len(s['lines'])): fail(prefix+' emphasis outside lines')
        if kind in ('cutout','portrait'):
            asset = relative_file(project, s.get('asset'))
            if asset.suffix.lower() not in ('.png','.jpg','.jpeg','.webp'): fail(prefix+' asset must be an image')
        if kind == 'cta': s['action'] = text_list(s.get('action'),prefix+' action',2)
        duration += s['beats'] * 60 / bpm
    if not 6 <= duration <= 120: fail('Total duration must be 6–120 seconds')
    if abs(duration*30-round(duration*30)) > .001: fail('Duration must end on a 30 fps frame; adjust beats or BPM')
    if 'audio' in spec: relative_file(project,spec['audio'])
    return palette, duration


def type_geometry(lines, metrics, font_option, width, max_size, max_height, gap=20):
    fonts = ['Anton','Manrope'] if font_option == 'auto' else [font_option]
    font = next((name for name in fonts if all(c in metrics[name]['widths'] for line in lines for c in line)), None)
    if not font: fail('Unsupported glyphs for bundled fonts: '+repr(' / '.join(lines)))
    widths = metrics[font]['widths']
    sizes = [min(max_size, math.floor(width*.94/max(sum(widths[c] for c in line),.01))) for line in lines]
    total = sum(s*1.2 for s in sizes) + gap*(len(lines)-1)
    if total > max_height: sizes = [math.floor(s*(max_height-gap*(len(lines)-1))/(total-gap*(len(lines)-1))) for s in sizes]
    if min(sizes) < 78: fail('Copy too long for phone-safe type: '+repr(' / '.join(lines))+'; rewrite/split it')
    return font, sizes


def scene_html(index, s, spec, palette, metrics):
    sid = f'k-scene-{index+1:02d}'
    kind = s.get('kind','type'); tone = s.get('tone','light'); bg = palette[tone]
    fg = max([palette['ink'],palette['light'],'#000000','#ffffff'],key=lambda c:contrast(c,bg))
    font_option=spec.get('fonts','auto')
    is_media=kind in ('cutout','portrait')
    top=306; maxh=400 if is_media else 470 if kind=='cta' else 850
    gap=55 if kind=='stack' else 14
    font,sizes=type_geometry(s['lines'],metrics,font_option,SAFE['width'],240 if is_media or kind=='cta' else 300,maxh,gap)
    if kind=='stack': top=330
    parts=[];css=[];animations=[];type_info=[]
    y=top; beat=60/spec['bpm']; stagger=min(beat*1.0,(s['beats']*beat-1.25)/max(len(s['lines']),1));motion=s.get('motion','slide')
    for j,(line,size) in enumerate(zip(s['lines'],sizes)):
        ident=f'{sid}-line-{j}'
        ink=palette['accent'] if s.get('emphasis')==j and contrast(palette['accent'],bg)>=4.5 else fg
        parts.append(f'<span id="{ident}" class="word" style="font-size:{size}px;font-family:{font};font-weight:{400 if font=="Anton" else 750};color:{ink}">{html.escape(line)}</span>')
        type_info.append(dict(text=line,font=font,size=size,y=round(y,2)))
        if motion=='slide': initial=dict(x=(-1100 if j%2==0 else 1100),opacity=0)
        elif motion=='slam': initial=dict(scale=1.8,opacity=0,rotation=(-4 if j%2 else 4))
        elif motion=='hinge': initial=dict(rotationX=-75,y=100,opacity=0,transformPerspective=1200)
        else: initial=dict(y=150,opacity=0)
        final=dict(x=0,y=0,scale=1,rotation=0,rotationX=0,opacity=1,duration=min(.65,beat*1.1),ease='power4.out')
        animations.append(f"tl.fromTo('#{ident}',{json.dumps(initial)},{json.dumps(final)},{j*stagger:.4f});")
        y+=size*1.2+gap
    parts=[f'<div class="type-lockup" style="top:{top}px;gap:{gap}px">'+''.join(parts)+'</div>']
    if is_media:
        asset=html.escape(s['asset'],quote=True);alt=html.escape(s.get('alt',''),quote=True)
        ident=sid+'-media'
        if kind=='portrait':
            parts.append(f'<div id="{sid}-back" class="portrait-back" style="background:{fg}"></div>')
            geometry='left:136px;top:675px;width:620px;height:930px;object-position:center top;'
        else: geometry='left:91px;top:746px;width:786px;height:490px;'
        parts.append(f'<img id="{ident}" class="asset" style="{geometry}" src="{asset}" alt="{alt}">')
        at=len(s['lines'])*stagger
        animations.append(f"tl.fromTo('#{ident}',{{y:370,rotation:-12,scale:.75,opacity:0}},{{y:0,rotation:0,scale:1,opacity:1,duration:.7,ease:'power3.out'}},{at:.4f});")
        if kind=='portrait': animations.append(f"tl.fromTo('#{sid}-back',{{scaleY:0,opacity:0}},{{scaleY:1,opacity:.85,duration:.6,ease:'power3.out'}},{at:.4f});")
    if kind=='cta':
        af,asz=type_geometry(s['action'],metrics,font_option,SAFE['width']-76,180,310,10)
        parts.append(f'<div id="{sid}-card" class="action-card" style="background:{fg};color:{bg}">'+''.join(f'<span class="action-word" style="font-family:{af};font-size:{z}px;font-weight:{400 if af=="Anton" else 750}">{html.escape(t)}</span>' for t,z in zip(s['action'],asz))+'</div>')
        animations.append(f"tl.fromTo('#{sid}-card',{{scale:.6,y:120,opacity:0}},{{scale:1,y:0,opacity:1,duration:.65,ease:'power4.out'}},{len(s['lines'])*stagger:.4f});")
        type_info += [dict(text=t,font=af,size=z,action=True) for t,z in zip(s['action'],asz)]
    motif=s.get('motif','none')
    if motif!='none' and not is_media and kind!='cta':
        parts.insert(0,f'<div id="{sid}-motif" class="motif {motif}" style="--ink:{fg}" aria-hidden="true"></div>')
        animations.append(f"tl.fromTo('#{sid}-motif',{{rotation:-25,scale:.6}},{{rotation:15,scale:1,duration:{s['beats']*beat:.4f},ease:'none'}},0);")
    # No broad layout exemptions. The auditor must catch actual collisions.
    common=FONTS+f'''#root{{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden;color:{fg}}}
    .type-lockup{{position:absolute;left:106px;width:756px;display:flex;flex-direction:column;align-items:flex-start}}
    .word{{position:relative;display:block;white-space:nowrap;font-weight:{'400' if font=='Anton' else '750'};line-height:1.2;transform-origin:left center;letter-spacing:0}}
    .asset{{position:absolute;display:block;object-fit:contain;transform-origin:center}}
    .portrait-back{{position:absolute;left:106px;top:1090px;width:756px;height:640px;transform-origin:bottom}}
    .action-card{{position:absolute;left:106px;top:862px;width:756px;height:372px;padding:29px 38px;display:flex;flex-direction:column;justify-content:center;gap:10px;box-sizing:border-box;transform-origin:center}}
    .action-word{{display:block;white-space:nowrap;line-height:1.2;font-weight:400}}
    .motif{{position:absolute;left:140px;top:1320px;width:650px;height:650px;opacity:.16;transform-origin:center}}
    .disc{{border:100px solid var(--ink);border-radius:50%}}
    .bars{{background:repeating-linear-gradient(90deg,var(--ink) 0 40px,transparent 40px 80px)}}
    .stamp{{border:50px solid var(--ink);outline:20px solid var(--ink);outline-offset:35px}}
    '''
    doc=f'''<!doctype html><html lang="{spec['language']}"><head><meta charset="UTF-8"></head><body><template><style>{common}</style><div id="root" data-composition-id="{sid}" data-width="1080" data-height="1920">{''.join(parts)}</div><script>window.__timelines=window.__timelines||{{}};const tl=gsap.timeline({{paused:true}});{''.join(animations)}window.__timelines['{sid}']=tl;</script></template></body></html>'''
    return doc,dict(id=sid,kind=kind,bg=bg,fg=fg,type=type_info)


def initialize(project):
    skill=Path(__file__).resolve().parent.parent
    if not (skill/'SKILL.md').is_file(): fail('init is available from the installed skill, not a generated project')
    if project.exists() and any(project.iterdir()): fail('init requires a new/empty folder')
    project.mkdir(parents=True,exist_ok=True)
    shutil.copytree(skill/'assets/runtime',project/'assets/runtime')
    for name in ('build.py','music.py','verify.py','render.py','review.py'): shutil.copy2(skill/'scripts'/name,project/name)
    shutil.copy2(skill/'assets/example-reel.json',project/'reel.json')
    write_json(project/'package.json',dict(name='kinetic-promo',private=True,type='module',dependencies={'gsap':'3.14.2'},scripts=dict(prepare_runtime="node -e \"require('fs').copyFileSync('node_modules/gsap/dist/gsap.min.js','assets/runtime/gsap.min.js')\"",check='npx --yes hyperframes@0.8.36 check',render='python3 render.py .',preview='npx --yes hyperframes@0.8.36 preview --background --no-open')))
    package=read(project/'package.json'); package['scripts']['prepare-runtime']=package['scripts'].pop('prepare_runtime'); write_json(project/'package.json',package)
    write_json(project/'hyperframes.json',{'$schema':'https://hyperframes.heygen.com/schema/hyperframes.json','paths':{'blocks':'compositions','components':'compositions/components','assets':'assets'},'authoringSkill':'kinetic-promo-video'})
    (project/'AGENTS.md').write_text('''# Kinetic promo project\nEdit reel.json, then run python3 build.py . Generated HTML is overwritten only when its previous hash still matches. Preserve custom edits by copying/versioning before rebuilding. Use the kinetic-promo-video skill for the brief and creative work. For custom HTML use installed HyperFrames core/animation guidance. Run npm run check after composition edits; check/snapshot/render serially. Inspect actual encoded frames and phone-safe CTA. Never claim script checks prove taste, independent listening, or publication.\n''')
    print(f'Initialized {project}; replace example reel.json, then run python3 build.py .')


def build(project):
    spec=read(project/'reel.json');palette,duration=validate(spec,project)
    metrics=read(project/'assets/runtime/font-metrics.json')
    qa=project/'qa';qa.mkdir(exist_ok=True);(project/'compositions').mkdir(exist_ok=True);(project/'renders').mkdir(exist_ok=True)
    previous=read(qa/'generated.json') if (qa/'generated.json').exists() else {}
    if not isinstance(previous,dict) or any(not re.fullmatch(r'(?:index\.html|compositions/scene-\d{2}\.html)',rel) for rel in previous): fail('Invalid generated-file manifest; no source changed')
    for rel,digest in previous.items():
        p=project/rel
        if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()!=digest: fail(f'Custom edits detected in {rel}; preserve/version them before rebuild')
    outputs={};scene_data=[];start=0
    for i,s in enumerate(spec['scenes']):
        doc,data=scene_html(i,s,spec,palette,metrics);d=s['beats']*60/spec['bpm'];src=f'compositions/scene-{i+1:02d}.html'
        outputs[src]=doc;data.update(src=src,start=round(start,6),duration=round(d,6),sample=round(start+d*.7,3));scene_data.append(data);start+=d
    slots=''.join(f'<div class="clip" id="slot-{i}" data-composition-id="{s["id"]}" data-composition-src="{s["src"]}" data-start="{s["start"]}" data-duration="{s["duration"]}" data-track-index="2" data-width="1080" data-height="1920"></div>' for i,s in enumerate(scene_data))
    audio=f'<audio id="score" src="{html.escape(spec["audio"],quote=True)}" data-start="0" data-duration="{duration}" data-track-index="4" data-volume="1"></audio>' if 'audio' in spec else ''
    safe_json=lambda x: json.dumps(x,ensure_ascii=False).replace('<','\\u003c')
    root=f'''<!doctype html><html lang="{spec['language']}" data-resolution="portrait"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,height=1920"><title>{html.escape(spec['title'])}</title><script src="assets/runtime/gsap.min.js"></script><style>*{{box-sizing:border-box}}html,body{{margin:0;width:1080px;height:1920px;overflow:hidden;background:{scene_data[0]['bg']}}}#root,.clip{{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden}}#world{{position:absolute;inset:0;width:1080px;height:1920px}}.clip{{z-index:2}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="{duration}" data-width="1080" data-height="1920"><canvas id="world" width="1080" height="1920"></canvas>{slots}{audio}</div><script>window.__timelines=window.__timelines||{{}};window.__reelScenes={safe_json(scene_data)};window.__reelStyle={safe_json(spec.get('background','tunnel'))};window.__reelDuration={duration};const clock={{t:0}},tl=gsap.timeline({{paused:true}});tl.to(clock,{{t:{duration},duration:{duration},ease:'none',onUpdate:()=>{{window.__worldTime=clock.t;if(window.renderWorld)window.renderWorld(clock.t)}}}},0);window.__timelines.main=tl;</script><script type="module" src="assets/runtime/world.js"></script></body></html>'''
    outputs['index.html']=root
    # Validate everything before mutating generated source, and preserve untracked files.
    for rel in outputs:
        if (project/rel).exists() and rel not in previous: fail(f'Refusing to overwrite untracked {rel}')
    for rel in previous:
        if rel not in outputs and (project/rel).exists(): (project/rel).unlink()
    for rel,source in outputs.items(): (project/rel).write_text(source)
    write_json(qa/'generated.json',{rel:hashlib.sha256((project/rel).read_bytes()).hexdigest() for rel in outputs})
    receipt=dict(builder_version=VERSION,title=spec['title'],duration=round(duration,6),fps=30,width=W,height=H,bpm=spec['bpm'],safe=SAFE,scenes=scene_data,visual_review='pending')
    write_json(qa/'build.json',receipt)
    print(json.dumps(dict(title=spec['title'],duration=receipt['duration'],scenes=len(scene_data),minimum_type_px=min(t['size'] for s in scene_data for t in s['type']),snapshots=','.join(str(s['sample']) for s in scene_data)),ensure_ascii=False))


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('target',help='Project folder, or init');ap.add_argument('new_project',nargs='?');args=ap.parse_args()
    if args.target=='init':
        if not args.new_project: ap.error('init needs a new project path')
        initialize(Path(args.new_project).expanduser().resolve())
    elif args.new_project: ap.error('Unexpected second path')
    else: build(Path(args.target).expanduser().resolve())


if __name__=='__main__':
    try: main()
    except (ValueError,OSError,json.JSONDecodeError) as exc: print(f'ERROR: {exc}',file=sys.stderr);sys.exit(2)
