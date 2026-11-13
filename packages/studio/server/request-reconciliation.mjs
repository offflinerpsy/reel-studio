import {z} from 'zod';
import {lineForProject} from './production-lines.mjs';
import {activeJob,assertOwner,authorityHash,lineStateFingerprint,ownerTuple,trustedVerification,validateBBRuntime} from './owner-authority.mjs';

const id=z.string().uuid(),revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER-1);
const fingerprint=z.string().regex(/^[a-f0-9]{64}$/);
const owner=z.object({lineId:id,generation:revision,ownerHost:z.enum(['macbook','linux']),ownerThreadId:id,bbThreadId:z.string().regex(/^thr_[a-zA-Z0-9_]{1,120}$/)}).strict();
const runtime=z.object({kind:z.literal('bb'),bbThreadId:z.string().regex(/^thr_[a-zA-Z0-9_]{1,120}$/),nativeThreadId:id,host:z.enum(['macbook','linux']),provider:z.literal('openai'),model:z.literal('gpt-6.1-sol'),effort:z.literal('max'),permissionMode:z.literal('full-access'),serviceTier:z.literal('standard'),cwd:z.string().min(1).max(2000)}).strict();
const research=z.object({keywords:z.array(z.string().trim().min(1).max(80)).min(1).max(5),locationCode:z.number().int(),languageCode:z.enum(['en','ru','es','pt','fr','de']),timeRange:z.enum(['past_30_days','past_90_days','past_12_months']),maxCostUSD:z.number().min(0.013).max(1).optional()}).strict();
const originalArgs=z.object({owner,expectedRevision:revision,expectedProfileRevision:revision.optional(),execution:runtime,projectId:id,requestKey:id,feedback:z.string().max(4000).optional(),kind:z.enum(['video','metadata']).optional(),versionId:id.optional(),research:research.optional(),computeTarget:z.enum(['macbook','linux']).optional()}).strict();

// No defaults: this fingerprint must describe the captured executed payload.
export const managedRequestReconciliationSchema=z.object({retirementId:id,owner,projectId:id,requestKey:id,expectedGeneration:revision,expectedRevision:revision,originalArgs,originalArgsFingerprint:fingerprint,operationId:fingerprint,expectedStateFingerprint:fingerprint}).strict();
const same=(a,b)=>authorityHash(a)===authorityHash(b);
const insist=(ok,message)=>{if(!ok)throw new Error(message);};
const resolvedAttempt=a=>a&&(a.effect==='independently_verified'&&['published','scheduled'].includes(a.status)||a.effect==='not_delivered'&&a.status==='failed');

// StudioStore.tx commits every normal return. A private rollback result keeps
// existing-job and repeated-receipt reads under its lock without revision churn.
class ReadOnlyResult extends Error{
 constructor(value){super('Read-only managed request reconciliation');this.value=structuredClone(value);}
}

function assertHostClear(s,p,line){
 const knownHost=value=>['linux','macbook'].includes(value)?value:null;
 const onHost=(project,job)=>project.id===p.id||!knownHost(job.computeTarget)||job.computeTarget===line.ownerHost;
 insist(!s.projects.some(q=>q.jobs.some(j=>onHost(q,j)&&(activeJob(j)||j.external&&!['not_delivered','independently_verified'].includes(j.external.effect)))),'An active, uncertain, or unresolved job still holds this host. Reconcile it before request retirement.');
 const projectHost=id=>{
  const project=s.projects.find(q=>q.id===id);
  return knownHost(project?.computeTarget||s.productionLines.find(l=>l.id===project?.productionLineId)?.ownerHost);
 };
 const attemptOnHost=a=>{
  const host=a.execution?.ownerHost===undefined?projectHost(a.projectId):knownHost(a.execution.ownerHost);
  return a.projectId===p.id||!host||host===line.ownerHost;
 };
 insist(!s.attempts.some(a=>attemptOnHost(a)&&!resolvedAttempt(a)),'An unresolved publication claim or effect still holds this host.');
 const planOnHost=plan=>{
  if(plan.execution?.ownerHost!==undefined){const host=knownHost(plan.execution.ownerHost);return !host||host===line.ownerHost;}
  return !(plan.items||[]).length||(plan.items||[]).some(item=>item.projectId===p.id||!projectHost(item.projectId)||projectHost(item.projectId)===line.ownerHost);
 };
 insist(!s.releasePlans.some(plan=>planOnHost(plan)&&(!['published','scheduled'].includes(plan.status)||(plan.items||[]).some(item=>!resolvedAttempt(s.attempts.find(a=>a.id===item.attemptId))))),'An unresolved release plan still holds this host.');
}

export function reconcileManagedRequest(store,request){
 const a=managedRequestReconciliationSchema.parse(request),original=a.originalArgs;
 insist(original.projectId===a.projectId&&original.requestKey===a.requestKey&&original.expectedRevision===a.expectedRevision&&original.owner.generation===a.expectedGeneration&&same(original.owner,a.owner),'The captured request does not match the exact retirement scope.');
 insist(authorityHash({projectId:a.projectId,...original})===a.originalArgsFingerprint,'The captured executed request fingerprint differs.');
 validateBBRuntime({ownerHost:a.owner.ownerHost,ownerThreadId:a.owner.ownerThreadId,runtime:original.execution});
 try{
  return store.tx(s=>{
   const projects=s.projects.filter(p=>p.id===a.projectId);
   insist(projects.length===1,'The exact project is missing or duplicated.');
   const p=projects[0],line=lineForProject(s,p);
   insist(line?.mode==='production'&&line.admissionVersion===1,'Request retirement requires the transferred managed native producer.');
   assertOwner(line,a.owner);
   // Handoff preserves previously reserved project bytes. The current line owner
   // admits that reservation; its older saved generation remains provenance.
   insist(line.generation===a.expectedGeneration&&Number.isSafeInteger(p.lineGeneration)&&
    p.lineGeneration>0&&p.lineGeneration<=line.generation&&p.computeTarget===line.ownerHost,
   'The project, host, or production generation changed.');
   insist(same(ownerTuple(line),a.owner),'The captured request owner differs from the current producer.');
   const matches=s.projects.flatMap(q=>q.jobs.filter(j=>j.requestKey===a.requestKey).map(job=>({projectId:q.id,job})));
   insist(matches.length<=1&&(!matches.length||matches[0].projectId===p.id),'The request key has duplicate or cross-project admissions.');
   const saved=s.projects.flatMap(q=>(q.managedRequestRetirements||[]).filter(r=>r.retirementId===a.retirementId||r.requestKey===a.requestKey||r.operationId===a.operationId).map(receipt=>({projectId:q.id,receipt})));
   insist(saved.length<=1&&(!saved.length||saved[0].projectId===p.id),'The retirement identity has duplicate or cross-project receipts.');
   if(matches.length){
    const job=matches[0].job;
    insist(!saved.length,'A retired request also has an admission. Preserve both records and reconcile this conflict.');
    insist(!job.external&&job.execution&&job.executionPayloadHash===a.originalArgsFingerprint&&
     same(job.execution,original.execution)&&job.lineId===line.id&&job.lineGeneration===line.generation&&
     job.computeTarget===line.ownerHost&&same(job.lineOwner,a.owner),
    'The existing job does not match the captured managed request.');
    throw new ReadOnlyResult({outcome:'existing_job',projectId:p.id,requestKey:a.requestKey,operationId:a.operationId,originalArgsFingerprint:a.originalArgsFingerprint,job});
   }
   const payloadHash=authorityHash(a);
   const binding={operationId:a.operationId,projectId:p.id,requestKey:a.requestKey,originalArgsFingerprint:a.originalArgsFingerprint,expectedRevision:a.expectedRevision,expectedGeneration:a.expectedGeneration,legacyAdmission:'managed-project-cas-v1'};
   if(saved.length){
    const receipt=saved[0].receipt;
    insist(receipt.retirementId===a.retirementId&&receipt.requestKey===a.requestKey&&receipt.operationId===a.operationId&&receipt.payloadHash===payloadHash,'This retired key, operation, or retirement ID belongs to a different packet.');
    insist(receipt.schema==='reel-managed-request-retirement/v1'&&receipt.status==='retired_no_admission'&&
     receipt.projectId===p.id&&receipt.originalArgsFingerprint===a.originalArgsFingerprint&&
     receipt.generation===line.generation&&receipt.projectGenerationAtRetirement===p.lineGeneration&&
     same(receipt.owner,a.owner)&&same(receipt.execution,original.execution)&&
     receipt.previousRevision===a.expectedRevision&&receipt.revision===a.expectedRevision+1&&p.revision>=receipt.revision&&
     receipt.expectedProfileRevision===original.expectedProfileRevision&&receipt.sourceStateFingerprint===a.expectedStateFingerprint&&
     receipt.legacyAdmission===binding.legacyAdmission&&fingerprint.safeParse(receipt.legacyEntrySHA256).success&&
     receipt.proofFingerprint===authorityHash({...binding,legacyEntrySHA256:receipt.legacyEntrySHA256}),
    'The saved retirement receipt does not match the immutable admission evidence.');
    throw new ReadOnlyResult({outcome:'retired_no_admission',receipt,reused:true});
   }
   insist(same(line.ownerRuntime,original.execution),'The captured request runtime differs from the current producer.');
   insist(p.revision===a.expectedRevision,'The project changed before exact request retirement.');
   insist(p.productionProfile?original.expectedProfileRevision===p.productionProfile.revision:original.expectedProfileRevision===undefined,'The frozen production profile changed before request retirement.');
   insist(lineStateFingerprint(s,line)===a.expectedStateFingerprint,'The retirement state preimage changed.');
   assertHostClear(s,p,line);
   const proof=trustedVerification(store,'line_request_retire',s,line,a);
   assertOwner(line,proof.owner);
   insist(same(proof.runtime,line.ownerRuntime),'The trusted retirement runtime differs from the current producer.');
   const legacyEntrySHA256=proof.retirement?.legacyEntrySHA256;
   insist(fingerprint.safeParse(legacyEntrySHA256).success&&same(proof.retirement,{...binding,legacyEntrySHA256}),'Trusted original-operation and legacy admission evidence is missing or differs.');
   const committedAt=new Date().toISOString();
   const receipt={
    schema:'reel-managed-request-retirement/v1',status:'retired_no_admission',
    retirementId:a.retirementId,payloadHash,projectId:p.id,requestKey:a.requestKey,operationId:a.operationId,
    originalArgsFingerprint:a.originalArgsFingerprint,owner:structuredClone(a.owner),execution:structuredClone(original.execution),
    generation:line.generation,projectGenerationAtRetirement:p.lineGeneration,previousRevision:p.revision,revision:p.revision+1,
    ...(original.expectedProfileRevision!==undefined?{expectedProfileRevision:original.expectedProfileRevision}:{}),
    sourceStateFingerprint:a.expectedStateFingerprint,legacyAdmission:binding.legacyAdmission,legacyEntrySHA256,
    proofFingerprint:authorityHash(proof.retirement),verifiedAt:proof.verifiedAt,committedAt
   };
   p.managedRequestRetirements??=[];p.managedRequestRetirements.push(receipt);p.revision++;p.updatedAt=committedAt;
   return {outcome:'retired_no_admission',receipt,reused:false};
  });
 }catch(error){if(error instanceof ReadOnlyResult)return error.value;throw error;}
}
