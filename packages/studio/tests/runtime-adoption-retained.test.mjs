import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioStore} from '../server/store.mjs';
import {createSourceHostAuthorityVerifier} from '../server/owner-host/authority-verifier.mjs';
import {readFileSync} from 'node:fs';
import {authorityHash,ownerTuple} from '../server/owner-authority.mjs';
import {adoptLineRuntime} from '../server/runtime-adoption.mjs';
import {sha,uid,python,json,retainedFixture} from './runtime-adoption-fixtures.mjs';

test('Sol/xhigh/Fast adoption retains only the proven completed local worker and all uncertainty bytes',t=>{
 const f=retainedFixture(t),before=f.store.read(),request=f.request();f.install();
 const nativeBytes=Object.fromEntries(['threadsDb','historyDb','queueDb','scheduleDb'].map(k=>[k,sha(readFileSync(f.paths[k]))]));
 const verify=f.store.authorityVerifier;let proof;f.store.authorityVerifier=input=>(proof=verify(input));
 const receipt=adoptLineRuntime(f.store,request),after=f.store.read(),line=after.productionLines[0];
 assert.equal(line.ownerRuntime.model,'gpt-6.1-sol');assert.equal(line.ownerRuntime.effort,'xhigh');assert.equal(line.ownerRuntime.serviceTier,'fast');assert.equal(line.generation,2);
 assert.equal(receipt.evidence.retainedJobFingerprint,authorityHash(proof.retainedJob));assert.equal(proof.retainedJob.jobFingerprint,authorityHash(f.job));
 assert.deepEqual(after.projects,before.projects);assert.deepEqual(line.handoffs,before.productionLines[0].handoffs);assert.deepEqual(line.runtimeAdoptions.slice(0,-1),before.productionLines[0].runtimeAdoptions);
 for(const k of Object.keys(before).filter(k=>!['productionLines','revision','updatedAt'].includes(k)))assert.deepEqual(after[k],before[k],k);
 for(const [k,hash]of Object.entries(nativeBytes))assert.equal(sha(readFileSync(f.paths[k])),hash,k);
 assert.equal(f.store.nativeJobRead(f.projectId,f.jobId).job.status,'uncertain');assert.equal(f.store.nativeJobRead(f.projectId,f.jobId).job.execution.serviceTier,'standard');
 const committed=readFileSync(f.store.path,'utf8');assert.deepEqual(adoptLineRuntime(new StudioStore(f.home),request),receipt);assert.equal(readFileSync(f.store.path,'utf8'),committed);
 assert.throws(()=>adoptLineRuntime(new StudioStore(f.home),{...request,retainedJobId:uid()}),/different payload/);assert.equal(readFileSync(f.store.path,'utf8'),committed);
 // Current selected coordinator authority can read/reconcile the old standard
 // worker. It cannot launch a Fast worker through the default-tier adapter.
 json(f.configPath,f.candidate);f.store.authorityVerifier=createSourceHostAuthorityVerifier({configPath:f.configPath,python});
 const owner=ownerTuple(line),admission=f.store.projectAdmission(f.projectId,owner,'line_reconcile',{owner,projectId:f.projectId,jobId:f.jobId});
 assert.equal(admission.runtime.serviceTier,'fast');assert.deepEqual(f.store.nativeJobRead(f.projectId,f.jobId).job,f.job);
 for(const execution of [f.nextRuntime,undefined])assert.throws(()=>f.store.begin(f.projectId,{requestKey:uid(),owner,execution,expectedRevision:after.projects[0].revision,kind:'video'}),/does not support the selected Fast tier/);
 assert.equal(readFileSync(f.store.path,'utf8'),committed);
});

test('the default boundary still refuses the uncertain job and retirement cannot request an exception',t=>{
 const f=retainedFixture(t);f.install();const before=readFileSync(f.store.path,'utf8'),request=f.request();delete request.retainedJobId;
 assert.throws(()=>adoptLineRuntime(f.store,request),/active or uncertain/);
 assert.throws(()=>f.store.authorityVerifier(f.context('line_request_retire',{...f.retirement(),retainedJobId:f.jobId})),/only runtime adoption/);
 assert.equal(readFileSync(f.store.path,'utf8'),before);
});

test('a retained reference cannot exempt foreign, active, external, changed or ambiguous admissions',t=>{
 const changes=[
  s=>s.projects[0].jobs.at(-1).status='running',s=>s.projects[0].jobs.at(-1).status='starting',s=>s.projects[0].jobs.at(-1).status='cancel_requested',
  s=>s.projects[0].jobs.at(-1).external={effect:'possibly_delivered'},s=>s.projects[0].jobs.at(-1).lineGeneration=1,
  s=>s.projects[0].jobs.at(-1).lineOwner.ownerThreadId=uid(),s=>s.projects[0].jobs.at(-1).computeTarget='macbook',
  s=>s.projects[0].jobs.at(-1).execution.effort='max',s=>s.projects[0].jobs.at(-1).model='gpt-6.1-sol',
  s=>s.projects[0].jobs.at(-1).threadId=s.productionLines[0].ownerThreadId,s=>s.projects[0].jobs.at(-1).executorThreadId=uid(),
  s=>s.projects[0].jobs.at(-1).versionId=uid(),s=>s.projects[0].jobs.at(-1).executionPayloadHash='bad',
  s=>s.projects.push({id:uid(),jobs:[structuredClone(s.projects[0].jobs.at(-1))]})
 ];
 for(const change of changes){const f=retainedFixture(t);f.store.tx(change);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/retained/);assert.equal(readFileSync(f.store.path,'utf8'),before);assert.equal(f.calls().length,0);}
 for(const retainedJobId of ['not-a-uuid',uid(),null]){const f=retainedFixture(t);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,{...f.request(),retainedJobId}),/retained/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('the retained exception leaves other line/host jobs and all publication effects blocking',t=>{
 const changes=[s=>s.projects[0].jobs.push({id:uid(),status:'uncertain',computeTarget:'linux'}),s=>s.projects.push({id:uid(),jobs:[{id:uid(),status:'running',computeTarget:'linux'}]}),s=>s.projects.push({id:uid(),jobs:[{id:uid(),status:'uncertain'}]}),s=>s.projects[0].jobs.push({id:uid(),status:'failed',external:{effect:'possibly_delivered'}}),s=>s.attempts.push({id:uid(),projectId:s.projects[0].id,status:'published',effect:'delivered_unverified'}),s=>s.releasePlans.push({id:uid(),status:'approved',items:[{projectId:s.projects[0].id}]})];
 for(const change of changes){const f=retainedFixture(t);f.store.tx(change);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/active|unresolved|uncertain/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('independent retained worker proof requires exact completed turn, Studio origin, original runtime/cwd and an empty tree queue',t=>{
 const changes=[
  f=>f.nativeChange('UPDATE threads SET originator=? WHERE id=?',['bb',f.worker]),
  f=>f.nativeChange('UPDATE threads SET cwd=? WHERE id=?',['/another-job',f.worker]),
  f=>f.nativeChange('UPDATE threads SET model=? WHERE id=?',['gpt-6.1-sol',f.worker]),
  f=>f.dbChange('historyDb','UPDATE thread_turns SET status=?,completed_at=NULL WHERE thread_id=?',['inProgress',f.worker]),
  f=>f.dbChange('historyDb','UPDATE thread_turns SET turn_id=? WHERE thread_id=?',[uid(),f.worker]),
  f=>f.dbChange('queueDb','INSERT INTO queued_items VALUES(?,?,?,?,?)',[uid(),f.worker,1,1,1]),
  f=>f.store.tx(s=>{s.projects[0].jobs.at(-1).dir=f.home;}),
  f=>{const child=uid();f.nativeChange('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)',[child,'openai','gpt-6.1-terra','ultra','never','{"type":"disabled"}',f.job.dir,'reel-studio',JSON.stringify({subagent:{thread_spawn:{parent_thread_id:f.worker}}})]);f.dbChange('historyDb','INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)',[child,uid(),'inProgress',1,null,null,1]);},
  f=>{const child=uid();f.nativeChange('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)',[child,'openai','gpt-6.1-terra','ultra','never','{"type":"disabled"}',f.job.dir,'reel-studio',JSON.stringify({subagent:{thread_spawn:{parent_thread_id:f.worker}}})]);f.dbChange('historyDb','INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)',[child,uid(),'completed',1,2,1,1]);f.dbChange('queueDb','INSERT INTO queued_items VALUES(?,?,?,?,?)',[uid(),child,1,1,1]);}
 ];
 for(const change of changes){const f=retainedFixture(t);change(f);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/retained|native model|native access/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('retained worker state changing during the final BB snapshot fails before adoption',t=>{
 const f=retainedFixture(t);f.snapshot.finalNativeChange={path:f.paths.historyDb,sql:'UPDATE thread_turns SET status=?,completed_at=NULL WHERE thread_id=?',args:['inProgress',f.worker]};f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');
 assert.throws(()=>adoptLineRuntime(f.store,f.request()),/retained native worker/);assert.equal(readFileSync(f.store.path,'utf8'),before);
});

test('retained job evidence is mandatory, exact and hash bound before any adoption write',t=>{
 const changes=[proof=>delete proof.retainedJob,proof=>proof.retainedJob.jobId=uid(),proof=>proof.retainedJob.jobFingerprint=authorityHash('different job'),proof=>proof.retainedJob.nativeFingerprint='bad',proof=>delete proof.evidence.retainedJobFingerprint,proof=>proof.evidence.retainedJobFingerprint=authorityHash('different proof')];
 for(const change of changes){const f=retainedFixture(t);f.install();const verify=f.store.authorityVerifier;f.store.authorityVerifier=input=>{const proof=verify(input);change(proof);return proof;};const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/terminal local job evidence/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('Fast adoption is rejected when accepted defaults or pinned request tier differs',t=>{
 for(const change of [f=>f.snapshot.acceptedDefaults.serviceTier='default',f=>f.snapshot.events[0].data.execution.serviceTier='default']){const f=retainedFixture(t);change(f);f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/defaults|selection/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});
