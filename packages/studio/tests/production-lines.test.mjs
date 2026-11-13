import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as uid} from 'node:crypto';
import {StudioStore,digest} from '../server/store.mjs';
import {operationsSnapshot,assertExecution} from '../server/production-lines.mjs';
import {createStudio} from '../server/index.mjs';

function setup(t){
 const home=mkdtempSync(join(tmpdir(),'reel-directions-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const s=new StudioStore(home),c=s.addAccount({channel:'youtube',account:'UC1234567890123456789012',label:'Channel',method:'browser'});
 s.connection('youtube',{connectionId:c.id,account:c.account,profileName:'Existing Linux Chrome'});
 const args={requestKey:uid(),name:'Science',connectionId:c.id,mode:'production',ownerHost:'linux',ownerThreadId:uid(),templateId:'kinetic',publicationEnabled:true};
 const line=s.lineCreate(args),worker={lineId:line.id,generation:line.generation,ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId};
 return {s,home,c,line,worker,args};
}
function project(s,line){return s.create({requestKey:uid(),title:'A new topic',idea:'Explain a new topic',templateId:'kinetic',model:'gpt-6.1-sol',effort:'xhigh',duration:30,language:'en',productionLineId:line.id});}
function master(s,p){const j=s.begin(p.id,{requestKey:uid()}),file=join(j.dir,'film.mp4');writeFileSync(file,'video:'+p.id);const v=s.addVersion(p.id,j.id,{path:file,media:{duration:1},metadata:{title:'Question',caption:'Explanation',hashtags:['#science'],evidence:[]}});s.approve(p.id,v.id,v.sha256,s.get(p.id).revision);return v;}
function attempt(s,p,v,c){return s.preparePublish(p.id,v.id,'youtube',c.account,c.id);}

test('direction creation is idempotent, exact-channel unique and permits a separate lab',t=>{
 const f=setup(t);assert.equal(f.s.lineCreate(f.args).id,f.line.id);
 assert.throws(()=>f.s.lineCreate({...f.args,name:'changed'}),/request key/);
 assert.throws(()=>f.s.lineCreate({...f.args,requestKey:uid()}),/already has/);
 const lab=f.s.lineCreate({...f.args,requestKey:uid(),mode:'lab',publicationEnabled:false,ownerHost:'macbook'});assert.equal(lab.ownerHost,'macbook');
 assert.throws(()=>f.s.lineCreate({...f.args,requestKey:uid(),mode:'lab'}),/Publication needs/);
});
test('projects pin recipe and computer; pause blocks new jobs without cancelling accepted work',t=>{
 const f=setup(t),p=project(f.s,f.line),j=f.s.begin(p.id,{requestKey:uid()});assert.equal(j.computeTarget,'linux');assert.equal(j.lineGeneration,1);
 f.s.lineStatus({lineId:f.line.id,expectedRevision:1,status:'paused'});
 assert.equal(f.s.get(p.id).jobs[0].status,'starting');
 const second=project(f.s,f.line);assert.throws(()=>f.s.begin(second.id,{requestKey:uid()}),/paused/);
 assert.throws(()=>f.s.lineStatus({lineId:f.line.id,expectedRevision:1,status:'active'}),/changed/);
 f.s.tx(s=>{s.templates[0].instructions='new rules';return null;});assert.equal(project(f.s,f.line).template.instructions,f.line.recipe.template.instructions);
 assert.throws(()=>f.s.targets(p.id,{},f.s.get(p.id).revision),/channel assigned/);
});
test('assignment preserves accepted media and refuses reassignment or uncertain external effects',t=>{
 const f=setup(t),p=f.s.create({requestKey:uid(),title:'Existing',idea:'An existing film',templateId:'kinetic',model:'gpt-6.1-sol',effort:'xhigh',duration:30,language:'en'}),v=master(f.s,p);
 f.s.lineAssign({lineId:f.line.id,expectedLineRevision:1,projectId:p.id,expectedRevision:f.s.get(p.id).revision});assert.equal(f.s.get(p.id).versions[0].sha256,v.sha256);
 const lab=f.s.lineCreate({...f.args,requestKey:uid(),mode:'lab',publicationEnabled:false});assert.throws(()=>f.s.lineAssign({lineId:lab.id,expectedLineRevision:1,projectId:p.id,expectedRevision:f.s.get(p.id).revision}),/already belongs/);
});
test('queue reorder requires exact pending set and stable revision',t=>{
 const f=setup(t),a=project(f.s,f.line),b=project(f.s,f.line);f.s.lineReorder({lineId:f.line.id,expectedRevision:1,projectIds:[b.id,a.id]});assert.equal(f.s.get(b.id).queuePosition,1);
 assert.throws(()=>f.s.lineReorder({lineId:f.line.id,expectedRevision:1,projectIds:[a.id,b.id]}),/changed/);
 assert.throws(()=>f.s.lineReorder({lineId:f.line.id,expectedRevision:2,projectIds:[a.id,a.id]}),/queue changed/);
});
test('claim has no expiry, enforces owner/generation and serializes external effects',t=>{
 const f=setup(t),p=project(f.s,f.line),v=master(f.s,p),a=attempt(f.s,p,v,f.c);f.s.lineEnqueueAttempt(a.id);
 assert.equal(f.s.lineEnqueueAttempt(a.id).reused,true);
 const args={...f.worker,kind:'publication',id:a.id,requestKey:uid()};
 assert.throws(()=>f.s.lineClaim({...args,ownerHost:'macbook'}),/no longer owns/);
 assert.throws(()=>f.s.lineClaim({...args,generation:2}),/no longer owns/);
 const claim=f.s.lineClaim(args);assert.equal(f.s.lineClaim(args).execution.token,claim.execution.token);
 assert.throws(()=>f.s.lineClaim({...args,requestKey:uid()}),/already claimed/);
 assert.throws(()=>assertExecution(f.s.read(),f.s.read().attempts[0],uid()),/Claim/);
 assertExecution(f.s.read(),f.s.read().attempts[0],claim.execution.token);
 const p2=project(f.s,f.line),v2=master(f.s,p2),a2=attempt(f.s,p2,v2,f.c);f.s.lineEnqueueAttempt(a2.id);
 assert.throws(()=>f.s.lineClaim({...f.worker,kind:'publication',id:a2.id,requestKey:uid()}),/current action/);
});
test('operations distinguishes reported/stale/unknown and counts only verified public releases',t=>{
 const f=setup(t),past=new Date(Date.now()-3*3600000).toISOString();f.s.lineReport({...f.worker,observedAt:past,stage:'Blocked',nextAction:'Repair native scheduler',blocker:'Missing source rollout'});
 let op=operationsSnapshot(f.s.public(),{targets:[{id:'linux',available:true}]});assert.equal(op.hosts[0].status,'unknown');assert.equal(op.directions[0].freshness,'stale');assert.equal(op.directions[0].observation.scheduler,undefined);
 f.s.tx(s=>{s.attempts.push({id:uid(),status:'scheduled',effect:'delivered_unverified'},{id:uid(),status:'published',effect:'delivered_unverified'},{id:uid(),status:'published',effect:'independently_verified',url:'https://youtube.com/shorts/abcdefghijk'});return null;});op=operationsSnapshot(f.s.public(),null);assert.equal(op.totals.verifiedPublications,1);assert.equal(op.audienceAnalytics.status,'not_connected');
 assert.throws(()=>f.s.lineReport({...f.worker,generation:2,observedAt:new Date().toISOString(),stage:'Idle',nextAction:'Wait'}),/owns/);
});
test('managed publication queues on its Linux owner and rejects legacy dispatch and unclaimed result',async t=>{
 const f=setup(t),p=project(f.s,f.line),v=master(f.s,p),calls=[];
 const app=await createStudio({home:f.home,runtime:{computeState:()=>({target:'macbook',targets:[]}),start:async()=>calls.push('start'),close:async()=>{}}});t.after(()=>app.close());
 const r=await app.invoke('reel_browser_prepare',{projectId:p.id,versionId:v.id,channel:'youtube',connectionId:f.c.id});assert.equal(r.isError,undefined);assert.equal(r.structuredContent.queued,true);assert.equal(r.structuredContent.prompt,undefined);const a=r.structuredContent.attempt;assert.equal(a.execution.ownerHost,'linux');
 assert.equal((await app.invoke('reel_dispatch_record',{attemptId:a.id,status:'sending'})).isError,true);
 assert.equal((await app.invoke('reel_publication_result',{attemptId:a.id,status:'uploading',effect:'possibly_delivered',receipt:'Upload started in native browser'})).isError,true);
 const claim=await app.invoke('reel_line_claim',{...f.worker,kind:'publication',id:a.id,requestKey:uid()});assert.equal(claim.isError,undefined);
 const recorded=await app.invoke('reel_publication_result',{attemptId:a.id,executionToken:claim.structuredContent.claim.execution.token,status:'uploading',effect:'possibly_delivered',receipt:'Upload started in native browser'});assert.equal(recorded.isError,undefined);
 assert.deepEqual(calls,[]);
 assert.equal((await app.invoke('reel_generate',{projectId:p.id,requestKey:uid()})).isError,true);
});
test('release plan queue uses one owner and cannot be dispatched or claimed as individual items',async t=>{
 const f=setup(t),p=project(f.s,f.line),v=master(f.s,p),app=await createStudio({home:f.home,runtime:{computeState:()=>({target:'macbook',targets:[]}),close:async()=>{}}});t.after(()=>app.close());
 const created=await app.invoke('reel_release_plan_create',{requestKey:uid(),connectionId:f.c.id,startsAt:new Date(Date.now()+3600000).toISOString(),timezone:'UTC',intervalMinutes:60,items:[{projectId:p.id,versionId:v.id,sha256:v.sha256,expectedRevision:f.s.get(p.id).revision}]});assert.equal(created.isError,undefined);
 const planId=created.structuredContent.plan.id;assert.equal((await app.invoke('reel_release_plan_approve',{planId})).isError,undefined);
 const r=await app.invoke('reel_release_plan_dispatch_prepare',{planId});assert.equal(r.isError,undefined);assert.equal(r.structuredContent.queued,true);assert.equal(r.structuredContent.prompt,undefined);
 assert.equal((await app.invoke('reel_release_plan_dispatch_record',{planId,status:'sending'})).isError,true);
 const plan=f.s.releasePlanRead(planId);assert.throws(()=>f.s.lineClaim({...f.worker,kind:'publication',id:plan.items[0].attemptId,requestKey:uid()}),/not assigned/);
 const claim=f.s.lineClaim({...f.worker,kind:'release_plan',id:planId,requestKey:uid()});assert.equal(f.s.publicationJob(plan.items[0].attemptId).attempt.execution.token,claim.execution.token);
});
