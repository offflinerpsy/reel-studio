import {createHash} from 'node:crypto';

const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])])):x;
export const authorityHash=x=>createHash('sha256').update(JSON.stringify(canonical(x))??'undefined').digest('hex');
export const fingerprint=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export const activeJob=j=>['starting','running','cancel_requested','uncertain'].includes(j.status);
export const supportedManagedPair=r=>r?.model==='gpt-6.1-sol'&&['max','xhigh'].includes(r.effort)||r?.model==='gpt-6.1-terra'&&r.effort==='ultra';
export const ownerTuple=line=>({lineId:line.id,generation:line.generation,ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,...(line.ownerRuntime?.bbThreadId?{bbThreadId:line.ownerRuntime.bbThreadId}:{})});
export function assertOwner(line,a){
 if(!a||a.lineId!==line.id||a.generation!==line.generation||a.ownerHost!==line.ownerHost||a.ownerThreadId!==line.ownerThreadId||line.ownerRuntime?.bbThreadId&&a.bbThreadId!==line.ownerRuntime.bbThreadId)throw new Error('This worker no longer owns the production direction.');
}
export function lineStateFingerprint(s,line){
 const projects=s.projects.filter(p=>p.productionLineId===line.id),ids=new Set(projects.map(p=>p.id));
 return authorityHash({line,projects,attempts:s.attempts.filter(a=>ids.has(a.projectId)||a.execution?.lineId===line.id),releasePlans:s.releasePlans.filter(p=>p.execution?.lineId===line.id||(p.items||[]).some(i=>ids.has(i.projectId)))});
}
// Only the host application may install this function. Tool payloads contain
// fingerprints, never verifier objects or caller-supplied safety assertions.
// It runs synchronously under StudioStore.tx's existing inter-process lock.
export function trustedVerification(store,purpose,s,line,request){
 if(typeof store.authorityVerifier!=='function')throw new Error('A trusted server authority verifier is required. No ownership or job transition was accepted.');
 const requestFingerprint=authorityHash(request),stateFingerprint=lineStateFingerprint(s,line);
 const result=store.authorityVerifier({purpose,request:structuredClone(request),requestFingerprint,stateFingerprint,line:structuredClone(line),state:structuredClone(s)});
 if(result?.then)throw new Error('The server authority verifier must finish synchronously under the Store lock.');
 const age=Date.now()-Date.parse(result?.verifiedAt);
 if(!result||result.purpose!==purpose||result.requestFingerprint!==requestFingerprint||result.stateFingerprint!==stateFingerprint||!Number.isFinite(age)||age< -5000||age>60000)throw new Error('Trusted authority evidence is missing, stale, or bound to another state/request.');
 return result;
}
export function assertAdmission(store,s,line,actor,purpose,request){
 if(!line)return;
 if(actor)assertOwner(line,actor);
 // Old untransferred native directions retain their existing entry path.
 // An explicit tuple is always checked; transferred directions fail closed.
 if(!line.admissionVersion)return;
 assertOwner(line,actor);
 const proof=trustedVerification(store,purpose,s,line,request);
 assertOwner(line,proof.owner);
 if(authorityHash(proof.runtime)!==authorityHash(line.ownerRuntime))throw new Error('The trusted native session/runtime no longer matches this direction.');
 return proof;
}
export function validateBBRuntime(next){
 const r=next?.runtime;
 if(!['linux','macbook'].includes(next?.ownerHost)||!uuid(next?.ownerThreadId)||r?.kind!=='bb'||!/^thr_[a-zA-Z0-9_]{1,120}$/.test(r.bbThreadId||'')||r.nativeThreadId!==next.ownerThreadId||r.host!==next.ownerHost||r.provider!=='openai'||!supportedManagedPair(r)||r.permissionMode!=='full-access'||!['standard','fast'].includes(r.serviceTier)||typeof r.cwd!=='string'||!r.cwd.startsWith('/')||r.cwd.length>2000)throw new Error('Bind the verified BB thread to its real native UUID, host and supported OpenAI model/effort, Full access and observed standard/fast selection.');
}
