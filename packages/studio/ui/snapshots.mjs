// Merge read-only index refreshes without discarding loaded edit state.
export const isFullProject=p=>Boolean(p?.detail||p?.productionProfile!==undefined||(p?.versions||[]).some(v=>v.metadata!==undefined||v.artifacts!==undefined));
export function mergeSnapshot(current,next){
 if(current&&next.revision<current.revision)return current;
 const fullIncoming=!next.compact;
 const projects=(next.projects||[]).map(incoming=>{
  const previous=current?.projects?.find(p=>p.id===incoming.id);
  if(!fullIncoming&&isFullProject(previous)&&incoming.revision<=previous.revision)return previous;
  if(fullIncoming&&isFullProject(previous)&&incoming.revision<previous.revision)return previous;
  return fullIncoming?{...incoming,detail:true}:incoming;
 });
 const templates=(next.templates||[]).map(t=>next.compact?{...current?.templates?.find(old=>old.id===t.id),...t}:t);
 const merged={...current,...next,projects,templates};
 if(next.compact){
  for(const key of ['releasePlans','profileHistory'])if(current?.[key]!==undefined)merged[key]=current[key];
  merged.attempts=(next.attempts||[]).map(incoming=>({...current?.attempts?.find(a=>a.id===incoming.id),...incoming}));
 }
 return merged;
}
export function mergeProjectDetail(current,project){
 if(!current||!project)return current;
 const previous=current.projects.find(p=>p.id===project.id);
 if(!previous||project.revision<previous.revision)return current;
 return {...current,projects:current.projects.map(p=>p.id===project.id?{...project,detail:true}:p)};
}
