import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StudioStore,digest} from '../server/store.mjs';
import {assertAdmission,authorityHash,fingerprint,lineStateFingerprint,ownerTuple,uuid,validateBBRuntime} from '../server/owner-authority.mjs';
import {assertLineActive,lineForProject} from '../server/production-lines.mjs';
import {reconcileManagedRequest} from '../server/request-reconciliation.mjs';

const clone=x=>structuredClone(x),now=()=>new Date().toISOString();

// Retained pre-retirement Store.begin. Keep this compatibility fixture independent
// of the new receipt check: the old, already loaded controller knows only its CAS.
function legacyBegin(id,a){const {requestKey,feedback='',kind='video',versionId,research,computeTarget,owner,external,execution}=a;return this.mutate(id,(p,s)=>{
 const line=lineForProject(s,p),proof=assertAdmission(this,s,line,owner,'line_begin_job',{projectId:id,...a});
 const payloadHash=external||execution?authorityHash({projectId:id,...a}):null;
 if(external){
  if(!line?.admissionVersion||!uuid(requestKey)||external.bbThreadId!==line.ownerRuntime?.bbThreadId||!fingerprint(external.inputFingerprint)||typeof external.operation!=='string'||external.operation.length<1||external.operation.length>80)throw new Error('External BB work requires the transferred line owner and bounded input fingerprint.');
 }
 if(execution){
  if(!line?.admissionVersion||external)throw new Error('A job execution override is supported only for the transferred managed native producer.');
  validateBBRuntime({ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,runtime:execution});
  if(authorityHash(execution)!==authorityHash(line.ownerRuntime)||authorityHash(proof?.execution)!==authorityHash(execution))throw new Error('The trusted producer execution route does not match the current direction owner.');
 }
 const existing=p.jobs.find(j=>j.requestKey===requestKey);
 if(existing){if(Boolean(existing.external)!==Boolean(external)||Boolean(existing.execution)!==Boolean(execution)||external&&existing.external.payloadHash!==payloadHash||execution&&existing.executionPayloadHash!==payloadHash)throw new Error('This job request key belongs to a different payload.');return {...existing,reused:true};}
 assertLineActive(line);
 if(execution&&(a.expectedRevision!==p.revision||p.productionProfile&&a.expectedProfileRevision!==p.productionProfile.revision||!p.productionProfile&&a.expectedProfileRevision!==undefined))throw new Error('The project or frozen production profile changed. Refresh before admission.');
 if(!execution&&p.productionProfile&&(p.model!==p.productionProfile.model.name||p.effort!==p.productionProfile.model.effort))throw new Error('Selected model and effort must match the production profile');
 const target=line?.ownerHost||p.computeTarget||p.jobs.at(-1)?.computeTarget||computeTarget;
 if(s.projects.some(q=>q.jobs.some(j=>['starting','running','uncertain','cancel_requested'].includes(j.status)&&(q.id===p.id||!target||!j.computeTarget||j.computeTarget===target))))throw new Error('A job is already active on this computer or its host is unknown. Wait for completion or check its status.');
 if(target)p.computeTarget=target;
 const source=p.versions.find(v=>v.id===versionId)||p.versions.at(-1),job={id:randomUUID(),requestKey,feedback,kind,status:external?'running':'starting',startedAt:now(),events:[],...(external?{external:{...clone(external),payloadHash,owner:clone(owner),effect:'not_delivered',transitions:[]}}:{ownerPid:process.pid}),...(target?{computeTarget:target}:{}),...(line?{lineId:line.id,lineGeneration:line.generation,lineOwner:ownerTuple(line)}:{}),...(kind==='metadata'&&source?{sourceVersionId:source.id,sourceSha256:source.sha256,sourceMetadataHash:digest(source.metadata),sourceTargetsHash:digest(p.targets||{}),researchInput:research}: {})};
 if(execution)Object.assign(job,{execution:clone(execution),executionPayloadHash:payloadHash,model:execution.model,effort:execution.effort,modelProvider:execution.provider,requestedServiceTier:execution.serviceTier});
 job.dir=join(this.home,'jobs',job.id);mkdirSync(job.dir,{recursive:true});p.jobs.push(job);p.status='rendering';return job;
 });}

function fixture(t,{profile=false}={}){
 const home=mkdtempSync(join(tmpdir(),'reel-request-retirement-')),f={home,calls:[]};
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const verifier=context=>{
  assert.equal(existsSync(join(home,'.write-lock')),true,'trusted proof must run inside the original Store lock');
  f.calls.push(context.purpose);
  const {purpose,request:a,requestFingerprint,stateFingerprint,line}=context;
  const proof={purpose,requestFingerprint,stateFingerprint,verifiedAt:now(),owner:ownerTuple(line),runtime:line.ownerRuntime};
  if(purpose==='line_begin_job')proof.execution=a.execution;
  if(purpose==='line_request_retire')proof.retirement={operationId:a.operationId,projectId:a.projectId,requestKey:a.requestKey,originalArgsFingerprint:a.originalArgsFingerprint,expectedRevision:a.expectedRevision,expectedGeneration:a.expectedGeneration,legacyAdmission:'managed-project-cas-v1',legacyEntrySHA256:digest('reviewed old entry bundle')};
  return f.override?f.override(proof,context):proof;
 };
 const s=f.s=new StudioStore(home,{authorityVerifier:verifier}),native=randomUUID();
 const runtime={kind:'bb',bbThreadId:'thr_fixture_same_new58',nativeThreadId:native,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:'/fixture/workspace/project'};
 const line={id:randomUUID(),name:'Existing producer',revision:4,generation:2,status:'active',mode:'production',ownerHost:'linux',ownerThreadId:native,ownerRuntime:runtime,admissionVersion:1,handoffs:[{retained:'source handoff and manifest'}]};
 const project={id:randomUUID(),requestKey:randomUUID(),title:'Synthetic retained job',idea:'Continue existing voice and assets',revision:2,status:'draft',productionLineId:line.id,lineGeneration:2,computeTarget:'linux',model:'gpt-5.6-luna',effort:'medium',versions:[],uploads:[{id:randomUUID(),sha256:digest('accepted asset'),path:'/retained/asset.png'}],jobs:[],template:{id:'kinetic',name:'Existing recipe'},recipeSha256:digest('accepted recipe'),createdAt:'2026-10-28T00:00:00.000Z',updatedAt:'2026-10-28T00:00:00.000Z',...(profile?{productionProfile:{revision:7,model:{name:'gpt-5.6-luna',effort:'medium'},voice:{id:'existing-voice'}}}:{})};
 const unrelated={id:randomUUID(),revision:9,title:'Accepted other project',computeTarget:'macbook',versions:[{id:randomUUID(),sha256:digest('accepted master'),approval:{retained:true}}],uploads:[],jobs:[]};
 s.tx(state=>{state.productionLines.push(line);state.projects.push(project,unrelated);state.accounts.push({id:randomUUID(),account:'retained account'});return null;});
 f.line=line;f.project=project;f.unrelated=unrelated;f.owner=ownerTuple(line);
 f.original={owner:f.owner,projectId:project.id,requestKey:randomUUID(),expectedRevision:2,execution:runtime,kind:'video',feedback:'Reuse the existing voice and assets.',computeTarget:'linux',...(profile?{expectedProfileRevision:7}:{})};
 f.request=()=>({retirementId:randomUUID(),owner:clone(f.owner),projectId:project.id,requestKey:f.original.requestKey,expectedGeneration:2,expectedRevision:f.original.expectedRevision,originalArgs:clone(f.original),originalArgsFingerprint:authorityHash(f.original),operationId:digest('original unresolved remote operation'),expectedStateFingerprint:lineStateFingerprint(s.read(),s.read().productionLines[0])});
 f.a=f.request();
 return f;
}

const bytes=f=>readFileSync(f.s.path,'utf8');
function unchanged(f,fn,pattern){const before=bytes(f);assert.throws(fn,pattern);assert.equal(bytes(f),before);}

test('retirement atomically binds exact admission evidence and changes only its intended project fields',t=>{
 const f=fixture(t,{profile:true}),before=f.s.read(),result=reconcileManagedRequest(f.s,f.a),after=f.s.read(),receipt=result.receipt;
 assert.equal(result.outcome,'retired_no_admission');assert.equal(result.reused,false);
 assert.equal(receipt.status,'retired_no_admission');assert.equal(receipt.previousRevision,2);assert.equal(receipt.revision,3);assert.equal(receipt.generation,2);assert.equal(receipt.expectedProfileRevision,7);
 assert.equal(receipt.originalArgsFingerprint,authorityHash(f.original));assert.equal(receipt.operationId,f.a.operationId);assert.deepEqual(receipt.owner,f.owner);assert.deepEqual(receipt.execution,f.original.execution);
 assert.equal(receipt.legacyEntrySHA256,digest('reviewed old entry bundle'));
 assert.equal(after.projects[0].jobs.length,0);assert.equal(after.projects[0].revision,3);assert.deepEqual(after.projects[0].managedRequestRetirements,[receipt]);assert.deepEqual(f.calls,['line_request_retire']);
 const rest=clone(after);rest.revision=before.revision;rest.updatedAt=before.updatedAt;rest.projects[0].revision=before.projects[0].revision;rest.projects[0].updatedAt=before.projects[0].updatedAt;delete rest.projects[0].managedRequestRetirements;
 assert.deepEqual(rest,before,'accepted assets, profiles, handoffs, history and unrelated projects remain unchanged');
 assert.equal(Object.hasOwn(receipt,'effect'),false,'admission evidence does not rewrite historical transport delivery');
});

test('a retained generation-1 reservation can retire under its exact current generation-2 producer without changing its provenance',t=>{
 const f=fixture(t,{profile:true});f.s.tx(state=>{state.projects[0].lineGeneration=1;});f.a=f.request();
 const result=reconcileManagedRequest(f.s,f.a),saved=f.s.get(f.project.id);
 assert.equal(result.outcome,'retired_no_admission');assert.equal(result.receipt.generation,2);assert.equal(result.receipt.projectGenerationAtRetirement,1);
 assert.equal(saved.lineGeneration,1);assert.equal(saved.revision,3);assert.equal(saved.jobs.length,0);assert.deepEqual(f.calls,['line_request_retire']);
 const before=bytes(f),repeated=reconcileManagedRequest(f.s,f.a);assert.deepEqual(repeated.receipt,result.receipt);assert.equal(repeated.reused,true);assert.equal(bytes(f),before);
});

test('future or unknown reserved-project generations fail closed',t=>{
 for(const generation of [3,0,-1,undefined,1.5]){
  const f=fixture(t);f.s.tx(state=>{state.projects[0].lineGeneration=generation;});f.a=f.request();
  unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/production generation changed/);assert.deepEqual(f.calls,[]);
 }
});

test('same retirement packet reads its saved receipt without any revision or byte churn',t=>{
 const f=fixture(t),first=reconcileManagedRequest(f.s,f.a),before=bytes(f),second=reconcileManagedRequest(new StudioStore(f.home,{authorityVerifier:f.s.authorityVerifier}),f.a);
 assert.deepEqual(second,{outcome:'retired_no_admission',receipt:first.receipt,reused:true});assert.equal(bytes(f),before);assert.deepEqual(f.calls,['line_request_retire']);
});

test('the exact retained retirement remains readable after adoption of a different native runtime',t=>{
 const f=fixture(t),first=reconcileManagedRequest(f.s,f.a);
 f.s.tx(state=>{state.productionLines[0].ownerRuntime={...state.productionLines[0].ownerRuntime,model:'adopted-runtime-model',effort:'high'};});
 const before=bytes(f),second=reconcileManagedRequest(f.s,f.a);
 assert.deepEqual(second,{outcome:'retired_no_admission',receipt:first.receipt,reused:true});assert.equal(bytes(f),before);assert.deepEqual(f.calls,['line_request_retire']);
});

test('a late original loaded Store.begin fails its old CAS after retirement and never appends a job',t=>{
 const f=fixture(t),old=new StudioStore(f.home,{authorityVerifier:f.s.authorityVerifier});old.begin=legacyBegin;
 reconcileManagedRequest(f.s,f.a);
 unchanged(f,()=>old.begin(f.project.id,f.original),/project or frozen production profile changed/);
 assert.equal(old.get(f.project.id).jobs.length,0);assert.deepEqual(f.calls,['line_request_retire','line_begin_job']);
});

test('old unrelated mutations retain the durable receipt and do not make the original CAS admissible',t=>{
 const f=fixture(t),old=new StudioStore(f.home,{authorityVerifier:f.s.authorityVerifier});old.begin=legacyBegin;
 const receipt=reconcileManagedRequest(f.s,f.a).receipt;
 old.mutate(f.unrelated.id,p=>{p.title='Updated independently';});
 old.mutate(f.project.id,p=>{p.title='Owner retained customization';});
 assert.deepEqual(f.s.get(f.project.id).managedRequestRetirements,[receipt]);
 unchanged(f,()=>old.begin(f.project.id,f.original),/project or frozen production profile changed/);
});

test('an original admission that won the lock returns its matching job without a retirement or revision change',t=>{
 const f=fixture(t),job=f.s.begin(f.project.id,f.original),before=bytes(f),result=reconcileManagedRequest(f.s,f.a);
 assert.equal(result.outcome,'existing_job');assert.deepEqual(result.job,job);assert.equal(result.requestKey,f.a.requestKey);assert.equal(bytes(f),before);assert.equal(f.s.get(f.project.id).managedRequestRetirements,undefined);assert.deepEqual(f.calls,['line_begin_job']);
});

test('existing exact-key jobs must match the immutable payload, execution and original owner',t=>{
 for(const patch of [{executionPayloadHash:digest('different payload')},{external:{effect:'possibly_delivered'}},{execution:undefined},{lineGeneration:1},{computeTarget:'macbook'},{lineOwner:{invalid:true}}]){
  const f=fixture(t);f.s.begin(f.project.id,f.original);f.s.tx(state=>Object.assign(state.projects[0].jobs[0],patch));
  unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/existing job does not match/);
 }
});

test('duplicate or cross-project exact-key admissions fail without a receipt',t=>{
 for(const duplicate of [false,true]){
  const f=fixture(t),job=f.s.begin(f.project.id,f.original);
  f.s.tx(state=>{if(!duplicate)state.projects[0].jobs=[];state.projects[1].jobs.push({...job,id:randomUUID()});});
  unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/duplicate or cross-project admissions/);
 }
});

test('changed same-key packets and operation reuse cannot retire a different scope',t=>{
 const f=fixture(t);reconcileManagedRequest(f.s,f.a);
 unchanged(f,()=>reconcileManagedRequest(f.s,{...f.a,retirementId:randomUUID()}),/different packet/);
 const originalArgs={...f.a.originalArgs,feedback:'Changed input'};
 unchanged(f,()=>reconcileManagedRequest(f.s,{...f.a,originalArgs,originalArgsFingerprint:authorityHash(originalArgs)}),/different packet/);
 const changedKey=randomUUID(),different={...f.a,retirementId:randomUUID(),requestKey:changedKey,originalArgs:{...f.original,requestKey:changedKey}};different.originalArgsFingerprint=authorityHash(different.originalArgs);
 unchanged(f,()=>reconcileManagedRequest(f.s,different),/different packet/);
});

test('saved receipts cannot be duplicated, moved across projects or reduced to caller claims',t=>{
 for(const change of [
  state=>state.projects[0].managedRequestRetirements.push(clone(state.projects[0].managedRequestRetirements[0])),
  state=>{state.projects[1].managedRequestRetirements=state.projects[0].managedRequestRetirements;delete state.projects[0].managedRequestRetirements;},
  state=>delete state.projects[0].managedRequestRetirements[0].proofFingerprint,
  state=>state.projects[0].managedRequestRetirements[0].revision=99
 ]){
  const f=fixture(t);reconcileManagedRequest(f.s,f.a);f.s.tx(change);
  unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/duplicate or cross-project receipts|immutable admission evidence/);
 }
});

test('a contradictory admission after a saved no-admission barrier remains a conflict',t=>{
 const f=fixture(t);reconcileManagedRequest(f.s,f.a);
 f.s.tx(state=>state.projects[0].jobs.push({id:randomUUID(),requestKey:f.a.requestKey,status:'uncertain'}));
 unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/retired request also has an admission/);
});

test('scope validation rejects arbitrary keys, caller safety claims, external work and malformed digests',t=>{
 const f=fixture(t);
 const packets=[{...f.a,requestKey:randomUUID()},{...f.a,expectedGeneration:1},{...f.a,originalArgsFingerprint:digest('other request')},{...f.a,operationId:'not-a-fingerprint'},{...f.a,safe:true},{...f.a,originalArgs:{...f.original,external:{effect:'not_delivered'}}},{...f.a,originalArgs:{...f.original,execution:undefined}}];
 for(const packet of packets)unchanged(f,()=>reconcileManagedRequest(f.s,packet));
 assert.deepEqual(f.calls,[]);
});

test('stale project, profile, generation or locked-state preimages roll back without proof or revision changes',t=>{
 for(const change of [state=>state.projects[0].revision++,state=>state.projects[0].productionProfile.revision++,state=>state.projects[0].lineGeneration=3,state=>state.productionLines[0].revision++]){
  const f=fixture(t,{profile:true});f.s.tx(change);
  unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/changed/);assert.deepEqual(f.calls,[]);
 }
});

test('unknown ownership and runtime changes do not retire a previous producer request',t=>{
 for(const change of [state=>state.productionLines[0].ownerThreadId=randomUUID(),state=>state.productionLines[0].ownerRuntime.cwd='/different',state=>state.productionLines[0].admissionVersion=undefined]){
  const f=fixture(t);f.s.tx(change);
  unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/owns|runtime|transferred/);
 }
});

test('active, uncertain and unknown-host work and unresolved effects continue to hold admission',t=>{
 const rows=[
  state=>state.projects[1].jobs.push({id:randomUUID(),requestKey:randomUUID(),status:'starting',computeTarget:'linux'}),
  state=>state.projects[1].jobs.push({id:randomUUID(),requestKey:randomUUID(),status:'uncertain',computeTarget:'linux'}),
  state=>state.projects[1].jobs.push({id:randomUUID(),requestKey:randomUUID(),status:'running'}),
  state=>state.projects[1].jobs.push({id:randomUUID(),requestKey:randomUUID(),status:'running',computeTarget:'unknown-host'}),
  state=>state.projects[1].jobs.push({id:randomUUID(),requestKey:randomUUID(),status:'failed',computeTarget:'linux',external:{effect:'possibly_delivered'}}),
  state=>state.attempts.push({id:randomUUID(),projectId:state.projects[0].id,status:'needs_attention',effect:'possibly_delivered'}),
  state=>state.releasePlans.push({id:randomUUID(),status:'approved',execution:{ownerHost:'linux'},items:[]})
 ];
 for(const add of rows){const f=fixture(t);f.s.tx(add);f.a=f.request();unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/holds? this host/);assert.deepEqual(f.calls,[]);}
});

test('an explicitly different host retains its independent active job',t=>{
 const f=fixture(t);f.s.tx(state=>state.projects[1].jobs.push({id:randomUUID(),requestKey:randomUUID(),status:'running',computeTarget:'macbook'}));f.a=f.request();
 const unrelated=f.s.get(f.unrelated.id);reconcileManagedRequest(f.s,f.a);assert.deepEqual(f.s.get(f.unrelated.id),unrelated);
});

test('failed, stale, asynchronous or differently bound trusted proof cannot commit a retirement',t=>{
 const overrides=[()=>{throw new Error('Native original operation unavailable');},proof=>({...proof,verifiedAt:'2001-01-01T00:00:00.000Z'}),proof=>Promise.resolve(proof),proof=>({...proof,runtime:{...proof.runtime,cwd:'/wrong'}}),proof=>({...proof,retirement:{...proof.retirement,requestKey:randomUUID()}}),proof=>({...proof,retirement:{...proof.retirement,legacyAdmission:'caller-assertion'}}),proof=>({...proof,retirement:{...proof.retirement,legacyEntrySHA256:undefined}}),proof=>({...proof,retirement:{...proof.retirement,legacyEntrySHA256:'not-a-digest'}})];
 for(const override of overrides){const f=fixture(t);f.override=override;unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/unavailable|stale|synchronously|differs|missing/);assert.equal(existsSync(join(f.home,'.write-lock')),false);}
});

test('the existing interprocess lock rejects a concurrent retirement without deleting the other writer lock',t=>{
 const f=fixture(t),lock=join(f.home,'.write-lock');mkdirSync(lock);
 try{unchanged(f,()=>reconcileManagedRequest(f.s,f.a),/Studio is saving/);assert.equal(existsSync(lock),true);assert.deepEqual(f.calls,[]);}finally{rmSync(lock,{recursive:true});}
});

test('a job appearing before the retirement transaction is read from the locked preimage',t=>{
 const f=fixture(t),originalTx=f.s.tx.bind(f.s);let entered=false;
 f.s.tx=(fn,options)=>{if(!entered){entered=true;originalTx(state=>{const old=Object.create(f.s);old.tx=callback=>callback(state);old.begin=legacyBegin;old.begin(f.project.id,f.original);});}return originalTx(fn,options);};
 const result=reconcileManagedRequest(f.s,f.a);assert.equal(result.outcome,'existing_job');assert.equal(f.s.get(f.project.id).jobs.length,1);assert.equal(f.s.get(f.project.id).managedRequestRetirements,undefined);
});
