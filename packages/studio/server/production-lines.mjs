import {randomUUID,createHash} from 'node:crypto';
import {channelOverview,publishedCount} from './channel-overview.mjs';
import {authorityHash,fingerprint,uuid,ownerTuple,assertOwner,lineStateFingerprint,trustedVerification,validateBBRuntime,assertAdmission} from './owner-authority.mjs';

const stamp=()=>new Date().toISOString();
const copy=x=>structuredClone(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const activeJob=j=>['starting','running','cancel_requested','uncertain'].includes(j.status);
export function ensureLines(s){s.productionLines??=[];return s;}
export function lineForProject(s,p){
 if(!p)throw new Error('Project not found');
 if(!p.productionLineId)return null;
 const line=s.productionLines?.find(x=>x.id===p.productionLineId);
 if(!line)throw new Error('The production direction is missing. Refresh Studio.');
 return line;
}
export function assertLineActive(line){
 if(line&&line.status!=='active')throw new Error('This direction is paused. Resume it before starting another action.');
}
function lineById(s,id){const line=s.productionLines.find(x=>x.id===id);if(!line)throw new Error('Production direction not found');return line;}
function expected(line,revision){if(line.revision!==revision)throw new Error('The production direction changed. Refresh Studio.');}
function owner(line,a){
 assertOwner(line,a);
}
export function assertExecution(s,record,token){
 if(!record.execution)return;
 const e=record.execution,line=lineById(s,e.lineId);
 owner(line,e);
 if(e.status!=='claimed'||!token||e.token!==token)throw new Error('Claim this queued action with the assigned producer before recording its result.');
}
function connection(s,id){const c=s.accounts.find(x=>x.id===id&&!x.archived);if(!c)throw new Error('Select an active channel connection');return c;}
function publishLine(s,project,connectionId){
 const line=lineForProject(s,project);if(!line)throw new Error('Choose a production direction for this video before queuing publication.');
 assertLineActive(line);
 const c=connection(s,connectionId);
 if(line.mode!=='production'||!line.publicationEnabled||!line.ownerThreadId)throw new Error('This direction is not enabled for publication by its assigned producer.');
 if(line.connectionId!==c.id||line.target!==c.account||line.channel!==c.channel||project.targets?.[c.channel]!==c.id)throw new Error('The publication target does not match this direction.');
 if(c.status!=='browser_verified'||c.method!=='browser')throw new Error('Verify the exact browser account before publication.');
 return line;
}
function execution(line){return {...ownerTuple(line),status:'queued',queuedAt:stamp()};}

const resolvedAttempt=a=>a.effect==='independently_verified'&&['published','scheduled'].includes(a.status)||a.status==='failed'&&a.effect==='not_delivered';
function assertSafeBoundary(s,line){
 const projects=s.projects.filter(p=>p.productionLineId===line.id),ids=new Set(projects.map(p=>p.id));
 if(projects.some(p=>p.jobs.some(activeJob)))throw new Error('An active or uncertain job still belongs to this direction. Reconcile it before handoff.');
 if(projects.some(p=>p.jobs.some(j=>j.external&&!['not_delivered','independently_verified'].includes(j.external.effect))))throw new Error('An unresolved external job effect remains. Reconcile it before handoff.');
 const attempts=s.attempts.filter(a=>ids.has(a.projectId)||a.execution?.lineId===line.id);
 if(attempts.some(a=>!resolvedAttempt(a)))throw new Error('An unresolved publication/effect remains. Reconcile the exact attempt before handoff.');
 const plans=s.releasePlans.filter(p=>p.execution?.lineId===line.id||p.items.some(i=>ids.has(i.projectId)));
 if(plans.some(p=>!['published','scheduled'].includes(p.status)||p.items.some(i=>!resolvedAttempt(s.attempts.find(a=>a.id===i.attemptId)||{}))))throw new Error('An unresolved release plan remains. Reconcile it before handoff.');
}
function verifyHandoff(store,s,line,a){
 const p=trustedVerification(store,'line_handoff',s,line,a),src=p.source;
 if(!src||src.lineId!==line.id||src.generation!==line.generation||src.ownerHost!==line.ownerHost||src.ownerThreadId!==line.ownerThreadId)throw new Error('Trusted source identity does not match the paused producer.');
 const scheduler=src.scheduler;
 if(!scheduler||!scheduler.id||scheduler.host!==line.ownerHost||scheduler.ownerThreadId!==line.ownerThreadId||scheduler.status!=='paused'||scheduler.fingerprint!==a.evidence.scheduler)throw new Error('The exact source scheduler is not authoritatively paused.');
 if(src.currentTurn?.status!=='settled'||src.currentTurn.fingerprint!==a.evidence.currentTurn||src.workers?.status!=='settled'||src.workers.active!==0||src.workers.fingerprint!==a.evidence.workers)throw new Error('The source current turn/workers have not authoritatively settled.');
 if(src.effects?.status!=='resolved'||src.effects.fingerprint!==a.evidence.effects)throw new Error('The source external effects have not been authoritatively reconciled.');
 if(p.target?.status!=='ready'||p.target.fingerprint!==a.evidence.target||authorityHash(p.target.owner)!==authorityHash(a.nextOwner)||p.manifest?.status!=='verified'||p.manifest.fingerprint!==a.evidence.manifest)throw new Error('The exact target/runtime and transfer manifest are not verified.');
 return p;
}

// All mutations run inside the existing StudioStore transaction and lock.
// Directions describe ownership; projects, jobs, plans and attempts remain the queue.
export const lineMethods={
 create(a){return this.tx(s=>{
  ensureLines(s);const payloadHash=hash(a),old=s.productionLines.find(x=>x.requestKey===a.requestKey);
  if(old){if(old.payloadHash!==payloadHash)throw new Error('This request key belongs to a different direction');return {...old,reused:true};}
  const c=connection(s,a.connectionId);
  if(a.mode==='production'&&s.productionLines.some(x=>x.mode==='production'&&x.channel===c.channel&&x.target===c.account))throw new Error('This channel already has a production direction. Use its existing owner.');
  if(a.mode==='production'&&!a.ownerThreadId)throw new Error('Assign an existing producer chat for continuous production.');
  if(a.publicationEnabled&&(a.mode!=='production'||!a.ownerThreadId||c.status!=='browser_verified'||c.method!=='browser'))throw new Error('Publication needs a verified account and an assigned production chat.');
  const template=s.templates.find(x=>x.id===a.templateId),profile=a.profileId?s.profiles.find(x=>x.id===a.profileId):null;
  if(!template||a.profileId&&!profile)throw new Error('Select an existing template and production profile.');
  const line={...copy(a),id:randomUUID(),payloadHash,revision:1,generation:1,channel:c.channel,target:c.account,status:'active',recipe:{template:copy(template),profile:copy(profile),sha256:hash({template,profile})},createdAt:stamp(),updatedAt:stamp()};
  s.productionLines.push(line);return line;
 });},
 status(a){return this.tx(s=>{ensureLines(s);const line=lineById(s,a.lineId);expected(line,a.expectedRevision);line.status=a.status;line.revision++;line.updatedAt=stamp();return line;});},
 handoffRead(a){const s=this.read(),line=lineById(s,a.lineId);return {lineId:line.id,revision:line.revision,generation:line.generation,owner:ownerTuple(line),status:line.status,stateFingerprint:lineStateFingerprint(s,line),receipt:a.transferId?line.handoffs?.find(r=>r.transferId===a.transferId)||null:null};},
 handoff(a){return this.tx(s=>{
  ensureLines(s);
  if(!uuid(a.transferId)||!fingerprint(a.expectedStateFingerprint)||!a.evidence||['scheduler','currentTurn','workers','effects','target','manifest'].some(k=>!fingerprint(a.evidence[k])))throw new Error('A stable transfer UUID, exact preimage and receipt fingerprints are required.');
  const payloadHash=authorityHash(a),prior=s.productionLines.flatMap(l=>l.handoffs||[]).find(r=>r.transferId===a.transferId);
  if(prior){if(prior.payloadHash!==payloadHash)throw new Error('This transfer ID belongs to a different payload.');return prior;}
  const line=lineById(s,a.lineId);expected(line,a.expectedRevision);owner(line,a.expectedOwner);
  if(a.expectedGeneration!==line.generation)throw new Error('The production generation changed. Refresh before handoff.');
  if(line.status!=='paused')throw new Error('Pause this direction before handoff.');
  if(lineStateFingerprint(s,line)!==a.expectedStateFingerprint)throw new Error('The handoff preimage changed. Read the exact direction again.');
  validateBBRuntime(a.nextOwner);
  if(a.nextOwner.ownerThreadId===line.ownerThreadId)throw new Error('The successor must have its own native session UUID.');
  assertSafeBoundary(s,line);
  const proof=verifyHandoff(this,s,line,a),previousOwner={...ownerTuple(line),...(line.ownerRuntime?{runtime:copy(line.ownerRuntime)}:{})};
  const nextOwner={lineId:line.id,generation:line.generation+1,ownerHost:a.nextOwner.ownerHost,ownerThreadId:a.nextOwner.ownerThreadId,bbThreadId:a.nextOwner.runtime.bbThreadId,runtime:copy(a.nextOwner.runtime)};
  const receipt={transferId:a.transferId,payloadHash,lineId:line.id,previousRevision:line.revision,revision:line.revision+1,previousOwner,nextOwner,sourceStateFingerprint:a.expectedStateFingerprint,evidence:copy(a.evidence),verifiedAt:proof.verifiedAt,committedAt:stamp(),status:'paused'};
  // No project, recipe, channel, job, attempt, plan or execution is rewritten.
  line.ownerHost=nextOwner.ownerHost;line.ownerThreadId=nextOwner.ownerThreadId;line.ownerRuntime=copy(nextOwner.runtime);line.admissionVersion=1;line.generation=nextOwner.generation;line.revision++;line.updatedAt=receipt.committedAt;line.handoffs??=[];line.handoffs.push(receipt);
  return receipt;
 });},
 assign(a){return this.tx(s=>{
  ensureLines(s);const line=lineById(s,a.lineId);expected(line,a.expectedLineRevision);assertAdmission(this,s,line,a.owner,'line_assign_project',a);if(line.admissionVersion)assertLineActive(line);
  const p=s.projects.find(x=>x.id===a.projectId);if(!p||p.revision!==a.expectedRevision)throw new Error('The project changed. Refresh Studio.');
  if(p.productionLineId===line.id)return p;
  if(p.productionLineId)throw new Error('This project already belongs to a direction. Transfer must reconcile its current owner first.');
  if(p.jobs.some(activeJob)||s.attempts.some(x=>x.projectId===p.id&&(x.execution||x.dispatchState||x.effect!=='not_delivered')))throw new Error('Reconcile this project before assigning its producer.');
  if(p.targets?.[line.channel]&&p.targets[line.channel]!==line.connectionId)throw new Error('The existing channel does not match the direction.');
  p.productionLineId=line.id;p.computeTarget=line.ownerHost;p.lineGeneration=line.generation;
  // Existing accepted media and their original recipe remain immutable.
  p.recipeSha256=hash({template:p.template,profile:p.productionProfile||null});
  p.queuePosition=Math.max(0,...s.projects.filter(x=>x.productionLineId===line.id).map(x=>x.queuePosition||0))+1;
  p.revision++;p.updatedAt=stamp();return p;
 });},
 reorder(a){return this.tx(s=>{
  const line=lineById(s,a.lineId);expected(line,a.expectedRevision);
  const pending=s.projects.filter(p=>p.productionLineId===line.id&&!p.versions.length&&!p.jobs.some(activeJob));
  if(new Set(a.projectIds).size!==pending.length||a.projectIds.length!==pending.length||pending.some(p=>!a.projectIds.includes(p.id)))throw new Error('The pending queue changed. Refresh before reordering.');
  a.projectIds.forEach((id,i)=>{const p=pending.find(x=>x.id===id);p.queuePosition=i+1;p.revision++;p.updatedAt=stamp();});line.revision++;line.updatedAt=stamp();return line;
 });},
 report(a){return this.tx(s=>{
  const line=lineById(s,a.lineId);owner(line,a);assertAdmission(this,s,line,a,'line_report',a);
  // A report is an observation, never permission to replay or a proof of liveness.
  if(line.observation&&Date.parse(a.observedAt)<Date.parse(line.observation.observedAt))throw new Error('A newer producer observation is already saved.');
  if(!Number.isFinite(Date.parse(a.observedAt))||Date.parse(a.observedAt)>Date.now()+60000)throw new Error('Invalid observation time');
  line.observation={...copy(a),receivedAt:stamp(),source:'producer_report'};return line.observation;
 });},
 enqueueAttempt(attemptId){return this.tx(s=>{
  const a=s.attempts.find(x=>x.id===attemptId);if(!a)throw new Error('Publication attempt not found');
  const p=s.projects.find(x=>x.id===a.projectId),line=publishLine(s,p,a.connectionId);
  if(a.execution){owner(line,a.execution);return {attempt:a,queued:true,reused:true};}
  if(a.effect!=='not_delivered'||a.dispatchState&&a.dispatchState!=='not_sent')throw new Error('This publication was already dispatched. Reconcile the original attempt.');
  a.execution=execution(line);a.dispatchState='queued';a.status='queued';return {attempt:a,queued:true};
 });},
 enqueuePlan(planId){return this.tx(s=>{
  const plan=s.releasePlans.find(x=>x.id===planId);if(!plan||plan.status!=='approved')throw new Error('Approve the release plan first');
  const lines=plan.items.map(i=>publishLine(s,s.projects.find(p=>p.id===i.projectId),plan.connectionId));
  if(!lines.length||lines.some(x=>x.id!==lines[0].id))throw new Error('Every release item must belong to the same production direction.');
  const line=lines[0];if(plan.execution){owner(line,plan.execution);return {plan,queued:true,reused:true};}
  if(plan.dispatchState!=='not_sent')throw new Error('This release plan was already dispatched. Reconcile it first.');
  const attempts=plan.items.map(i=>s.attempts.find(a=>a.id===i.attemptId));
  if(attempts.some(a=>!a||a.execution||a.dispatchState&&a.dispatchState!=='not_sent'||a.effect!=='not_delivered'))throw new Error('A release item has another dispatch or effect. Reconcile it first.');
  plan.execution=execution(line);plan.dispatchState='queued';
  for(const a of attempts){a.execution={...copy(plan.execution),planId};a.dispatchState='queued';a.status='queued';}
  return {plan,queued:true};
 });},
 next(a){const s=this.read(),line=lineById(s,a.lineId);owner(line,a);
  return {line,projects:s.projects.filter(p=>p.productionLineId===line.id).sort((a,b)=>(a.queuePosition||0)-(b.queuePosition||0)).map(p=>({id:p.id,title:p.title,status:p.status,queuePosition:p.queuePosition,recipeSha256:p.recipeSha256})),actions:[...s.releasePlans.filter(p=>p.execution?.lineId===line.id).map(p=>({kind:'release_plan',id:p.id,status:p.status,execution:p.execution})),...s.attempts.filter(p=>p.execution?.lineId===line.id&&!p.execution.planId).map(p=>({kind:'publication',id:p.id,status:p.status,effect:p.effect,execution:p.execution}))]};
 },
 claim(a){return this.tx(s=>{
  const line=lineById(s,a.lineId);owner(line,a);assertAdmission(this,s,line,a,'line_claim',a);assertLineActive(line);
  const records=a.kind==='publication'?s.attempts:s.releasePlans,record=records.find(x=>x.id===a.id),e=record?.execution;
  if(!e||e.lineId!==line.id||e.planId)throw new Error('This action is not assigned to this producer.');owner(line,e);
  if(e.status==='claimed'){if(e.requestKey===a.requestKey)return {execution:e,reused:true};throw new Error('This action is already claimed. Reconcile it before another attempt.');}
  if(e.status!=='queued')throw new Error('The action is not queued');
  if(a.kind==='publication'&&record.effect!=='not_delivered')throw new Error('Reconcile this external effect before claiming it.');
  const unresolved=r=>r.execution?.lineId===line.id&&r.execution.status==='claimed'&&!(r.effect==='independently_verified'||r.status==='published'||r.status==='failed'&&r.effect==='not_delivered');
  if(s.attempts.some(unresolved)||s.releasePlans.some(r=>r.execution?.lineId===line.id&&r.execution.status==='claimed'&&!['published','scheduled'].includes(r.status)))throw new Error('Reconcile the producer’s current action before claiming another.');
  if(s.projects.some(p=>p.productionLineId===line.id&&p.jobs.some(activeJob)))throw new Error('A production job is still active for this direction.');
  Object.assign(e,{status:'claimed',token:randomUUID(),requestKey:a.requestKey,claimedAt:stamp()});record.dispatchState='claimed';
  if(a.kind==='release_plan')for(const item of record.items){const attempt=s.attempts.find(x=>x.id===item.attemptId);Object.assign(attempt.execution,copy(e),{planId:record.id});attempt.dispatchState='claimed';}
  return {execution:e};
 });}
};

export function operationsSnapshot(s,compute,{now=new Date()}={}){
 const time=now.getTime(),fresh=x=>!x?'unknown':!Number.isFinite(Date.parse(x.observedAt))?'unknown':time-Date.parse(x.observedAt)>2*60*60*1000?'stale':'reported';
 return {observedAt:now.toISOString(),hosts:compute?.targets?.map(x=>({...x,status:!x.checkedAt?'unknown':time-Date.parse(x.checkedAt)>5*60*1000?'stale':x.available?'available':'offline'}))||[],directions:(s.productionLines||[]).map(line=>{
  const projects=s.projects.filter(p=>p.productionLineId===line.id),attempts=s.attempts.filter(a=>projects.some(p=>p.id===a.projectId));
  return {...line,recipe:{sha256:line.recipe.sha256,templateName:line.recipe.template.name,profileName:line.recipe.profile?.name,profileRevision:line.recipe.profile?.revision},freshness:fresh(line.observation),counts:{projects:projects.length,activeJobs:projects.flatMap(p=>p.jobs).filter(activeJob).length,readyForReview:projects.filter(p=>p.status==='review').length,queuedPublications:attempts.filter(a=>a.execution?.status==='queued').length,verifiedPublications:publishedCount(attempts)}};
 }),channels:channelOverview(s),totals:{projects:s.projects.length,activeJobs:s.projects.flatMap(p=>p.jobs).filter(activeJob).length,verifiedPublications:publishedCount(s.attempts)},audienceAnalytics:{status:'not_connected'}};
}
