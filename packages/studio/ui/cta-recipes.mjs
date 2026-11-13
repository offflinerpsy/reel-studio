export const CTA_RECIPE_PREFIX='REEL_CTA_RECIPE_V1\n';
export const CTA_START='[REEL_SELECTED_CTA_V1]';
export const CTA_END='[/REEL_SELECTED_CTA_V1]';
export function isCtaTemplate(t){return typeof t?.instructions==='string'&&t.instructions.startsWith(CTA_RECIPE_PREFIX);}
export function serializeCtaRecipe({name,spokenText,revision=1}){
 name=String(name||'').trim();spokenText=String(spokenText||'').trim();
 if(!name||name.length>100)throw new Error('Name the ending (up to 100 characters).');
 if(!spokenText||spokenText.length>1500)throw new Error('Add the spoken ending (up to 1500 characters).');
 if(!Number.isInteger(revision)||revision<1)throw new Error('Invalid ending revision.');
 return CTA_RECIPE_PREFIX+JSON.stringify({schema:1,name,spokenText,revision,style:'inherit-video-template',voice:'inherit-video-voice'});
}
export function parseCtaTemplate(t){
 if(!isCtaTemplate(t))return null;
 try{const x=JSON.parse(t.instructions.slice(CTA_RECIPE_PREFIX.length));if(x.schema!==1||!t.id||serializeCtaRecipe(x)!==t.instructions)return null;return {id:t.id,...x};}catch{return null;}
}
export function visualTemplates(templates=[]){return templates.filter(t=>!isCtaTemplate(t));}
export function ctaTemplates(templates=[]){return templates.map(parseCtaTemplate).filter(Boolean);}
export async function prepareCtaIdea(idea,selection,templates=[]){
 if(!selection||selection==='default')return idea;
 if(idea.includes(CTA_START)||idea.includes(CTA_END))throw new Error('This idea already contains a saved ending. Start a new idea to choose another.');
 const c=selection==='none'?{id:'none',schema:1,name:'No ending',revision:1,spokenText:'',style:'inherit-video-template',voice:'inherit-video-voice'}:ctaTemplates(templates).find(x=>x.id===selection);
 if(!c)throw new Error('The selected ending is unavailable. Refresh the library.');
 const data=JSON.stringify(c),digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
 const sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 const result=idea.trimEnd()+'\n\n'+CTA_START+'\n'+JSON.stringify({...c,sha256})+'\n'+CTA_END+'\n'+(c.id==='none'?'Finish after the explanation. Do not append a CTA or inherited outro.':'Append this selected ending exactly once after the explanation. Use its exact spoken text, the selected visual template and this film’s voice. Preserve complete words and a readable final hold. Replace any example/default outro; do not duplicate a body CTA.');
 if(result.length>6000)throw new Error('Shorten the idea so the selected ending fits in the saved brief.');
 return result;
}
export function readCtaIdea(raw=''){
 const start=raw.indexOf(CTA_START),end=raw.indexOf(CTA_END,start);
 if(start<0||end<0)return {idea:raw,ending:null};
 try{const ending=JSON.parse(raw.slice(start+CTA_START.length,end).trim());if(ending.schema!==1||!ending.id||typeof ending.spokenText!=='string'||!ending.sha256)return {idea:raw,ending:null};return {idea:raw.slice(0,start).trimEnd(),ending};}catch{return {idea:raw,ending:null};}
}
