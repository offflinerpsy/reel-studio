import {authorityHash,fingerprint,uuid,ownerTuple,assertOwner,lineStateFingerprint,trustedVerification,validateBBRuntime,activeJob} from './owner-authority.mjs';

const same=(a,b)=>authorityHash(a)===authorityHash(b);
const require=(ok,message)=>{if(!ok)throw new Error(`Runtime adoption refused: ${message}`);};
const immutableRuntime=({model,effort,serviceTier,...identity})=>identity;
const evidenceKeys=['bindingSha256','canonicalSha256','requestFingerprint','previousConfigSha256','candidateConfigSha256','hostFingerprint'];
const resolvedAttempt=a=>a&&(a.effect==='independently_verified'&&['published','scheduled'].includes(a.status)||a.status==='failed'&&a.effect==='not_delivered');

export function assertRuntimeIdentity(line,previous,next){
 validateBBRuntime({ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,runtime:previous});
 validateBBRuntime({ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,runtime:next});
 require(same(immutableRuntime(previous),immutableRuntime(next)),'only the observed model/effort/tier selection may change; owner, BB/native UUID, host, cwd, provider and access must be preserved');
}

/** The historical handoff is immutable. Only append-only, hash-bound receipts
 * may connect its runtime to the current owner runtime. Other line revisions
 * may occur between receipts; an adoption itself advances exactly one revision.
 */
export function validateRuntimeAdoptionChain(line,handoff=line.handoffs?.at(-1)){
 require(handoff&&Number.isSafeInteger(handoff.revision)&&handoff.revision>0&&handoff.revision<=line.revision,'the retained handoff revision is missing or invalid');
 const historical=handoff.nextOwner,owner=ownerTuple(line);
 require(historical&&same({...historical,runtime:undefined},owner),'historical handoff owner identity differs');
 assertRuntimeIdentity(line,historical.runtime,line.ownerRuntime);
 require(line.runtimeAdoptions===undefined||Array.isArray(line.runtimeAdoptions),'runtime adoption history is invalid');
 const ids=new Set();let previousRuntime=historical.runtime,previousRevision=handoff.revision;
 for(const receipt of line.runtimeAdoptions||[]){
  require(receipt&&uuid(receipt.adoptionId)&&!ids.has(receipt.adoptionId),'runtime adoption ID is invalid or duplicated');ids.add(receipt.adoptionId);
  require(receipt.schema==='reel-line-runtime-adoption/v1'&&receipt.lineId===line.id&&Number.isSafeInteger(receipt.generation)&&receipt.generation>0&&receipt.generation<=line.generation,'runtime adoption schema/line/generation differs');
  const {receiptFingerprint,...body}=receipt;
  require(fingerprint(receiptFingerprint)&&receiptFingerprint===authorityHash(body),'runtime adoption receipt fingerprint differs');
  require(fingerprint(receipt.payloadHash)&&receipt.evidence?.requestFingerprint===receipt.payloadHash&&uuid(receipt.evidence?.nativeTurnId)&&evidenceKeys.every(k=>fingerprint(receipt.evidence?.[k])),'runtime adoption native/config evidence is invalid');
  require(receipt.evidence.retainedJobFingerprint===undefined||fingerprint(receipt.evidence.retainedJobFingerprint),'retained terminal job evidence is invalid');
  require(receipt.evidence.previousConfigSha256!==receipt.evidence.candidateConfigSha256&&typeof receipt.adoptedAt==='string'&&Number.isFinite(Date.parse(receipt.adoptedAt))&&new Date(receipt.adoptedAt).toISOString()===receipt.adoptedAt,'runtime adoption timestamp/config preimages are invalid');
  require(Number.isSafeInteger(receipt.previousRevision)&&receipt.previousRevision>0&&receipt.revision===receipt.previousRevision+1&&receipt.revision<=line.revision,'runtime adoption revision is invalid');
  const receiptHandoff=line.handoffs?.find(h=>h.nextOwner?.generation===receipt.generation);
  require(receiptHandoff&&same({...receiptHandoff.nextOwner,runtime:undefined},receipt.owner),'runtime adoption owner is not the historical generation owner');
  assertRuntimeIdentity({ownerHost:receipt.owner.ownerHost,ownerThreadId:receipt.owner.ownerThreadId},receipt.previousRuntime,receipt.nextRuntime);
  require(!same(receipt.previousRuntime,receipt.nextRuntime),'runtime adoption must change the selected model/effort pair');
  if(receipt.generation!==line.generation)continue;
  require(same(receipt.owner,owner)&&receipt.previousRevision>=previousRevision&&same(receipt.previousRuntime,previousRuntime),'runtime adoption chain does not extend the retained handoff');
  previousRuntime=receipt.nextRuntime;previousRevision=receipt.revision;
 }
 require(same(previousRuntime,line.ownerRuntime),'current runtime has no valid adoption chain from the retained handoff');
 return {baseRuntime:structuredClone(historical.runtime),runtime:structuredClone(previousRuntime),revision:previousRevision};
}

export function assertRuntimeAdoptionBoundary(state,line,{retainedJobId}={}){
 const projects=state.projects.filter(p=>p.productionLineId===line.id),ids=new Set(projects.map(p=>p.id));
 let retained=null;
 if(retainedJobId!==undefined){
  require(uuid(retainedJobId),'the retained local job UUID is invalid');
  const matches=state.projects.flatMap(p=>(p.jobs||[]).filter(j=>j.id===retainedJobId).map(job=>({project:p,job})));
  require(matches.length===1,'the exact retained local job is missing or ambiguous');
  const {project,job}=matches[0];
  require(project.productionLineId===line.id&&job.lineId===line.id&&job.lineGeneration===line.generation&&same(job.lineOwner,ownerTuple(line)),'the retained local job belongs to another direction or owner');
  require(!job.external&&job.status==='uncertain'&&!job.versionId&&job.computeTarget===line.ownerHost&&uuid(job.requestKey)&&fingerprint(job.executionPayloadHash),'only an admitted uncertain local job may be retained');
  require(same(job.execution,line.ownerRuntime)&&job.model===job.execution.model&&job.effort===job.execution.effort&&job.modelProvider===job.execution.provider,'the retained local job execution differs from its admitted runtime');
  require(uuid(job.threadId)&&job.executorThreadId===job.threadId&&job.threadId!==line.ownerThreadId&&uuid(job.turnId),'the retained local job has no distinct genuine worker identity');
  retained={projectId:project.id,jobId:job.id,jobFingerprint:authorityHash(job),nativeThreadId:job.threadId,nativeTurnId:job.turnId};
 }
 const lineJobs=projects.flatMap(p=>p.jobs||[]);
 require(!lineJobs.some(j=>activeJob(j)&&(!retained||j.id!==retained.jobId)),'an active or uncertain line job remains');
 require(!lineJobs.some(j=>j.external&&!['not_delivered','independently_verified'].includes(j.external.effect)),'an unresolved external line effect remains');
 const hostJobs=state.projects.flatMap(p=>p.jobs||[]).filter(j=>!j.computeTarget||j.computeTarget===line.ownerHost);
 require(!hostJobs.some(j=>activeJob(j)&&(!retained||j.id!==retained.jobId)||j.external&&!['not_delivered','independently_verified'].includes(j.external.effect)),'an active/uncertain job or unresolved effect occupies the host');
 const attempts=state.attempts.filter(a=>ids.has(a.projectId)||a.execution?.lineId===line.id);
 require(attempts.every(resolvedAttempt),'an unresolved publication effect remains');
 const plans=state.releasePlans.filter(p=>p.execution?.lineId===line.id||(p.items||[]).some(i=>ids.has(i.projectId)));
 require(plans.every(p=>['published','scheduled'].includes(p.status)&&(p.items||[]).every(i=>resolvedAttempt(state.attempts.find(a=>a.id===i.attemptId)))),'an unresolved release plan remains');
 return retained;
}

/** Uses the original Store lock/atomic commit. The private replay sentinel exits
 * before Store.tx writes its global revision, including after a lost response.
 */
export function adoptLineRuntime(store,request){
 const replay={};let saved;
 try{return store.tx(state=>{
  require(request&&uuid(request.adoptionId)&&fingerprint(request.expectedStateFingerprint),'a stable adoption UUID and exact state fingerprint are required');
  const payloadHash=authorityHash(request);
  const prior=state.productionLines.flatMap(l=>l.runtimeAdoptions||[]).find(r=>r.adoptionId===request.adoptionId);
  if(prior){
   require(prior.lineId===request.lineId&&prior.payloadHash===payloadHash,'this adoption ID belongs to a different payload');
   validateRuntimeAdoptionChain(state.productionLines.find(l=>l.id===prior.lineId));saved=structuredClone(prior);throw replay;
  }
  const line=state.productionLines.find(l=>l.id===request.lineId);
  require(line?.admissionVersion===1,'the existing transferred direction is required');
  assertOwner(line,request.expectedOwner);
  require(same(request.expectedOwner,ownerTuple(line)),'the exact expected owner tuple differs');
  require(request.expectedRevision===line.revision&&request.expectedGeneration===line.generation,'the line revision/generation changed');
  require(same(request.expectedRuntime,line.ownerRuntime),'the expected runtime changed');
  require(request.expectedStateFingerprint===lineStateFingerprint(state,line),'the locked state preimage changed');
  validateRuntimeAdoptionChain(line);
  assertRuntimeIdentity(line,line.ownerRuntime,request.nextRuntime);
  require(!same(line.ownerRuntime,request.nextRuntime),'the selected runtime is already current');
  const retained=assertRuntimeAdoptionBoundary(state,line,{retainedJobId:request.retainedJobId});
  const proof=trustedVerification(store,'line_runtime_adopt',state,line,request);
  require(same(proof.owner,ownerTuple(line))&&same(proof.runtime,line.ownerRuntime)&&same(proof.nextRuntime,request.nextRuntime),'trusted native runtime or owner differs');
  require(uuid(proof.evidence?.nativeTurnId)&&evidenceKeys.every(k=>fingerprint(proof.evidence?.[k]))&&proof.evidence.requestFingerprint===payloadHash&&proof.evidence.previousConfigSha256!==proof.evidence.candidateConfigSha256,'new native/config evidence is missing or bound to another request');
  if(retained)require(proof.retainedJob&&same({...retained,nativeFingerprint:proof.retainedJob.nativeFingerprint},proof.retainedJob)&&fingerprint(proof.retainedJob.nativeFingerprint)&&proof.evidence.retainedJobFingerprint===authorityHash(proof.retainedJob),'trusted terminal local job evidence is missing or differs');
  else require(proof.retainedJob===undefined&&proof.evidence.retainedJobFingerprint===undefined,'unexpected retained local job evidence');
  const body={schema:'reel-line-runtime-adoption/v1',adoptionId:request.adoptionId,payloadHash,lineId:line.id,generation:line.generation,owner:ownerTuple(line),previousRevision:line.revision,revision:line.revision+1,previousRuntime:structuredClone(line.ownerRuntime),nextRuntime:structuredClone(request.nextRuntime),adoptedAt:new Date().toISOString(),evidence:Object.fromEntries(['nativeTurnId',...evidenceKeys,...(retained?['retainedJobFingerprint']:[])].map(k=>[k,proof.evidence[k]]))};
  const receipt={...body,receiptFingerprint:authorityHash(body)};
  line.ownerRuntime=structuredClone(request.nextRuntime);line.revision++;line.runtimeAdoptions??=[];line.runtimeAdoptions.push(receipt);
  validateRuntimeAdoptionChain(line);
  return receipt;
 });}catch(error){if(error===replay)return saved;throw error;}
}
