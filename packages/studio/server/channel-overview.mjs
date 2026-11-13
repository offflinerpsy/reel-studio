// Operational counts from existing Studio receipts. No platform analytics calls.
export function publicationKey(a){
 if(a.status!=='published'||a.effect!=='independently_verified'||!a.url)return null;
 let u;try{u=new URL(a.url);}catch{return null;}
 if(!['http:','https:'].includes(u.protocol))return null;
 let post=u.origin+u.pathname.replace(/\/$/,'');
 if(['youtube.com','www.youtube.com','youtu.be'].includes(u.hostname)){
  const video=u.hostname==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/shorts\/([^/]+)$/)?.[1];
  if(!/^[A-Za-z0-9_-]{11}$/.test(video||''))return null;
  post='youtube:'+video;
 }
 return JSON.stringify([a.channel||null,a.target||null,post]);
}
export function publishedCount(attempts){return new Set(attempts.map(publicationKey).filter(Boolean)).size;}
const active=j=>['starting','running','uncertain','cancel_requested'].includes(j.status);

export function channelOverview(s){
 const groups=new Map();
 for(const c of s.accounts||[]){
  if(c.archived)continue;
  const key=JSON.stringify([c.channel,c.account]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(c);
 }
 return [...groups.values()].map(accounts=>{
  const c=accounts.find(x=>x.status==='browser_verified')||accounts[0],ids=new Set(accounts.map(x=>x.id));
  const directions=(s.productionLines||[]).filter(l=>l.channel===c.channel&&l.target===c.account);
  const lineIds=new Set(directions.map(l=>l.id));
  // Historical releases predate production directions. Bind them by exact
  // frozen channel identity, never by a title, template, or current selector.
  const attempts=s.attempts.filter(a=>a.channel===c.channel&&a.target===c.account);
  const attempted=new Set(attempts.map(a=>a.projectId));
  const projects=s.projects.filter(p=>lineIds.has(p.productionLineId)||ids.has(p.targets?.[c.channel])||attempted.has(p.id));
  return {id:c.channel+':'+c.account,channel:c.channel,account:c.account,label:c.label,connectionId:c.id,connectionIds:[...ids],status:c.status,
   counts:{projects:projects.length,published:publishedCount(attempts),activeJobs:projects.flatMap(p=>p.jobs).filter(active).length,readyForReview:projects.filter(p=>p.status==='review'&&(!p.versions?.at(-1)?.id||!attempts.some(a=>a.projectId===p.id&&a.versionId===p.versions.at(-1).id&&publicationKey(a)))).length},
   directions:directions.map(l=>({id:l.id,name:l.name,ownerHost:l.ownerHost,mode:l.mode,status:l.status}))};
 }).sort((a,b)=>b.counts.published-a.counts.published||a.label.localeCompare(b.label));
}
