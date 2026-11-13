import {createHash} from 'node:crypto';
import {readFileSync, lstatSync, openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {isAbsolute, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertRuntimeIdentity,assertRuntimeAdoptionBoundary,validateRuntimeAdoptionChain} from '../runtime-adoption.mjs';

const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => [k, canonical(x[k])])) : x;
export const authorityHash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const byteHash = x => createHash('sha256').update(x).digest('hex');
const eq = (a,b) => authorityHash(a) === authorityHash(b);
const insist = (ok, why) => {if (!ok) throw new Error(`Reel authority refused: ${why}`);};
const uuid = x => typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const active = j => ['starting','running','uncertain','cancel_requested'].includes(j.status);
const resolvedAttempt = a => a && (a.effect === 'independently_verified' && ['published','scheduled'].includes(a.status) || a.status === 'failed' && a.effect === 'not_delivered');
const ownerTuple = line => ({lineId:line.id,generation:line.generation,ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,...(line.ownerRuntime?.bbThreadId ? {bbThreadId:line.ownerRuntime.bbThreadId} : {})});

export function lineStateFingerprint(state,line) {
 const projects=state.projects.filter(p=>p.productionLineId===line.id),ids=new Set(projects.map(p=>p.id));
 return authorityHash({line,projects,attempts:state.attempts.filter(a=>ids.has(a.projectId)||a.execution?.lineId===line.id),releasePlans:state.releasePlans.filter(p=>p.execution?.lineId===line.id||(p.items||[]).some(i=>ids.has(i.projectId)))});
}

function stateFileBytes(path) {
 const limit=33554432;
 insist(isAbsolute(path||''),'a server-owned absolute state path is required');
 const before=lstatSync(path);
 insist(before.isFile()&&!before.isSymbolicLink()&&before.size<=limit,'original state must be a bounded regular file');
 const same=s=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>s[k]===before[k]);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
  insist(same(fstatSync(fd)),'original state changed during read');
  const bytes=Buffer.allocUnsafe(before.size+1);let length=0;
  while(length<bytes.length) {const n=readSync(fd,bytes,length,bytes.length-length,null);if(!n)break;length+=n;}
  insist(length===before.size&&same(fstatSync(fd))&&same(lstatSync(path)),'original state changed during read');
  return bytes.subarray(0,length);
 } finally {closeSync(fd);}
}

function effects(state,line,{handoff=false,externalJobId,retainedJobId}={}) {
 const projects=state.projects.filter(p=>p.productionLineId===line.id),ids=new Set(projects.map(p=>p.id));
 const attempts=state.attempts.filter(a=>ids.has(a.projectId)||a.execution?.lineId===line.id);
 const plans=state.releasePlans.filter(p=>p.execution?.lineId===line.id||(p.items||[]).some(i=>ids.has(i.projectId)));
 const relevantJobs=projects.flatMap(p=>(p.jobs||[]).map(j=>({projectId:p.id,...j})));
 insist(!relevantJobs.some(j=>j.execution&&(j.threadId===j.execution.nativeThreadId||j.executorThreadId===j.execution.nativeThreadId)),'a spawned native worker reuses the coordinator UUID');
 const sourceConflict=e=>e&&(e.generation!==line.generation||e.ownerThreadId!==line.ownerThreadId||e.ownerHost!==line.ownerHost||e.bbThreadId!==line.ownerRuntime?.bbThreadId);
 // Terminal claimed executions are historical evidence, not outstanding work.
 const unsettledAttempts=attempts.filter(a=>!resolvedAttempt(a));
 const unsettledPlans=plans.filter(p=>!['published','scheduled'].includes(p.status)||(p.items||[]).some(i=>!resolvedAttempt(attempts.find(a=>a.id===i.attemptId))));
 if(handoff) {
  insist(!relevantJobs.some(j=>active(j)&&(!retainedJobId||j.id!==retainedJobId)),'an active/uncertain line job remains');
  insist(!relevantJobs.some(j=>j.external&&!['not_delivered','independently_verified'].includes(j.external.effect)),'an external line effect remains unresolved');
  insist(!unsettledAttempts.length&&!unsettledPlans.length,'publication/plan claims or effects remain unresolved');
 } else {
  insist(!relevantJobs.some(j=>active(j)&&(j.lineGeneration!==line.generation||j.external&&sourceConflict(j.external.owner))),'a previous producer still has a host job');
  insist(!unsettledAttempts.some(a=>sourceConflict(a.execution))&&!unsettledPlans.some(p=>sourceConflict(p.execution)),'a previous producer still has unresolved claims/effects');
 }
 // Begin already has the Store's host exclusion; verify the same view here.
 const hostJobs=state.projects.flatMap(p=>(p.jobs||[]).filter(active).filter(j=>!j.computeTarget||j.computeTarget===line.ownerHost).map(j=>({projectId:p.id,id:j.id,status:j.status,computeTarget:j.computeTarget??null,lineGeneration:j.lineGeneration??null})));
 if(handoff) insist(hostJobs.every(j=>retainedJobId&&j.id===retainedJobId),'another job occupies the source host');
 if(externalJobId) insist(hostJobs.every(j=>j.id===externalJobId),'another job occupies the external job host');
 return {projects:projects.map(p=>({id:p.id,lineGeneration:p.lineGeneration,queuePosition:p.queuePosition})),jobs:relevantJobs.map(j=>({id:j.id,status:j.status,lineGeneration:j.lineGeneration,externalEffect:j.external?.effect??null})),attempts:attempts.map(a=>({id:a.id,status:a.status,effect:a.effect,executionStatus:a.execution?.status??null,resolved:resolvedAttempt(a)})),plans:plans.map(p=>({id:p.id,status:p.status,resolved:!unsettledPlans.includes(p)})),hostJobs};
}

/** Install ONLY from server bootstrap. Never deserialize config/verifier from a tool request.
 * The helper opens native DBs read-only and runs under the existing Store lock.
 */
export function createSourceHostAuthorityVerifier({configPath,python='/usr/bin/python3'}={}) {
 insist(isAbsolute(configPath||''),'a server-owned absolute config path is required');
 const st=lstatSync(configPath);
 insist(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'config must be a regular 0600 server-owned file');
 insist(st.uid===process.getuid?.()||st.uid===0,'config owner differs from server');
 const configBytes=readFileSync(configPath),config=JSON.parse(configBytes),configHash=byteHash(configBytes);
 const helper=join(dirname(fileURLToPath(import.meta.url)),'host_probe.py');
 const permitted=new Set(['line_handoff','line_create_project','line_assign_project','line_begin_job','line_import_version','line_report','line_claim','line_metadata','line_artifacts_attach','line_reconcile','line_research_check','external_job_begin','external_job_result','external_job_reconcile']);
 function observe(input) {
  insist(input&&permitted.has(input.purpose),'unsupported purpose');
  insist(input.line?.id===config.lineId,'line identity differs from server pin');
  insist(eq(input.state.productionLines?.find(l=>l.id===input.line.id),input.line),'locked line differs from locked Store state');
  const actualState=lineStateFingerprint(input.state,input.line);
  insist(input.stateFingerprint===actualState,'locked state fingerprint is incorrect');
  const stateBytes=stateFileBytes(config.paths.state);let diskState;
  try {diskState=JSON.parse(stateBytes);}catch {throw new Error('Reel authority refused: original state is not valid JSON');}
  const diskLine=diskState?.productionLines?.find(l=>l.id===input.line.id);
  insist(diskLine&&lineStateFingerprint(diskState,diskLine)===actualState,'original state changed or differs from locked Store preimage');
  const r=spawnSync(python,['-I','-B',helper,configPath,configHash],{input:JSON.stringify({purpose:input.purpose,stateFileSha256:byteHash(stateBytes),jobId:input.request?.jobId??null}),encoding:'utf8',timeout:35000,maxBuffer:262144,windowsHide:true});
  insist(!r.error&&r.status===0,'source-host probe unavailable or timed out');
  let observation;try{observation=JSON.parse(r.stdout);}catch{throw new Error('Reel authority refused: invalid bounded probe response');}
  insist(observation.ok===true,observation.error||'incomplete host observation');
  return observation;
 }
 function proof(input,{preview=false}={}) {
  insist(input.requestFingerprint===authorityHash(input.request),'request fingerprint is incorrect');
  const o=observe(input),line=input.line,s=input.state,request=input.request;
  const common={purpose:input.purpose,requestFingerprint:input.requestFingerprint,stateFingerprint:input.stateFingerprint,verifiedAt:new Date().toISOString()};
  const runtime=config.target.runtime;
  const targetOwner={ownerHost:config.target.ownerHost,ownerThreadId:config.target.nativeThreadId,runtime};
  if(input.purpose==='line_handoff') {
   insist(line.status==='paused'&&line.generation===config.source.generation&&line.ownerHost===config.source.ownerHost&&line.ownerThreadId===config.source.threadId,'source line is not the exact paused preimage');
   insist(eq(request.nextOwner,targetOwner),'successor differs from the pinned BB runtime');
   const e=effects(s,line,{handoff:true});
   const evidence={scheduler:authorityHash(o.scheduler),currentTurn:authorityHash(o.source.currentTurn),workers:authorityHash(o.source.workers),effects:authorityHash(e),target:authorityHash(o.target),manifest:authorityHash(o.manifest)};
   if(!preview) insist(eq(request.evidence,evidence),'receipt fingerprints changed; prepare again from the current locked state');
   return {...common,source:{lineId:line.id,generation:line.generation,ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,scheduler:{id:config.source.schedule.id,host:line.ownerHost,ownerThreadId:line.ownerThreadId,status:'paused',fingerprint:evidence.scheduler},currentTurn:{status:'settled',fingerprint:evidence.currentTurn},workers:{status:'settled',active:0,fingerprint:evidence.workers},effects:{status:'resolved',fingerprint:evidence.effects}},target:{status:'ready',owner:targetOwner,fingerprint:evidence.target},manifest:{status:'verified',fingerprint:evidence.manifest},...(preview?{evidence}:{} )};
  }
  insist(line.admissionVersion===1&&line.generation===config.source.generation+1&&line.ownerThreadId===config.target.nativeThreadId&&line.ownerHost===config.target.ownerHost&&eq(line.ownerRuntime,runtime),'transferred owner/runtime differs from the pinned target');
  const handoff=line.handoffs?.at(-1),previous={lineId:line.id,generation:config.source.generation,ownerHost:config.source.ownerHost,ownerThreadId:config.source.threadId};
  const chain=validateRuntimeAdoptionChain(line,handoff);
  insist(handoff&&handoff.lineId===line.id&&handoff.status==='paused'&&handoff.revision===handoff.previousRevision+1&&handoff.revision<=line.revision&&typeof handoff.sourceStateFingerprint==='string'&&/^[a-f0-9]{64}$/.test(handoff.sourceStateFingerprint)&&eq(handoff.previousOwner,previous)&&eq(handoff.nextOwner,{...ownerTuple(line),runtime:chain.baseRuntime})&&/^[a-f0-9]{64}$/.test(config.canonical.handoffManifestFingerprint||'')&&handoff.evidence?.manifest===config.canonical.handoffManifestFingerprint,'retained source handoff/manifest preimage is missing or differs');
  const actor=request.owner??(['line_report','line_claim'].includes(input.purpose)?request:null);
  insist(actor&&eq(ownerTuple(line),{lineId:actor.lineId,generation:actor.generation,ownerHost:actor.ownerHost,ownerThreadId:actor.ownerThreadId,bbThreadId:actor.bbThreadId}),'request actor differs from exact transferred owner');
  const terminal=['completed','failed'].includes(request.status),transition=['external_job_result','external_job_reconcile'].includes(input.purpose);
  const job=transition?s.projects.find(p=>p.id===request.projectId)?.jobs?.find(j=>j.id===request.jobId):null;
  if(transition) insist(job?.external&&eq(job.external.owner,ownerTuple(line)),'external job owner differs');
  effects(s,line,{externalJobId:job?.id});
  if(!transition) insist(o.target.currentTurn.status==='inProgress'&&['active','running'].includes(o.target.bbStatus),'target has no current accepted running BB turn');
  const result={...common,owner:ownerTuple(line),runtime};
  // Coordinator selection adoption never enables an unverified Fast worker
  // route: the existing native adapter launches only the default worker tier.
  if(input.purpose==='line_begin_job')insist(runtime.serviceTier==='standard','managed native worker admission does not support the selected Fast tier');
  if(input.purpose==='line_begin_job'&&request.execution!==undefined) {
   insist(!request.external&&eq(request.execution,runtime),'managed native execution differs from the independently verified coordinator runtime');
   result.execution=structuredClone(runtime);
  }
  if(input.purpose==='line_import_version'&&request.externalJob) {
   const binding=request.externalJob,importJob=s.projects.find(p=>p.id===request.projectId)?.jobs?.find(j=>j.id===binding.jobId);
   insist(importJob?.external&&importJob.requestKey===binding.requestKey&&importJob.lineId===line.id&&importJob.lineGeneration===line.generation&&importJob.computeTarget===line.ownerHost&&importJob.status==='running'&&eq(importJob.external.owner,ownerTuple(line))&&/^[a-f0-9]{64}$/.test(importJob.external.payloadHash||''),'import is not bound to the exact admitted running external job');
   result.externalJob={jobId:importJob.id,requestKey:importJob.requestKey,payloadHash:importJob.external.payloadHash};
  }
  if(transition&&(terminal||input.purpose==='external_job_reconcile')) {
   const r=o.reconciliation;
   insist(r&&r.jobId===job.id&&r.inputFingerprint===job.external.inputFingerprint&&r.bbThreadId===runtime.bbThreadId&&r.nativeThreadId===line.ownerThreadId&&r.nativeTurnId===o.target.currentTurn.turn_id,'missing independently pinned same-job evidence');
   for(const k of ['status','effect','resultFingerprint','receiptFingerprint']) insist(r[k]===request[k],`same-job ${k} differs`);
   result.reconciliation=Object.fromEntries(['jobId','status','effect','resultFingerprint','receiptFingerprint'].map(k=>[k,r[k]]));
  }
  if(terminal) {insist(o.target.settled===true,'target BB turn/workers/queue are not settled');result.settled=true;}
  return result;
 }
 const verifier=input=>proof(input);
 // Read-only prepare is not a grant: the real callback re-reads every target under tx.
 verifier.prepare=input=>proof(input,{preview:true});
 return verifier;
}

function privateConfig(path){
 insist(isAbsolute(path||''),'a server-owned absolute config path is required');
 const st=lstatSync(path);
 insist(st.isFile()&&!st.isSymbolicLink()&&st.size<=65536&&(st.mode&0o077)===0&&(st.uid===process.getuid?.()||st.uid===0),'config must be a bounded regular 0600 server-owned file');
 const bytes=stateFileBytes(path);insist(bytes.length<=65536,'config exceeds read bound');
 return {config:JSON.parse(bytes),sha256:byteHash(bytes)};
}

function compareMaintenanceConfigs(original,candidate){
 const identity=config=>{
  const copy=structuredClone(config),bb=copy.bb;
  insist(!('env' in bb&&'environment' in bb)||eq(bb.env,bb.environment),'conflicting BB transport environment aliases');
  for(const key of ['env','environment'])if(key in bb){
   const env=bb[key];
   insist(env&&typeof env==='object'&&!Array.isArray(env)&&eq(Object.keys(env).sort(),['BB_HOST_DAEMON_PORT','BB_SERVER_URL'])&&typeof env.BB_HOST_DAEMON_PORT==='string'&&!/\s/.test(env.BB_HOST_DAEMON_PORT)&&/^[1-9][0-9]{0,4}$/.test(env.BB_HOST_DAEMON_PORT)&&Number(env.BB_HOST_DAEMON_PORT)<=65535,'invalid BB transport environment');
   insist(typeof env.BB_SERVER_URL==='string'&&!/\s/.test(env.BB_SERVER_URL)&&/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/?$/.test(env.BB_SERVER_URL)&&Number(env.BB_SERVER_URL.match(/:([0-9]+)\/?$/)?.[1])<=65535,'BB server URL must be an exact loopback source proxy');
   // Only the private locator may differ; daemon and envelope spelling remain
   // immutable. The candidate still needs both independent metadata snapshots.
   env.BB_SERVER_URL='validated-loopback-locator';
  }
  delete copy.target.runtime;delete bb.bindingPath;delete bb.bindingSha256;delete copy.legacyAdmission;return copy;
 };
 insist(original.schema==='reel-source-host-authority/v1'&&candidate.schema===original.schema&&eq(identity(original),identity(candidate)),'maintenance config changes fields outside target runtime, BB binding and loopback locator');
 assertRuntimeIdentity({ownerHost:original.target.ownerHost,ownerThreadId:original.target.nativeThreadId},original.target.runtime,candidate.target.runtime);
 insist(/^[a-f0-9]{64}$/.test(candidate.bb.bindingSha256||'')&&isAbsolute(candidate.bb.bindingPath||''),'candidate BB binding is not pinned');
 if(original.legacyAdmission!==undefined)insist(eq(original.legacyAdmission,candidate.legacyAdmission),'an installed legacy admission pin cannot change');
 if(candidate.legacyAdmission!==undefined){
  const p=candidate.legacyAdmission,keys=['schema','operationId','projectId','requestKey','originalArgsFingerprint','expectedRevision','expectedGeneration','legacyAdmission','loadedEntrySHA256'];
  insist(p&&eq(Object.keys(p).sort(),keys.sort())&&p.schema==='reel-legacy-admission-pin/v1'&&/^[a-f0-9]{64}$/.test(p.operationId||'')&&/^[a-f0-9]{64}$/.test(p.originalArgsFingerprint||'')&&/^[a-f0-9]{64}$/.test(p.loadedEntrySHA256||'')&&uuid(p.projectId)&&uuid(p.requestKey)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>0&&Number.isSafeInteger(p.expectedGeneration)&&p.expectedGeneration>0&&p.legacyAdmission==='managed-project-cas-v1','legacy admission pin schema or bounds differ');
 }
}

/** Narrow root-installed maintenance proof. It does not authorize production;
 * the candidate is independently checked against native/BB state before either
 * the original runtime is adopted or a pinned legacy request is retired.
 */
export function createMaintenanceAuthorityVerifier({configPath,candidateConfigPath,python='/usr/bin/python3'}={}){
 const original=privateConfig(configPath),candidate=privateConfig(candidateConfigPath);
 compareMaintenanceConfigs(original.config,candidate.config);
 const helper=join(dirname(fileURLToPath(import.meta.url)),'host_probe.py');
 return input=>{
  insist(['line_runtime_adopt','line_request_retire'].includes(input?.purpose),'unsupported maintenance purpose');
  insist(input.requestFingerprint===authorityHash(input.request),'request fingerprint is incorrect');
  insist(privateConfig(configPath).sha256===original.sha256&&privateConfig(candidateConfigPath).sha256===candidate.sha256,'maintenance config changed; reinstall verifier with reviewed preimages');
  const config=original.config,next=candidate.config,line=input.line,state=input.state,request=input.request;
  insist(line?.id===config.lineId&&eq(state.productionLines?.find(l=>l.id===line.id),line),'maintenance line differs from the locked original Store');
  insist(input.stateFingerprint===lineStateFingerprint(state,line),'locked state fingerprint is incorrect');
  const bytes=stateFileBytes(config.paths.state);let diskState;
  try{diskState=JSON.parse(bytes);}catch{throw new Error('Reel authority refused: original state is not valid JSON');}
  const diskLine=diskState?.productionLines?.find(l=>l.id===line.id);
  insist(diskLine&&lineStateFingerprint(diskState,diskLine)===input.stateFingerprint,'original state changed or differs from locked Store preimage');
  insist(line.admissionVersion===1&&line.generation===config.source.generation+1&&line.ownerThreadId===config.target.nativeThreadId&&line.ownerHost===config.target.ownerHost&&eq(line.ownerRuntime,config.target.runtime),'maintenance owner/runtime differs from original config pin');
  const handoff=line.handoffs?.at(-1),chain=validateRuntimeAdoptionChain(line,handoff),previous={lineId:line.id,generation:config.source.generation,ownerHost:config.source.ownerHost,ownerThreadId:config.source.threadId};
  insist(handoff.lineId===line.id&&handoff.status==='paused'&&handoff.revision===handoff.previousRevision+1&&/^[a-f0-9]{64}$/.test(handoff.sourceStateFingerprint||'')&&eq(handoff.previousOwner,previous)&&eq(handoff.nextOwner,{...ownerTuple(line),runtime:chain.baseRuntime})&&/^[a-f0-9]{64}$/.test(config.canonical.handoffManifestFingerprint||'')&&handoff.evidence?.manifest===config.canonical.handoffManifestFingerprint,'retained source handoff/manifest preimage is missing or differs');
  const actor=input.purpose==='line_runtime_adopt'?request.expectedOwner:request.owner;
  insist(eq(actor,ownerTuple(line)),'maintenance actor differs from the exact transferred owner');
  insist(input.purpose==='line_runtime_adopt'||request.retainedJobId===undefined,'only runtime adoption may retain a terminal local job');
  const retained=assertRuntimeAdoptionBoundary(state,line,input.purpose==='line_runtime_adopt'?{retainedJobId:request.retainedJobId}:{});
  const e=effects(state,line,{handoff:true,retainedJobId:retained?.jobId});
  if(input.purpose==='line_runtime_adopt')insist(request.expectedRevision===line.revision&&request.expectedGeneration===line.generation&&eq(request.expectedRuntime,line.ownerRuntime)&&request.expectedStateFingerprint===input.stateFingerprint&&eq(request.nextRuntime,next.target.runtime),'runtime adoption CAS or candidate differs');
  if(input.purpose==='line_request_retire'){
   const pin=next.legacyAdmission;
   insist(pin&&['operationId','projectId','requestKey','originalArgsFingerprint','expectedRevision','expectedGeneration'].every(k=>request[k]===pin[k])&&line.generation===pin.expectedGeneration,'retirement request differs from root-owned exact legacy admission pin');
  }
  const r=spawnSync(python,['-I','-B',helper,candidateConfigPath,candidate.sha256],{input:JSON.stringify({purpose:input.purpose,stateFileSha256:byteHash(bytes),...(retained?{retainedJobId:retained.jobId}:{})}),encoding:'utf8',timeout:35000,maxBuffer:262144,windowsHide:true});
  insist(!r.error&&r.status===0,'maintenance host probe unavailable or timed out');
  let o;try{o=JSON.parse(r.stdout);}catch{throw new Error('Reel authority refused: invalid bounded maintenance probe response');}
  insist(o.ok===true,o.error||'incomplete maintenance observation');
  const retainedProof=retained&&o.retainedJob?{...o.retainedJob,jobFingerprint:retained.jobFingerprint}:undefined;
  if(retained)insist(retainedProof&&eq({...retained,nativeFingerprint:retainedProof.nativeFingerprint},retainedProof)&&/^[a-f0-9]{64}$/.test(retainedProof.nativeFingerprint||''),'independent terminal local job evidence differs');
  else insist(o.retainedJob===undefined,'unexpected terminal local job evidence');
  insist(o.target?.settled===true||o.target?.currentTurn?.status==='inProgress'&&['active','running'].includes(o.target?.bbStatus),'target has no current accepted BB turn or settled idle native identity');
  insist(privateConfig(configPath).sha256===original.sha256&&privateConfig(candidateConfigPath).sha256===candidate.sha256,'maintenance config changed during native proof');
  const common={purpose:input.purpose,requestFingerprint:input.requestFingerprint,stateFingerprint:input.stateFingerprint,verifiedAt:new Date().toISOString(),owner:ownerTuple(line),runtime:structuredClone(line.ownerRuntime)};
  if(input.purpose==='line_request_retire'){
   const pin=next.legacyAdmission;
   insist(o.retirement&&eq(o.retirement,{...Object.fromEntries(['operationId','projectId','requestKey','originalArgsFingerprint','expectedRevision','expectedGeneration','legacyAdmission'].map(k=>[k,pin[k]])),legacyEntrySHA256:pin.loadedEntrySHA256}),'independent exact legacy admission proof differs');
   return {...common,retirement:o.retirement};
  }
  return {...common,nextRuntime:structuredClone(next.target.runtime),...(retained?{retainedJob:retainedProof}:{}),evidence:{nativeTurnId:o.target.currentTurn.turn_id,bindingSha256:next.bb.bindingSha256,canonicalSha256:o.manifest.sha256,requestFingerprint:input.requestFingerprint,previousConfigSha256:original.sha256,candidateConfigSha256:candidate.sha256,hostFingerprint:authorityHash({hostname:next.hostname,scheduler:o.scheduler,source:o.source,target:o.target,effects:e,...(retained?{retainedJob:retainedProof}:{})}),...(retained?{retainedJobFingerprint:authorityHash(retainedProof)}:{})}};
 };
}
