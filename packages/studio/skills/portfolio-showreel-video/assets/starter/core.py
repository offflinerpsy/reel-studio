"""Validation shared by composition and media helpers."""
from pathlib import Path
import re
SAFE=dict(x=106,y=290,width=756,height=950)
KINDS={'opening','grid','scroll','brand','identity','cta'}
def relative_file(project,value):
    if not isinstance(value,str) or Path(value).is_absolute():raise ValueError('Use project-relative media paths')
    path=project/value
    if path.is_symlink():raise ValueError('Copy media into the project; symlinks are not portable')
    p=path.resolve()
    if project.resolve() not in p.parents or not p.is_file():raise ValueError('Missing or outside-project media: '+value)
    return p
def strings(value,label,maximum=3):
    if not isinstance(value,list) or not 1<=len(value)<=maximum or any(not isinstance(s,str) or not s.strip() or len(s)>100 or '\n' in s for s in value):raise ValueError('Invalid '+label)
def validate(spec,project):
    if not isinstance(spec.get('title'),str) or not spec['title'].strip():raise ValueError('title required')
    if not re.fullmatch('[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?',spec.get('language','')):raise ValueError('language tag required')
    bpm=spec.get('bpm');scenes=spec.get('scenes',[]);sites=spec.get('sites',[])
    if isinstance(bpm,bool) or not isinstance(bpm,(int,float)) or not 90<=bpm<=140:raise ValueError('bpm must be90–140')
    if not isinstance(spec.get('seed',42),int):raise ValueError('seed must be an integer')
    palette=spec.get('palette')
    if not isinstance(palette,dict) or set(palette)!={'ink','light','accent','soft'} or any(not isinstance(c,str) or not re.fullmatch('#[0-9a-fA-F]{6}',c) for c in palette.values()):raise ValueError('palette requires ink/light/accent/soft hex colors')
    if not isinstance(sites,list) or not 1<=len(sites)<=8:raise ValueError('Use1–8 site studies')
    ids=set()
    for site in sites:
        ident=site.get('id','')
        if not re.fullmatch('[a-z][a-z0-9-]{0,30}',ident) or ident in ids:raise ValueError('Site ids must be unique lowercase slugs')
        ids.add(ident)
        for key in ['name','eyebrow','cta','section_copy']:
            if not isinstance(site.get(key),str) or not site[key].strip():raise ValueError('Site '+ident+' needs '+key)
        strings(site.get('headline'),'site headline',3);strings(site.get('section_title'),'site section_title',3)
        if site.get('style','editorial') not in ['editorial','serene','bold']:raise ValueError('Unknown site style')
        asset=relative_file(project,site.get('hero'))
        if asset.suffix.lower() not in ['.png','.jpg','.jpeg','.webp','.svg']:raise ValueError('Use a browser-compatible hero image')
    if not isinstance(scenes,list) or not 2<=len(scenes)<=20:raise ValueError('Use2–20 scenes')
    duration=0
    for s in scenes:
        if s.get('kind') not in KINDS:raise ValueError('Unknown scene kind')
        strings(s.get('lines'),'scene lines',3)
        if isinstance(s.get('beats'),bool) or not isinstance(s.get('beats'),(int,float)) or not 4<=s['beats']<=24:raise ValueError('Scene beats must be4–24')
        d=s['beats']*60/bpm
        if abs(d*30-round(d*30))>.001:raise ValueError('Every scene must end on a30fps frame')
        duration+=d
        if s.get('tone','ink') not in palette:raise ValueError('Unknown scene tone')
        if s['kind'] in ['scroll','brand'] and s.get('site') not in ids:raise ValueError('Scene refers to an unknown site')
        if s['kind']=='identity':relative_file(project,s.get('asset'))
        if s['kind']=='cta':strings(s.get('action'),'CTA action',2)
    if not 6<=duration<=90:raise ValueError('Use6–90seconds, or deliberately adapt the starter')
    if 'audio' in spec:relative_file(project,spec['audio'])
    return palette,round(duration,6)
