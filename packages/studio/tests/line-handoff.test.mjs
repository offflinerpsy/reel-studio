import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as uid} from 'node:crypto';
import {StudioStore,digest} from '../server/store.mjs';
import {ownerTuple} from '../server/owner-authority.mjs';

const fp=n=>digest(String(n));
const input=()=>({requestKey:uid(),title:'A new topic',idea:'Explain a new topic',templateId:'kinetic',model:'gpt-6.1-sol',effort:'xhigh',duration:30,language:'en'});
function createCAS(f,{profileId}={}){const state=f.s.read(),line=state.productionLines.find(x=>x.id===f.line.id),profile=profileId?state.profiles.find(x=>x.id===profileId):line.recipe.profile;return {expectedLineRevision:line.revision,...(profile?{expectedProfileRevision:profile.revision}:{})};}
function fixture(t,{verifier=true}={}){
 const home=mkdtempSync(join(tmpdir(),'reel-handoff-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const calls=[],f={home,calls};
 const s=f.s=new StudioStore(home,{authorityVerifier:verifier?context=>{
  assert.equal(existsSync(join(home,'.write-lock')),true,'authority runs under the existing Store lock');calls.push(context.purpose);
  const {purpose,request:a,requestFingerprint,stateFingerprint,line}=context;
  const proof={purpose,requestFingerprint,stateFingerprint,verifiedAt:new Date().toISOString(),owner:ownerTuple(line),runtime:line.ownerRuntime,settled:true};
  if(purpose==='line_handoff')Object.assign(proof,{
   source:{lineId:line.id,generation:line.generation,ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,
    scheduler:{id:'existing-source-hourly',host:line.ownerHost,ownerThreadId:line.ownerThreadId,status:'paused',fingerprint:a.evidence.scheduler},
    currentTurn:{status:'settled',fingerprint:a.evidence.currentTurn},workers:{status:'settled',active:0,fingerprint:a.evidence.workers},effects:{status:'resolved',fingerprint:a.evidence.effects}},
   target:{status:'ready',owner:a.nextOwner,fingerprint:a.evidence.target},manifest:{status:'verified',fingerprint:a.evidence.manifest}
  });
  if(purpose==='external_job_reconcile')proof.reconciliation={jobId:a.jobId,status:a.status,effect:a.effect,resultFingerprint:a.resultFingerprint,receiptFingerprint:a.receiptFingerprint};
  return f.override?f.override(proof,context):proof;
 }:undefined});
 const c=f.c=s.addAccount({channel:'youtube',account:'UC1234567890123456789012',label:'Channel',method:'browser'});
 s.connection('youtube',{connectionId:c.id,account:c.account,profileName:'Existing Linux Chrome'});
 f.line=s.lineCreate({requestKey:uid(),name:'Science',connectionId:c.id,mode:'production',ownerHost:'linux',ownerThreadId:uid(),templateId:'kinetic',publicationEnabled:true});
 f.source=ownerTuple(f.line);
 f.next={ownerHost:'linux',ownerThreadId:uid(),runtime:{kind:'bb',bbThreadId:'thr_fixture_successor1',nativeThreadId:null,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:'/fixture/workspace/project'}};
 f.next.runtime.nativeThreadId=f.next.ownerThreadId;
 f.args=()=>{const read=s.lineHandoffRead({lineId:f.line.id});return {lineId:f.line.id,transferId:uid(),expectedRevision:read.revision,expectedGeneration:read.generation,expectedOwner:read.owner,expectedStateFingerprint:read.stateFingerprint,nextOwner:structuredClone(f.next),evidence:Object.fromEntries(['scheduler','currentTurn','workers','effects','target','manifest'].map(k=>[k,fp(k)]))};};
 f.pause=()=>s.lineStatus({lineId:f.line.id,expectedRevision:s.lineHandoffRead({lineId:f.line.id}).revision,status:'paused'});
 f.transfer=()=>{f.pause();f.receipt=s.lineHandoff(f.args());f.owner=ownerTuple(s.read().productionLines[0]);return f.receipt;};
 f.resume=()=>s.lineStatus({lineId:f.line.id,expectedRevision:s.lineHandoffRead({lineId:f.line.id}).revision,status:'active'});
 return f;
}
function historical(f,count=25){
 const {s,line,c}=f;
 for(let i=0;i<count;i++){
  const p=s.create({...input(),productionLineId:line.id});
  s.tx(state=>{const project=state.projects.find(x=>x.id===p.id);project.status='published';project.versions.push({id:uid(),sha256:fp(i),approval:{sha256:fp(i)}});project.jobs.push({id:uid(),status:'completed',lineId:line.id,lineGeneration:1,computeTarget:'linux'});state.attempts.push({id:uid(),projectId:p.id,connectionId:c.id,status:'published',effect:'independently_verified',execution:{...f.source,status:'claimed',token:uid(),requestKey:uid(),claimedAt:'2001-01-01T00:00:00.000Z'}});return null;});
 }
}
test('same-line CAS preserves all 25 terminal histories and honest native/BB identities',t=>{
 const f=fixture(t);historical(f);const before=f.s.read();f.pause();const a=f.args(),r=f.s.lineHandoff(a),after=f.s.read(),line=after.productionLines[0];
 assert.equal(line.id,f.line.id);assert.equal(line.generation,2);assert.equal(line.revision,3);assert.equal(line.status,'paused');assert.equal(line.ownerThreadId,f.next.ownerThreadId);assert.equal(line.ownerRuntime.bbThreadId,'thr_fixture_successor1');
 for(const key of ['projects','attempts','releasePlans','accounts','templates','profiles'])assert.deepEqual(after[key],before[key],key+' stays unchanged');
 for(const key of ['recipe','connectionId','channel','target','publicationEnabled'])assert.deepEqual(line[key],before.productionLines[0][key]);
 assert.deepEqual(r.previousOwner,f.source);assert.equal(r.nextOwner.generation,2);assert.equal(r.nextOwner.ownerThreadId,f.next.ownerThreadId);assert.equal(r.sourceStateFingerprint,a.expectedStateFingerprint);
 assert.deepEqual(f.s.lineHandoffRead({lineId:line.id,transferId:a.transferId}).receipt,r);
 assert.throws(()=>f.s.lineNext(f.source),/no longer owns/);assert.equal(f.s.lineNext(ownerTuple(line)).projects.length,25);
 assert.throws(()=>f.s.lineReport({...f.source,observedAt:new Date().toISOString(),stage:'Old owner',nextAction:'Advance'}),/no longer owns/);
 assert.throws(()=>f.s.lineClaim({...f.source,kind:'publication',id:before.attempts[0].id,requestKey:uid()}),/no longer owns/);
});
test('transfer replay is payload-bound, survives a lost response/restart and never verifies or increments twice',t=>{
 const f=fixture(t);f.pause();const a=f.args(),r=f.s.lineHandoff(a);f.resume();
 assert.deepEqual(new StudioStore(f.home).lineHandoff(a),r);assert.equal(f.calls.filter(p=>p==='line_handoff').length,1);assert.equal(f.s.read().productionLines[0].generation,2);
 const reordered=Object.fromEntries(Object.entries(a).reverse());assert.deepEqual(f.s.lineHandoff(reordered),r);
 assert.throws(()=>f.s.lineHandoff({...a,evidence:{...a.evidence,manifest:fp('different')}}),/different payload/);
});
test('handoff rejects stale revision, owner, generation, and state fingerprint without changing state',t=>{
 const f=fixture(t);f.pause();const a=f.args(),before=f.s.read();
 for(const patch of [{expectedRevision:999},{expectedGeneration:999},{expectedOwner:{...a.expectedOwner,ownerThreadId:uid()}},{expectedOwner:{...a.expectedOwner,generation:2}},{expectedStateFingerprint:fp('stale')}])assert.throws(()=>f.s.lineHandoff({...a,...patch}),/changed|no longer owns/);
 assert.deepEqual(f.s.read(),before);
});
test('an observation update invalidates the captured handoff preimage even without a line revision change',t=>{
 const f=fixture(t);f.pause();const a=f.args();f.s.lineReport({...f.source,observedAt:new Date().toISOString(),stage:'Final source checkpoint',nextAction:'Wait for transfer'});
 assert.equal(f.s.lineHandoffRead({lineId:f.line.id}).revision,a.expectedRevision);assert.throws(()=>f.s.lineHandoff(a),/preimage changed/);
});
test('late callbacks from an old native generation and unresolved terminal job effects cannot advance ownership',t=>{
 const f=fixture(t),p=f.s.create({...input(),productionLineId:f.line.id}),j=f.s.begin(p.id,{requestKey:uid()}),file=join(j.dir,'film.mp4');writeFileSync(file,'master');f.s.addVersion(p.id,j.id,{path:file,media:{duration:1}});f.transfer();const before=f.s.read();
 assert.throws(()=>f.s.job(p.id,j.id,{status:'running'}),/previous production generation/);assert.throws(()=>f.s.event(p.id,j.id,{type:'late'}),/cannot advance/);assert.throws(()=>f.s.addVersion(p.id,j.id,{path:file,media:{duration:1}}),/cannot advance/);assert.deepEqual(f.s.read(),before);
 const g=fixture(t),q=g.s.create({...input(),productionLineId:g.line.id});g.s.tx(s=>{s.projects.find(p=>p.id===q.id).jobs.push({id:uid(),status:'failed',external:{effect:'possibly_delivered'}});return null;});g.pause();assert.throws(()=>g.s.lineHandoff(g.args()),/unresolved external job effect/);
});
test('handoff refuses active lines, active/uncertain jobs, pending plans and unresolved effects regardless of age',t=>{
 const f=fixture(t),p=f.s.create({...input(),productionLineId:f.line.id});assert.throws(()=>f.s.lineHandoff(f.args()),/Pause/);
 const j=f.s.begin(p.id,{requestKey:uid()});f.pause();assert.throws(()=>f.s.lineHandoff(f.args()),/active or uncertain/);
 f.s.job(p.id,j.id,{status:'uncertain',startedAt:'2001-01-01T00:00:00.000Z'});assert.throws(()=>f.s.lineHandoff(f.args()),/active or uncertain/);
 f.s.job(p.id,j.id,{status:'failed'});f.s.tx(s=>{s.attempts.push({id:uid(),projectId:p.id,status:'published',effect:'delivered_unverified',execution:{...f.source,status:'claimed'}});return null;});assert.throws(()=>f.s.lineHandoff(f.args()),/unresolved publication/);
 f.s.tx(s=>{s.attempts[0].effect='independently_verified';s.releasePlans.push({id:uid(),status:'approved',items:[{projectId:p.id,attemptId:s.attempts[0].id}],execution:{...f.source,status:'queued'}});return null;});assert.throws(()=>f.s.lineHandoff(f.args()),/unresolved release plan/);
});
test('handoff fails closed with no verifier, async/stale proof or caller-provided safety flags',t=>{
 const f=fixture(t,{verifier:false});f.pause();const a=f.args(),before=f.s.read();
 assert.throws(()=>f.s.lineHandoff({...a,schedulerPaused:true,sourceSettled:true}),/trusted server/);assert.deepEqual(f.s.read(),before);
 f.s.authorityVerifier=async()=>({});assert.throws(()=>f.s.lineHandoff(a),/synchronously/);
 const g=fixture(t);g.pause();g.override=p=>({...p,verifiedAt:'2001-01-01T00:00:00Z'});assert.throws(()=>g.s.lineHandoff(g.args()),/stale/);
});
test('trusted verifier must establish exact scheduler/current turn/workers/effects/target/manifest',t=>{
 const f=fixture(t);f.pause();
 const invalid=[p=>{p.source.scheduler.status='active';},p=>{p.source.scheduler.ownerThreadId=uid();},p=>{p.source.currentTurn.status='inProgress';},p=>{p.source.workers.active=1;},p=>{p.source.effects.status='possibly_delivered';},p=>{p.target.owner.runtime.cwd='/wrong';},p=>{p.manifest.fingerprint=fp('different');},p=>{p.requestFingerprint=fp('other request');}];
 const before=f.s.read();for(const invalidate of invalid){f.override=p=>{invalidate(p);return p;};assert.throws(()=>f.s.lineHandoff(f.args()),/not |settled|reconciled|missing|match/);assert.deepEqual(f.s.read(),before);}
});
test('handoff rejects fabricated native identity and legacy model metadata',t=>{
 const f=fixture(t);f.pause();
 for(const change of [n=>{n.ownerThreadId='thr_fixture_fake_native';},n=>{n.ownerThreadId=f.source.ownerThreadId;n.runtime.nativeThreadId=n.ownerThreadId;},n=>{n.runtime.model='gpt-5.6-luna';},n=>{n.runtime.effort='medium';},n=>{n.runtime.serviceTier='unrecognized-tier';},n=>{n.runtime.nativeThreadId=uid();}]){const a=f.args();change(a.nextOwner);assert.throws(()=>f.s.lineHandoff(a),/verified BB|own native/);}
});
test('managed reservations/imports/job starts reject missing/stale owners and missing trusted runtime; legacy remains usable',t=>{
 const f=fixture(t),old=f.s.create({...input(),productionLineId:f.line.id}),source=join(f.home,'source.mp4');writeFileSync(source,'existing master');
 const artifact={requestKey:uid(),path:source,sourceDir:f.home,sha256:fp('existing master'),media:{duration:1},metadata:{title:'Existing'}};
 const v=f.s.importVersion(old.id,artifact,old.revision);f.transfer();f.resume();
 for(const owner of [undefined,f.source,{...f.owner,bbThreadId:'thr_fixture_wrong'}]){
  assert.throws(()=>f.s.create({...input(),productionLineId:f.line.id,owner}),/no longer owns/);
  assert.throws(()=>f.s.begin(old.id,{requestKey:uid(),owner}),/no longer owns/);
  assert.throws(()=>f.s.importVersion(old.id,{...artifact,owner},old.revision),/no longer owns/);
 }
 const restarted=new StudioStore(f.home);assert.throws(()=>restarted.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner}),/trusted server/);
 const imported=f.s.importVersion(old.id,{...artifact,owner:f.owner},old.revision);assert.equal(imported.id,v.id);assert.equal(imported.reused,true);
 const newP=f.s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner});assert.equal(newP.lineGeneration,2);
 const independent=f.s.create(input());assert.ok(f.s.begin(independent.id,{requestKey:uid(),computeTarget:'macbook'}));
});
function externalArgs(f,p){return {projectId:p.id,requestKey:uid(),owner:f.owner,bbThreadId:f.owner.bbThreadId,operation:'produce_episode',inputFingerprint:fp('exact brief')};}
function resultArgs(f,p,j,patch={}){return {projectId:p.id,jobId:j.id,requestKey:uid(),owner:f.owner,status:'completed',effect:'independently_verified',resultFingerprint:fp('output'),receiptFingerprint:fp('receipt'),...patch};}
test('native and BB share the original durable host slot across Store instances in both directions',t=>{
 const f=fixture(t);f.transfer();f.resume();const managed=f.s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner}),native=f.s.create({...input(),computeTarget:'linux'}),mac=f.s.create({...input(),computeTarget:'macbook'}),args=externalArgs(f,managed),j=f.s.externalJobBegin(args);
 assert.equal(f.s.get(managed.id).jobs.length,1);assert.equal(j.computeTarget,'linux');assert.equal(j.lineGeneration,2);assert.equal(j.ownerPid,undefined);assert.equal(j.external.owner.ownerThreadId,f.next.ownerThreadId);
 assert.equal(f.s.externalJobBegin(args).id,j.id);assert.throws(()=>f.s.externalJobBegin({...args,inputFingerprint:fp('changed')}),/different payload/);
 assert.throws(()=>new StudioStore(f.home).begin(native.id,{requestKey:uid()}),/already active/);assert.ok(f.s.begin(mac.id,{requestKey:uid()}));
 const result=resultArgs(f,managed,j);f.s.externalJobResult(result);assert.deepEqual(f.s.externalJobResult(result),f.s.get(managed.id).jobs[0].external.transitions[0]);
 const nj=new StudioStore(f.home).begin(native.id,{requestKey:uid()});assert.throws(()=>f.s.externalJobBegin({...args,requestKey:uid()}),/already active/);
 f.s.job(native.id,nj.id,{status:'failed'});assert.equal(f.s.externalJobBegin(args).status,'completed');assert.equal(f.s.get(managed.id).jobs.length,1,'terminal request is read, never relaunched');
 assert.throws(()=>f.s.externalJobResult(resultArgs(f,managed,j)),/terminal/);
});
test('uncertain external work has no expiry; only trusted same-job reconciliation releases admission',t=>{
 const f=fixture(t);f.transfer();f.resume();const p=f.s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner}),args=externalArgs(f,p),j=f.s.externalJobBegin(args),native=f.s.create({...input(),computeTarget:'linux'});
 const uncertain=resultArgs(f,p,j,{status:'uncertain',effect:'possibly_delivered'});f.s.externalJobResult(uncertain);
 const before=f.s.get(p.id).jobs;new StudioStore(f.home).recover();assert.deepEqual(f.s.get(p.id).jobs,before,'process recovery never expires external BB work');
 assert.throws(()=>f.s.job(p.id,j.id,{status:'failed'}),/bounded external/);
 assert.throws(()=>f.s.begin(native.id,{requestKey:uid()}),/already active/);assert.throws(()=>f.s.externalJobResult(resultArgs(f,p,j)),/Reconcile/);
 const failed=resultArgs(f,p,j,{status:'failed',effect:'not_delivered'});
 f.override=proof=>({...proof,settled:false});assert.throws(()=>f.s.externalJobReconcile(failed),/cannot release/);
 f.override=proof=>({...proof,reconciliation:{...proof.reconciliation,jobId:uid()}});assert.throws(()=>f.s.externalJobReconcile(failed),/same-job/);
 f.override=null;f.s.externalJobReconcile(failed);assert.ok(f.s.begin(native.id,{requestKey:uid()}));assert.equal(f.s.externalJobBegin(args).id,j.id);
 assert.throws(()=>f.s.externalJobReconcile({...failed,receiptFingerprint:fp('changed')}),/different payload/);
});
test('an unverified result, stale runtime or wrong BB/native owner cannot clear an external host slot',t=>{
 const f=fixture(t);f.transfer();f.resume();const p=f.s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner}),j=f.s.externalJobBegin(externalArgs(f,p));
 assert.throws(()=>f.s.externalJobResult(resultArgs(f,p,j,{effect:'delivered_unverified'})),/cannot release/);
 assert.throws(()=>f.s.externalJobResult(resultArgs(f,p,j,{owner:f.source})),/no longer owns/);
 f.override=proof=>({...proof,runtime:{...proof.runtime,nativeThreadId:uid()}});assert.throws(()=>f.s.externalJobResult(resultArgs(f,p,j)),/runtime no longer matches/);
 assert.equal(f.s.get(p.id).jobs[0].status,'running');
});
