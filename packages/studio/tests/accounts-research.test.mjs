import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StudioStore,digest} from '../server/store.mjs';
import {ResearchService,researchPlan} from '../server/research.mjs';
import {createStudio} from '../server/index.mjs';

const settings={keywords:['why do astronauts float','microgravity'],locationCode:2840,languageCode:'en',timeRange:'past_90_days',maxCostUSD:0.05};
function folder(t){const home=mkdtempSync(join(tmpdir(),'reel-accounts-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return home;}
function project(s){const p=s.create({requestKey:randomUUID(),title:'Float',idea:'Explain why astronauts float',templateId:'kinetic',model:'gpt-6.1-sol',effort:'xhigh',duration:60,language:'en'});const j=s.begin(p.id,{requestKey:randomUUID()});const file=join(j.dir,'video.mp4');writeFileSync(file,'immutable fixture');const v=s.addVersion(p.id,j.id,{path:file,media:{duration:60}});return {p,v};}
function response(a){return {tasks:[{id:randomUUID(),status_code:20000,cost:a.path.includes('trends')?0.011:0.002,data:a.data[0],result:[{datetime:'2026-10-12 00:00:00 +00:00',location_code:2840,language_code:'en',items:a.path.includes('trends')?[{type:'google_trends_graph',keywords:a.data[0].keywords,averages:[40,10],data:[{date_from:'2026-10-01',date_to:'2026-10-02',values:[null,0]}]}]:[{type:'youtube_video',title:'Why do astronauts float?',url:'https://www.youtube.com/watch?v=abcdefghijk',rank_absolute:1}]}]}]};}

test('legacy account migration is stable and two YouTube channels never overwrite each other',t=>{
 const home=folder(t),s=new StudioStore(home),raw=s.read();delete raw.accounts;raw.schema=1;raw.connections={tiktok:{account:'@owner',profileName:'Personal',status:'browser_verified',verifiedAt:'2026-10-11T00:00:00Z'}};writeFileSync(s.path,JSON.stringify(raw));
 const legacy=s.read().accounts[0];assert.equal(new StudioStore(home).read().accounts[0].id,legacy.id);
 const a=s.addAccount({channel:'youtube',account:'UC'+'a'.repeat(22),label:'Channel A',method:'browser'}),b=s.addAccount({channel:'youtube',account:'UC'+'b'.repeat(22),label:'Channel B',method:'browser'});
 assert.notEqual(a.id,b.id);assert.equal(s.read().accounts.length,3);assert.equal(s.read().connections.tiktok.account,'@owner');
 assert.equal(s.addAccount({channel:'youtube',account:a.account,label:'Same',method:'browser'}).reused,true);
 s.archiveAccount(a.id,true);assert.equal(s.read().accounts.find(x=>x.id===b.id).archived,false);s.archiveAccount(a.id,false);
});
test('destinations invalidate approval, freeze platform copy and block archived or reassigned accounts',t=>{
 const s=new StudioStore(folder(t)),{p,v}=project(s);
 const a=s.connection('tiktok',{account:'@one',profileName:'Personal'}),b=s.connection('tiktok',{account:'@two',profileName:'Other'});
 s.metadata(p.id,v.id,{...v.metadata,platforms:{tiktok:{title:'A TikTok hook',caption:'Platform-specific caption',hashtags:['#Physics'],evidence:[]}}},s.get(p.id).revision);
 s.targets(p.id,{tiktok:a.id},s.get(p.id).revision);s.approve(p.id,v.id,v.sha256,s.get(p.id).revision);
 const attempt=s.preparePublish(p.id,v.id,'tiktok',a.account,a.id);assert.equal(s.publicationJob(attempt.id).metadata.title,'A TikTok hook');
 s.attempt(attempt.id,{effect:'possibly_delivered'});assert.equal(s.preparePublish(p.id,v.id,'tiktok',a.account,a.id).reused,true);
 s.targets(p.id,{tiktok:b.id},s.get(p.id).revision);assert.equal(s.get(p.id).versions[0].approval,null);assert.throws(()=>s.publicationJob(attempt.id),/stale/);
 s.approve(p.id,v.id,v.sha256,s.get(p.id).revision);assert.throws(()=>s.preparePublish(p.id,v.id,'tiktok',a.account,a.id),/selected account/);
 s.archiveAccount(b.id,true);assert.throws(()=>s.preparePublish(p.id,v.id,'tiktok',b.account,b.id),/selected account/);
 assert.throws(()=>s.connection('tiktok',{connectionId:a.id,account:'@different'}),/cannot be reassigned/);
});
test('a delayed copy result cannot overwrite an owner edit or changed destinations',t=>{
 const s=new StudioStore(folder(t)),{p,v}=project(s),before=digest(v.metadata),targets=digest({});
 s.metadata(p.id,v.id,{...v.metadata,title:'Owner edit'},s.get(p.id).revision);
 assert.throws(()=>s.metadata(p.id,v.id,{...v.metadata,title:'Worker edit'},undefined,{metadataHash:before,targetsHash:targets}),/retained for review/);
 assert.equal(s.get(p.id).versions[0].metadata.title,'Owner edit');
});
test('bounded research uses the connected tool, preserves nulls/costs and reuses completed requests',async t=>{
 const home=folder(t),calls=[];const service=new ResearchService(home,{checkAccess:async()=>({status:'verified'}),request:async a=>{calls.push(a);return {content:[{type:'text',text:JSON.stringify(response(a))}]};}});
 const first=await service.run(settings,{});assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='POST'&&c.noAiMode===true));assert.equal(first.totalCostUSD,0.013);assert.equal(first.operations[0].results[0].items[0].points[0].values[0],null);
 const second=await service.run({...settings,maxCostUSD:0.013},{});assert.equal(second.reused,true);assert.equal(second.id,first.id);assert.equal(calls.length,2);
 assert.equal(first.operations[0].parameters.type,'youtube');assert.equal(researchPlan(settings).maxCalls,2);
 assert.ok(first.limitations.some(x=>x.includes('TikTok')));assert.equal(JSON.stringify(first).includes('accessToken'),false);
});
test('an uncertain paid response creates a durable no-replay fence',async t=>{
 const home=folder(t);let calls=0;const service=new ResearchService(home,{checkAccess:async()=>({status:'verified'}),request:async()=>{calls++;throw new Error('transport lost');}});
 await assert.rejects(()=>service.run(settings,{}),/transport lost/);const record=JSON.parse(readFileSync(join(home,'research',readdirSync(join(home,'research')).find(f=>f.endsWith('.json')))));
 assert.equal(record.status,'uncertain');assert.equal(record.operations[0].effect,'possibly_delivered');
 await assert.rejects(()=>service.run(settings,{}),/reconciliation/);assert.equal(calls,1);
});
test('a mismatched research market is rejected, and insufficient data stays unknown',async t=>{
 const service=new ResearchService(folder(t),{checkAccess:async()=>({status:'verified'}),request:async a=>{const r=response(a);r.tasks[0].data={...r.tasks[0].data,location_code:2826};return r;}});
 await assert.rejects(()=>service.run(settings,{}),/does not match/);
});
test('metadata generation completes only with real receipt binding and all platform variants',async t=>{
 const home=folder(t),copy={title:'Why astronauts float',caption:'They fall together.',hashtags:['#Physics'],evidence:[]};let requestCalls=0;
 const service=new ResearchService(home,{checkAccess:async()=>({status:'verified'}),request:async a=>{requestCalls++;return response(a);}});
 const runtime={close:async()=>{},start:async o=>{writeFileSync(join(o.cwd,'DELIVERY.json'),JSON.stringify({metadata:{...copy,platforms:{youtube:copy,tiktok:{...copy,title:'Gravity never clocked out'},instagram:{...copy,title:'The station falls with you'}}}}));await o.onEvent({method:'reel/thread-ready',params:{threadId:'test-thread',permissions:{sandbox:{type:'dangerFullAccess'}}}});await o.onEvent({method:'turn/completed',params:{turn:{status:'completed'}}});return {threadId:'test-thread',turnId:'test-turn'};}};
 const app=await createStudio({home,runtime,researchService:service});t.after(()=>app.close());const {p,v}=project(app.store);
 const r=await app.invoke('reel_generate',{projectId:p.id,versionId:v.id,requestKey:randomUUID(),kind:'metadata',research:settings});assert.equal(r.isError,undefined);
 for(let n=0;n<30&&app.store.get(p.id).jobs.at(-1).status!=='completed';n++)await new Promise(resolve=>setTimeout(resolve,10));
 const out=app.store.get(p.id);assert.equal(out.jobs.at(-1).status,'completed');assert.equal(out.versions[0].metadata.research.totalCostUSD,0.013);assert.equal(out.versions[0].metadata.platforms.tiktok.title,'Gravity never clocked out');assert.equal(out.versions[0].sha256,v.sha256);assert.equal(out.versions[0].approval,null);assert.equal(requestCalls,2);assert.equal(app.store.read().attempts.length,0);
 const valid=await app.invoke('reel_metadata',{projectId:p.id,versionId:v.id,expectedRevision:out.revision,metadata:{...out.versions[0].metadata,caption:'An owner edit'}});assert.equal(valid.isError,undefined);
 const current=app.store.get(p.id),forged={...current.versions[0].metadata,research:{...current.versions[0].metadata.research,totalCostUSD:0.001}};
 assert.equal((await app.invoke('reel_metadata',{projectId:p.id,versionId:v.id,expectedRevision:current.revision,metadata:forged})).isError,true);assert.equal(app.store.get(p.id).versions[0].metadata.research.totalCostUSD,0.013);
 app.store.job(p.id,out.jobs.at(-1).id,{status:'uncertain',error:'A previous validation error'});app.store.job(p.id,out.jobs.at(-1).id,{status:'completed'});assert.equal(app.store.get(p.id).jobs.at(-1).error,undefined);
});
