#!/usr/bin/env python3
"""Build editable showreel primitives. Extend scene() for a bespoke shot."""
import argparse,hashlib,html,json,re
from pathlib import Path
from core import validate,relative_file,SAFE
from website import site,mobile

def contrast_color(bg,palette):
    def lum(c):
        v=[int(c[i:i+2],16)/255 for i in (1,3,5)];v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
        return sum(x*y for x,y in zip(v,[.2126,.7152,.0722]))
    def contrast(c):a,b=sorted([lum(bg),lum(c)]);return (b+.05)/(a+.05)
    return max([palette['ink'],palette['light'],'#000000','#ffffff'],key=contrast)

def fit(text,width,maximum,metrics,minimum=90):
    try:units=sum(metrics[c] for c in text)
    except KeyError as err:raise ValueError('Unsupported font glyph: '+repr(err.args[0]))
    size=min(maximum,int((width+4*(len(text)-1)-2*text.count(' '))/max(units,.1)))
    if size<minimum:raise ValueError('Rewrite long primary copy instead of shrinking: '+text)
    return size

def lock(lines,metrics,top=325):
    maximum=170 if len(lines)==1 else 149 if len(lines)==2 else 125
    sizes=[fit(s,746,maximum,metrics) for s in lines]
    markup=f'<div class="title" style="top:{top}px">'+''.join(f'<span data-layout-allow-overlap class="line" style="font-size:{n}px;letter-spacing:-4px;word-spacing:2px">{html.escape(s)}</span>' for s,n in zip(lines,sizes))+'</div>'
    return markup,[dict(text=s,size=n,font='Manrope') for s,n in zip(lines,sizes)]

def scene(s,index,spec,metrics):
    e=html.escape;d=s['beats']*60/spec['bpm'];sites=spec['sites'];byid={x['id']:x for x in sites};kind=s['kind'];bg=spec['palette'][s.get('tone','ink')];fg=contrast_color(bg,spec['palette'])
    body,ty=lock(s['lines'],metrics);css='';js="tl.fromTo('.title .line',{y:120,opacity:0},{y:0,opacity:1,duration:.6,ease:'power4.out',stagger:.12},.05);"
    if s.get('support'):
        sy=535 if len(s['lines'])==1 else 720
        body+=f'<div class="support" style="top:{sy}px;font-size:36px">{e(s["support"])}</div>'
    if kind=='opening':
        body+='<div class="strip" data-layout-allow-overflow>'+''.join(site(sites[i%len(sites)],f'opening-{i}',f'left:{-460+i*565}px;top:{110+(i%2)*85}px;transform:scale(.72);',680) for i in range(3))+'</div>'
        css='.strip{position:absolute;left:0;top:760px;width:1700px;height:810px;transform:rotate(-11deg);transform-origin:540px 350px}'
        js+=f"tl.fromTo('.strip',{{x:300,y:210,rotation:-16}},{{x:0,y:0,rotation:-11,duration:.85,ease:'power3.out'}},0);tl.to('.strip',{{x:-130,duration:{max(.2,d-.85)},ease:'none'}},.85);tl.to('#opening-1 .page',{{y:-180,duration:{d*.7},ease:'power1.inOut'}},{d*.2});"
    elif kind=='grid':
        cards=''
        for i in range(9):
            x=(i%3-1)*840;y=(i//3-1)*600;item=sites[0] if i==4 else sites[i%len(sites)]
            cards+=site(item,f'grid-{i}',f'left:{x-390}px;top:{y-280}px;')
        body+='<div class="stage"><div class="world" data-layout-allow-overflow>'+cards+'</div></div>'
        css='.stage{position:absolute;inset:0;perspective:1200px;perspective-origin:540px 1090px}.world{position:absolute;left:540px;top:1090px;width:0;height:0;transform-style:preserve-3d}.world .browser{backface-visibility:hidden}'
        js+="const world=document.querySelector('.world'),cam={x:110,y:160,z:-650,rx:40,ry:-17};function applyCamera(){world.style.transform=`translate3d(${cam.x}px,${cam.y}px,${cam.z}px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`}applyCamera();"
        js+=f"tl.fromTo(cam,{{x:110,y:160,z:-650,rx:40,ry:-17}},{{x:-140,y:70,z:-430,rx:27,ry:12,duration:{d*.38},ease:'power2.inOut',onUpdate:applyCamera}},0);tl.to('.title,.support',{{opacity:0,duration:{d*.08},ease:'power2.out'}},{d*.34});tl.to(cam,{{x:0,y:0,z:110,rx:5,ry:-3,duration:{d*.28},ease:'power4.out',onUpdate:applyCamera}},{d*.44});tl.to(cam,{{y:-15,z:130,rx:3,ry:-2,duration:{d*.27},ease:'none',onUpdate:applyCamera}},{d*.73});tl.to('#grid-4 .page',{{y:-150,duration:{d*.3},ease:'power1.inOut'}},{d*.65});"
    elif kind=='scroll':
        item=byid[s['site']];body+=site(item,'feature','left:68px;top:805px;width:850px;',790)
        css='.browser{border-color:#2222;box-shadow:0 40px 80px #17201833}'
        js+=f"tl.fromTo('#feature',{{scale:.82,rotation:-7,y:220}},{{scale:1,rotation:-2,y:0,duration:{d*.18},ease:'power4.out'}},0);tl.to('#feature .page',{{y:{-int(s.get('scroll',525))},duration:{d*.66},ease:'power2.inOut'}},{d*.18});"
        if s.get('phone',True):
            body+=mobile(item,'phone','left:650px;top:1110px;transform:rotate(7deg);')
            js+=f"tl.fromTo('#phone',{{y:350,x:150,rotation:18,opacity:0}},{{y:0,x:0,rotation:7,opacity:1,duration:{d*.22},ease:'power3.out'}},{d*.4});tl.to('#phone .mobile-page',{{y:-100,duration:{d*.3},ease:'power1.inOut'}},{d*.65});"
    elif kind=='brand':
        item=byid[s['site']];name_size=fit(item['name'],670,145,metrics,45)
        body+=f'<div class="brand-board" data-layout-ignore><div class="brand-word" style="font-size:{name_size}px">{e(item["name"])}<span>{e(item["eyebrow"])}</span></div><div class="brand-photo"><img src="{e(item["hero"],quote=True)}" alt="Brand study"></div><div class="brand-detail">{e(item["section_title"][0])}<div class="swatches"><i></i><i></i><i></i></div></div></div>'
        body+=mobile(item,'brand-phone','left:635px;top:1190px;transform:rotate(7deg);')
        accent=spec['palette']['accent'];accentink=contrast_color(accent,spec['palette'])
        css=f'.brand-board{{position:absolute;left:106px;top:865px;width:756px;height:790px}}.brand-word{{height:245px;background:{accent};color:{accentink};padding:25px 35px;font-weight:800;letter-spacing:-6px;line-height:1.05;overflow:hidden}}.brand-word span{{display:block;font-size:21px;letter-spacing:3px;margin-top:15px}}.brand-photo{{position:absolute;left:0;top:266px;width:490px;height:410px;overflow:hidden}}.brand-photo img{{width:100%;height:100%;object-fit:cover}}.brand-detail{{position:absolute;left:510px;top:266px;width:246px;height:410px;background:{spec["palette"]["light"]};color:{spec["palette"]["ink"]};padding:24px;font-size:36px;letter-spacing:-1px;line-height:1.1}}.swatches{{display:flex;gap:9px;margin-top:40px}}.swatches i{{height:39px;width:39px;border-radius:50%;background:{accent}}}.swatches i:nth-child(2){{background:{spec["palette"]["ink"]}}}.swatches i:nth-child(3){{background:{spec["palette"]["soft"]}}}.mobile{{width:253px;height:505px}}'
        js+=f"tl.fromTo('.brand-word',{{x:-1000}},{{x:0,duration:.7,ease:'power4.out'}},.45);tl.fromTo('.brand-photo',{{y:420,opacity:0}},{{y:0,opacity:1,duration:.65,ease:'power3.out'}},.75);tl.fromTo('.brand-detail',{{x:450,opacity:0}},{{x:0,opacity:1,duration:.6,ease:'power4.out'}},1);tl.fromTo('#brand-phone',{{x:400,y:150,rotation:20,opacity:0}},{{x:0,y:0,rotation:7,opacity:1,duration:.7,ease:'power4.out'}},{d*.5});"
    elif kind=='identity':
        body,ty=lock(s['lines'],metrics,340)
        if s.get('support'):body+=f'<div class="support" style="top:530px;font-size:36px">{e(s["support"])}</div>'
        body+=f'<div class="portrait-disc"></div><img id="portrait" src="{e(s["asset"],quote=True)}" alt="{e(s.get("alt",s["lines"][0]),quote=True)}">'
        css=f'.portrait-disc{{position:absolute;left:145px;top:748px;width:700px;height:700px;border-radius:50%;background:{spec["palette"]["accent"]}}}#portrait{{position:absolute;left:177px;top:655px;width:672px;height:1009px;object-fit:contain;object-position:center top;filter:drop-shadow(15px 22px 0 #10172c33)}}'
        js+="tl.fromTo('#portrait',{y:220,rotation:-7,opacity:0},{y:0,rotation:0,opacity:1,duration:.8,ease:'power4.out'},.15);tl.fromTo('.portrait-disc',{scale:.3},{scale:1,duration:.9,ease:'power4.out'},0);"
    elif kind=='cta':
        action=s['action'];big=fit(action[-1],690,123,metrics,86)
        body+='<div id="cta">'+(f'<span>{e(action[0])}</span>' if len(action)>1 else '')+f'<strong style="font-size:{big}px">{e(action[-1])}</strong></div>'
        if s.get('signature'):body+=f'<div class="signature">{e(s["signature"])}</div>'
        body+='<div class="outro" data-layout-allow-overflow>'+''.join(site(sites[i%len(sites)],f'outro-{i}',f'left:{i*525}px;transform:scale(.64);transform-origin:0 0;') for i in range(3))+'</div>'
        css=f'#cta{{position:absolute;left:106px;top:872px;width:756px;height:282px;border:2px solid {fg};border-radius:11px;text-align:center;padding-top:27px;color:{fg}}}#cta span{{display:block;font-size:40px;letter-spacing:5px;font-weight:550}}#cta strong{{display:block;letter-spacing:-4px;line-height:1.2;font-weight:750}}.signature{{position:absolute;left:111px;top:1190px;font-size:35px;font-weight:550;letter-spacing:-1px}}.outro{{position:absolute;left:-130px;top:1360px;width:1700px;height:500px;transform:rotate(-8deg)}}'
        js+=f"tl.fromTo('#cta',{{scale:.82,y:140,opacity:0}},{{scale:1,y:0,opacity:1,duration:.65,ease:'power4.out'}},.65);tl.fromTo('.outro',{{x:350,y:200}},{{x:0,y:0,duration:.9,ease:'power3.out'}},.2);tl.to('.outro',{{x:-150,duration:{max(.1,d-1.1)},ease:'none'}},1.1);"
        ty.append(dict(text=action[-1],size=big,font='Manrope'))
    sid=f'showreel-{index+1:02d}'
    cssbase=(spec['_project']/'website.css').read_text()
    doc=f'''<!doctype html><html lang="{e(spec['language'])}"><head><meta charset="utf-8"><script src="assets/runtime/gsap.min.js"></script><style>{cssbase}\n{css}</style></head><body><div id="root" data-composition-id="{sid}" data-start="0" data-duration="{d}" data-width="1080" data-height="1920" style="background:{bg};color:{fg}">{body}</div><script>window.__timelines=window.__timelines||{{}};const tl=gsap.timeline({{paused:true}});{js}tl.to({{}},{{duration:{d}}},0);window.__timelines['{sid}']=tl;</script></body></html>'''
    return doc,dict(id=sid,bg=bg,duration=d,type=ty)

def build(project):
    spec=json.loads((project/'reel.json').read_text());palette,duration=validate(spec,project);spec['_project']=project
    metrics=json.loads((project/'assets/runtime/font-metrics.json').read_text())['Manrope']['widths']
    outputs={};data=[];start=0
    for i,s in enumerate(spec['scenes']):
        doc,row=scene(s,i,spec,metrics);d=row['duration'];row.update(src=f'compositions/scene-{i+1:02d}.html',start=round(start,6),sample=round(start+d*(.32 if s['kind']=='grid' else .7),3));data.append(row);outputs[row['src']]=doc;start+=d
    slots=''.join(f'<div class="clip" id="slot-{i}" data-composition-id="{s["id"]}" data-composition-src="{s["src"]}" data-start="{s["start"]}" data-duration="{s["duration"]}" data-track-index="2" data-width="1080" data-height="1920"></div>' for i,s in enumerate(data))
    audio=f'<audio id="score" src="{html.escape(spec["audio"],quote=True)}" data-start="0" data-duration="{duration}" data-track-index="4" data-volume="1"></audio>' if 'audio' in spec else ''
    outputs['index.html']=f'''<!doctype html><html lang="{spec['language']}" data-resolution="portrait"><head><meta charset="utf-8"><title>{html.escape(spec['title'])}</title><script src="assets/runtime/gsap.min.js"></script><style>*{{box-sizing:border-box}}html,body{{margin:0;width:1080px;height:1920px;overflow:hidden;background:{data[0]['bg']}}}#root,.clip{{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="{duration}" data-width="1080" data-height="1920">{slots}{audio}</div><script>window.__timelines=window.__timelines||{{}};const tl=gsap.timeline({{paused:true}});tl.to({{}},{{duration:{duration}}},0);window.__timelines.main=tl;</script></body></html>'''
    qa=project/'qa';qa.mkdir(exist_ok=True);(project/'compositions').mkdir(exist_ok=True)
    old=json.loads((qa/'generated.json').read_text()) if (qa/'generated.json').exists() else {}
    if any(not re.fullmatch(r'(index\.html|compositions/scene-\d{2}\.html)',r) for r in old):raise ValueError('Invalid generated manifest')
    for r in old:
        f=project/r
        if f.exists() and hashlib.sha256(f.read_bytes()).hexdigest()!=old[r]:raise ValueError('Preserve custom edits before rebuilding '+r)
    for r in outputs:
        if (project/r).exists() and r not in old:raise ValueError('Refusing to overwrite untracked '+r)
    for r in old:
        if r not in outputs and (project/r).exists():(project/r).unlink()
    for r,source in outputs.items():(project/r).write_text(source)
    (qa/'generated.json').write_text(json.dumps({r:hashlib.sha256((project/r).read_bytes()).hexdigest() for r in outputs},indent=2)+'\n')
    (qa/'build.json').write_text(json.dumps(dict(title=spec['title'],duration=duration,fps=30,width=1080,height=1920,bpm=spec['bpm'],safe=SAFE,scenes=data,visual_review='pending'),indent=2)+'\n')
    print(json.dumps(dict(title=spec['title'],duration=duration,scenes=len(data),snapshots=','.join(str(s['sample']) for s in data))))
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('project',nargs='?',default='.',type=Path);args=ap.parse_args();build(args.project.resolve())
