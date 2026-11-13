import {lineForProject} from './production-lines.mjs';
import {assertOwner,authorityHash,trustedVerification,uuid,fingerprint} from './owner-authority.mjs';

const effects=['not_delivered','possibly_delivered','delivered_unverified','independently_verified'];
function transition(store,a,reconcile){return store.mutate(a.projectId,(p,s)=>{
 const line=lineForProject(s,p),j=p.jobs.find(j=>j.id===a.jobId);
 if(!line||!j?.external)throw new Error('External job not found in this production direction.');
 assertOwner(line,a.owner);
 if(j.lineGeneration!==line.generation||authorityHash(j.external.owner)!==authorityHash(a.owner))throw new Error('This external job belongs to a previous owner.');
 if(!uuid(a.requestKey)||!['running','uncertain','completed','failed'].includes(a.status)||!effects.includes(a.effect)||!fingerprint(a.receiptFingerprint)||!fingerprint(a.resultFingerprint))throw new Error('A bounded external result with stable request/receipt/result fingerprints is required.');
 const payloadHash=authorityHash({operation:reconcile?'reconcile':'result',request:a}),old=j.external.transitions.find(t=>t.requestKey===a.requestKey);
 if(old){if(old.payloadHash!==payloadHash)throw new Error('This result request key belongs to a different payload.');return old;}
 if(['completed','failed'].includes(j.status))throw new Error('This job is terminal. Read its saved receipt; it cannot be replayed.');
 const proof=trustedVerification(store,reconcile?'external_job_reconcile':'external_job_result',s,line,a);
 assertOwner(line,proof.owner);
 if(authorityHash(proof.runtime)!==authorityHash(line.ownerRuntime))throw new Error('The trusted runtime no longer matches this direction.');
 if(j.status==='uncertain'&&!reconcile)throw new Error('Reconcile this uncertain external job on the same exact target before another transition.');
 if(!reconcile&&effects.indexOf(a.effect)<effects.indexOf(j.external.effect))throw new Error('An external effect cannot move backward without trusted reconciliation.');
 if(reconcile&&(proof.reconciliation?.jobId!==j.id||proof.reconciliation.status!==a.status||proof.reconciliation.effect!==a.effect||proof.reconciliation.receiptFingerprint!==a.receiptFingerprint||proof.reconciliation.resultFingerprint!==a.resultFingerprint))throw new Error('Trusted same-job reconciliation does not match this result.');
 const terminal=['completed','failed'].includes(a.status);
 if(terminal&&(proof.settled!==true||!(a.status==='completed'&&a.effect==='independently_verified'||a.status==='failed'&&a.effect==='not_delivered')))throw new Error('An active or uncertain external effect cannot release the shared host slot.');
 const receipt={requestKey:a.requestKey,payloadHash,jobId:j.id,status:a.status,effect:a.effect,resultFingerprint:a.resultFingerprint,receiptFingerprint:a.receiptFingerprint,verifiedAt:proof.verifiedAt,recordedAt:new Date().toISOString(),reconciled:reconcile};
 j.status=a.status;j.external.effect=a.effect;j.external.transitions.push(receipt);
 if(terminal){j.completedAt=receipt.recordedAt;p.status=p.versions.length?'review':a.status==='failed'?'failed':'draft';}
 else p.status=a.status==='uncertain'?'needs_attention':'rendering';
 return receipt;
 });}
// These transitions share StudioStore.mutate/tx and the original project.jobs.
// No expiry, lease, scheduler or second queue is introduced.
export const externalJobMethods={result(a){return transition(this,a,false);},reconcile(a){return transition(this,a,true);}};
