"""Exact HTML site mockups. The hero photography is supplied separately."""
from html import escape as e
def br(lines):return '<br>'.join(e(x) for x in lines)
def site(data,ident,style='',height=560):
    hero=e(data['hero'],quote=True);name=e(data['name']);tag=e(data['eyebrow']);theme=data.get('style','editorial')
    nav=' &nbsp;&nbsp; '.join(e(x) for x in data.get('nav',['About','Work','Contact']))
    address=e(data.get('address',data['id']+'.example'))
    return f'''<div id="{ident}" data-layout-ignore class="browser {theme}" style="height:{height}px;{style}"><div class="chrome"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span class="address">{address}</span></div><div class="viewport"><div class="page"><div class="nav"><span class="logo">{name}</span><span class="links">{nav}</span></div><div class="site-hero"><div class="hero-photo" style="background-image:url('{hero}')"></div><div class="hero-copy"><span class="small">{tag}</span>{br(data['headline'])}</div><span class="site-cta">{e(data['cta'])}</span></div><div class="site-section"><div class="section-tag">{tag}</div><div class="section-title">{br(data['section_title'])}</div><p class="site-text">{e(data['section_copy'])}</p></div><div class="photo-row"><div style="background-image:url('{hero}')"></div><div style="background-image:url('{hero}')"></div></div><div class="site-footer">{br(data['section_title'])}</div></div></div></div>'''
def mobile(data,ident,style=''):
    return f'''<div id="{ident}" data-layout-ignore class="mobile" style="{style}"><div class="island"></div><div class="mobile-page"><div class="mobile-nav">{e(data['name'])}</div><div class="mobile-photo" style="background-image:url('{e(data['hero'],quote=True)}')"></div><div class="mobile-copy">{br(data['headline'])}</div><div class="mobile-bar">{e(data['cta'])}</div></div></div>'''
