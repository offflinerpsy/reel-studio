import {DEFAULT_EXAMPLE_PROFILE} from '../server/production-profiles.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as uid} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createStudio,taskPrompt} from '../server/index.mjs';
import {digest} from '../server/store.mjs';
import {ownerTuple} from '../server/owner-authority.mjs';

const input=()=>({requestKey:uid(),title:'Why ice floats',idea:'Explain why ice floats',templateId:'kinetic',model:'gpt-6.1-sol',effort:'xhigh',duration:30,language:'en'});
function createCAS(f,{profileId}={}){const state=f.s.read(),line=state.productionLines.find(x=>x.id===f.line.id),profile=profileId?state.profiles.find(x=>x.id===profileId):line.recipe.profile;return {expectedLineRevision:line.revision,...(profile?{expectedProfileRevision:profile.revision}:{})};}
const copy={title:'Why ice floats',caption:'The solid occupies more volume.',hashtags:['#Physics'],evidence:[]};
async function fixture(t,options={}){
 const home=mkdtempSync(join(tmpdir(),'reel-review-')),f={home};
 const authorityVerifier=f.verifier=ctx=>{
  assert.equal(existsSync(join(home,'.write-lock')),true);
  const {purpose,request:a,requestFingerprint,stateFingerprint,line,state}=ctx;
  const p={purpose,requestFingerprint,stateFingerprint,verifiedAt:new Date().toISOString(),owner:ownerTuple(line),runtime:line.ownerRuntime,settled:true};
  if(purpose==='line_handoff')Object.assign(p,{source:{...ownerTuple(line),scheduler:{id:'existing-source-hourly',host:line.ownerHost,ownerThreadId:line.ownerThreadId,status:'paused',fingerprint:a.evidence.scheduler},currentTurn:{status:'settled',fingerprint:a.evidence.currentTurn},workers:{status:'settled',active:0,fingerprint:a.evidence.workers},effects:{status:'resolved',fingerprint:a.evidence.effects}},target:{status:'ready',owner:a.nextOwner,fingerprint:a.evidence.target},manifest:{status:'verified',fingerprint:a.evidence.manifest}});
  if(purpose==='line_import_version'&&a.externalJob){const j=state.projects.find(p=>p.id===a.projectId)?.jobs.find(j=>j.id===a.externalJob.jobId);p.externalJob={jobId:j?.id,requestKey:j?.requestKey,payloadHash:j?.external?.payloadHash};}
  if(purpose==='line_begin_job'&&a.execution)p.execution=structuredClone(a.execution);
  if(purpose==='external_job_reconcile')p.reconciliation={jobId:a.jobId,status:a.status,effect:a.effect,resultFingerprint:a.resultFingerprint,receiptFingerprint:a.receiptFingerprint};
  return f.proofOverride?f.proofOverride(p,ctx):p;
 };
 const runtime={close:async()=>{},reconcile:async()=>({latestTurn:{status:'completed'}}),collect:async()=>{}};
 const app=f.app=await createStudio({home,runtime,researchService:options.researchService,authorityVerifier});t.after(async()=>{await app.close();rmSync(home,{recursive:true,force:true});});f.s=app.store;f.s.saveProfile(DEFAULT_EXAMPLE_PROFILE);
 const c=f.s.addAccount({channel:'youtube',account:'UC1234567890123456789012',label:'Channel',method:'browser'});f.s.connection('youtube',{connectionId:c.id,account:c.account,profileName:'Existing Linux Chrome'});
 f.line=f.s.lineCreate({requestKey:uid(),name:'Science',connectionId:c.id,mode:'production',ownerHost:'linux',ownerThreadId:uid(),templateId:'kinetic',publicationEnabled:true});f.source=ownerTuple(f.line);
 f.transfer=()=>{
  const s=f.s,r=s.lineHandoffRead({lineId:f.line.id});s.lineStatus({lineId:f.line.id,expectedRevision:r.revision,status:'paused'});const read=s.lineHandoffRead({lineId:f.line.id}),native=uid();
  const a={lineId:f.line.id,transferId:uid(),expectedRevision:read.revision,expectedGeneration:read.generation,expectedOwner:read.owner,expectedStateFingerprint:read.stateFingerprint,nextOwner:{ownerHost:'linux',ownerThreadId:native,runtime:{kind:'bb',bbThreadId:'thr_fixture_reviewtarget',nativeThreadId:native,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:'/fixture/workspace/project'}},evidence:Object.fromEntries(['scheduler','currentTurn','workers','effects','target','manifest'].map(k=>[k,digest(k)]))};
  s.lineHandoff(a);f.owner=ownerTuple(s.read().productionLines[0]);return a;
 };
 f.resume=()=>{const r=f.s.lineHandoffRead({lineId:f.line.id});f.s.lineStatus({lineId:f.line.id,expectedRevision:r.revision,status:'active'});};
 return f;
}
function metadataJob(f,{predatesAssignment=false,independent=false}={}){
 const {s}=f,p=s.create({...input(),...(!predatesAssignment&&!independent?{productionLineId:f.line.id,...createCAS(f),owner:f.owner}:{})});
 const videoJob=s.begin(p.id,{requestKey:uid(),owner:f.owner}),file=join(videoJob.dir,'film.mp4');writeFileSync(file,'native immutable master');const v=s.addVersion(p.id,videoJob.id,{path:file,media:{duration:1},metadata:{...copy,title:'Approved original'}});s.approve(p.id,v.id,v.sha256,s.get(p.id).revision);
 const j=s.begin(p.id,{requestKey:uid(),kind:'metadata',versionId:v.id,owner:f.owner});
 const research={id:uid(),fingerprint:digest('research'),completedAt:new Date().toISOString(),spec:{market:'United States',languageCode:'en',timeRange:'past_90_days',keywords:['why ice floats']},totalCostUSD:0.013,reused:false,operations:[],limitations:[]};
 s.job(p.id,j.id,{status:'failed',threadId:uid(),research});writeFileSync(join(j.dir,'DELIVERY.json'),JSON.stringify({metadata:{...copy,platforms:{youtube:copy,tiktok:copy,instagram:copy}}}));
 if(predatesAssignment)s.lineAssign({lineId:f.line.id,expectedLineRevision:s.lineHandoffRead({lineId:f.line.id}).revision,projectId:p.id,expectedRevision:s.get(p.id).revision});
 return {p,v,j};
}
for(const predatesAssignment of [false,true])test('stale metadata reconcile leaves copy/approval/history/revisions unchanged'+(predatesAssignment?' when the job predates assignment':''),async t=>{
 const f=await fixture(t),{p,j}=metadataJob(f,{predatesAssignment});f.transfer();const before=f.s.read();
 const r=await f.app.invoke('reel_reconcile',{projectId:p.id,jobId:j.id});assert.equal(r.isError,true);assert.deepEqual(f.s.read(),before);
});
test('metadata completion rechecks the original job inside its transaction after a concurrent handoff',async t=>{
 const f=await fixture(t),{p,j}=metadataJob(f),original=f.s.metadata;let afterTransfer;
 f.s.metadata=function(...args){f.transfer();afterTransfer=f.s.read();return original.apply(this,args);};
 const r=await f.app.invoke('reel_reconcile',{projectId:p.id,jobId:j.id});assert.equal(r.isError,true);assert.ok(afterTransfer);assert.deepEqual(f.s.read(),afterTransfer);
});
for(const independent of [false,true])test('current native metadata reconcile still completes'+(independent?' for an independent legacy project':' in the current transferred generation'),async t=>{
 const f=await fixture(t);if(!independent){f.transfer();f.resume();}const {p,v,j}=metadataJob(f,{independent}),r=await f.app.invoke('reel_reconcile',{projectId:p.id,jobId:j.id,owner:f.owner});
 assert.notEqual(r.isError,true);const current=f.s.get(p.id);assert.equal(current.jobs.find(x=>x.id===j.id).status,'completed');assert.equal(current.versions[0].metadata.title,copy.title);assert.equal(current.versions[0].approval,null);assert.equal(current.versions[0].copyHistory.length,1);
 const ui=await f.app.invoke('reel_metadata',{projectId:p.id,versionId:v.id,expectedRevision:current.revision,metadata:{...copy,title:'Owner UI edit'}});assert.notEqual(ui.isError,true);assert.equal(f.s.get(p.id).versions[0].metadata.title,'Owner UI edit');
});
function legacyProfileProject(f){
 const old=f.s.read().profiles[0],saved=f.s.saveProfile({...old,model:{...old.model,name:'gpt-5.6-luna',effort:'medium'}},old.revision);
 return f.s.create({...input(),productionLineId:f.line.id,...createCAS(f,{profileId:saved.id}),owner:f.owner,profileId:saved.id,model:saved.model.name,effort:saved.model.effort,topic:'Why ice floats',keyPhrase:'Why ice floats'});
}
function generateArgs(f,p,patch={}){return {projectId:p.id,requestKey:uid(),owner:f.owner,expectedRevision:p.revision,...(p.productionProfile?{expectedProfileRevision:p.productionProfile.revision}:{}),execution:structuredClone(f.s.read().productionLines[0].ownerRuntime),...patch};}
test('transferred managed Generate pins a verified native execution and preserves stale saved profile metadata',async t=>{
 const f=await fixture(t);f.transfer();f.resume();const p=legacyProfileProject(f),before=f.s.get(p.id),profiles=f.s.read().profiles,calls=[],worker=uid();
 f.app.runtime.start=async opts=>{calls.push(opts);await opts.onEvent({method:'reel/thread-ready',params:{threadId:worker,model:opts.model,effort:opts.effort,modelProvider:'openai',cwd:opts.cwd,permissions:{approvalPolicy:'never',sandbox:{type:'dangerFullAccess'}}}});return {threadId:worker,turnId:uid(),modelProvider:'openai',permissions:{approvalPolicy:'never',sandbox:{type:'dangerFullAccess'}}};};
 const a=generateArgs(f,p),r=await f.app.invoke('reel_generate',a);assert.notEqual(r.isError,true,r.structuredContent?.error);assert.equal(calls.length,1);assert.equal(calls[0].model,'gpt-6.1-sol');assert.equal(calls[0].effort,'max');assert.equal(calls[0].computeTarget,'linux');assert.equal(calls[0].execution.permissionMode,'full-access');assert.equal(calls[0].execution.serviceTier,'standard');assert.match(calls[0].prompt,/Use gpt-6\.1-sol at max effort and standard speed/);assert.doesNotMatch(calls[0].prompt,/Use gpt-5\.6-luna at medium/);
 const current=f.s.get(p.id),j=current.jobs[0];assert.equal(j.execution.nativeThreadId,f.owner.ownerThreadId);assert.equal(j.executorThreadId,worker);assert.equal(j.threadId,worker);assert.notEqual(j.threadId,j.execution.nativeThreadId);assert.equal(j.model,'gpt-6.1-sol');assert.equal(current.model,before.model);assert.equal(current.effort,before.effort);assert.deepEqual(current.productionProfile,before.productionProfile);assert.deepEqual(current.template,before.template);assert.equal(current.recipeSha256,before.recipeSha256);assert.deepEqual(f.s.read().profiles,profiles);
 const repeated=await f.app.invoke('reel_generate',a);assert.equal(repeated.structuredContent.reused,true);assert.equal(calls.length,1);assert.equal(f.s.get(p.id).jobs.length,1);
 const native=f.s.create({...input(),computeTarget:'linux'});assert.throws(()=>f.s.begin(native.id,{requestKey:uid()}),/already active/);
});
test('managed Generate rejects unknown/stale actors, stale project/profile CAS and unverified routes before paid work or spawn',async t=>{
 const f=await fixture(t);f.transfer();f.resume();const p=legacyProfileProject(f);let starts=0;f.app.runtime.start=async()=>{starts++;};const a=generateArgs(f,p),before=f.s.read();
 for(const patch of [{owner:undefined},{owner:f.source},{expectedRevision:undefined},{expectedRevision:999},{expectedProfileRevision:undefined},{expectedProfileRevision:999},{execution:undefined},{execution:{...a.execution,effort:'medium'}}]){const r=await f.app.invoke('reel_generate',{...a,...patch});assert.equal(r.isError,true);assert.equal(starts,0);assert.deepEqual(f.s.read(),before);}
 f.proofOverride=p=>({...p,execution:{...p.execution,nativeThreadId:uid()}});assert.equal((await f.app.invoke('reel_generate',a)).isError,true);assert.equal(starts,0);assert.deepEqual(f.s.read(),before);
 const legacy=await fixture(t),old=legacy.s.create({...input(),productionLineId:legacy.line.id});assert.equal((await legacy.app.invoke('reel_generate',{projectId:old.id,requestKey:uid()})).isError,true);assert.equal((await legacy.app.invoke('reel_generate',{...a,projectId:old.id})).isError,true);
});
test('managed metadata research and worker start use the admitted execution rather than saved Luna fields',async t=>{
 const researchCalls=[],startCalls=[],service={summary:()=>({}),access:async opts=>{researchCalls.push(opts);return {status:'verified'};},run:async(_input,opts)=>{researchCalls.push(opts);return {id:uid(),fingerprint:digest('bounded research'),completedAt:new Date().toISOString(),spec:{market:'United States',languageCode:'en',timeRange:'past_90_days',keywords:['why ice floats']},totalCostUSD:0,reused:true,operations:[],limitations:[]};}};
 const f=await fixture(t,{researchService:service});f.transfer();f.resume();const p=legacyProfileProject(f),j=f.s.begin(p.id,{requestKey:uid(),owner:f.owner}),file=join(j.dir,'source.mp4');writeFileSync(file,'source');const v=f.s.addVersion(p.id,j.id,{path:file,media:{duration:1},metadata:copy});f.app.runtime.start=async opts=>{startCalls.push(opts);return {threadId:uid(),turnId:uid(),modelProvider:'openai',permissions:{approvalPolicy:'never',sandbox:{type:'dangerFullAccess'}}};};
 const a=generateArgs(f,f.s.get(p.id),{kind:'metadata',versionId:v.id,research:{keywords:['why ice floats'],locationCode:2840,languageCode:'en',timeRange:'past_90_days',maxCostUSD:0.05}}),r=await f.app.invoke('reel_generate',a);assert.notEqual(r.isError,true);
 for(let i=0;i<5&&startCalls.length===0;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(startCalls.length,1);for(const route of [...researchCalls,...startCalls]){assert.equal(route.model,'gpt-6.1-sol');assert.equal(route.effort,'max');assert.equal(route.computeTarget,'linux');assert.deepEqual(route.execution,a.execution);}
 assert.equal(f.s.get(p.id).productionProfile.model.name,'gpt-5.6-luna');
});
test('producer owner propagation fences copy and artifact mutations in their original transactions',async t=>{
 const f=await fixture(t);f.transfer();f.resume();const {p,v}=metadataJob(f),before=f.s.read();
 const metadata=await f.app.invoke('reel_metadata',{projectId:p.id,versionId:v.id,expectedRevision:f.s.get(p.id).revision,owner:f.source,metadata:copy});assert.equal(metadata.isError,true);assert.deepEqual(f.s.read(),before);
 const captions=['en','es','pt-BR','fr','ru'].map(language=>({language,path:'/unused-stale-path/'+language+'.srt',sha256:digest(language)}));const artifacts=await f.app.invoke('reel_artifacts_attach',{projectId:p.id,versionId:v.id,sha256:v.sha256,expectedRevision:f.s.get(p.id).revision,owner:f.source,captions});assert.equal(artifacts.isError,true);assert.deepEqual(f.s.read(),before);
});
function admitted(f){const p=f.s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner}),a={projectId:p.id,requestKey:uid(),owner:f.owner,bbThreadId:f.owner.bbThreadId,operation:'produce_reserved_episode',inputFingerprint:digest('exact reserved inputs')},j=f.s.externalJobBegin(a);return {p,j,a};}
function artifact(f,p,j,{actual=false}={}){
 const file=join(j.dir,'checked.mp4');
 if(actual){const r=spawnSync(process.env.FFMPEG_BIN||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=blue:s=1080x1920:r=30:d=1.2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1.2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',file],{timeout:30000});assert.equal(r.status,0);}else writeFileSync(file,'checked imported master');
 return {requestKey:uid(),path:file,sourceDir:j.dir,sha256:digest(readFileSync(file)),media:{duration:actual?1.2:1},metadata:copy,owner:f.owner,externalJob:{jobId:j.id,requestKey:j.requestKey}};
}
function result(f,p,j,patch={}){return {projectId:p.id,jobId:j.id,requestKey:uid(),owner:f.owner,status:'completed',effect:'independently_verified',resultFingerprint:digest('checked result'),receiptFingerprint:digest('checked receipt'),...patch};}
test('checked MCP import and artifact attachment retain the exact shared external admission throughout',async t=>{
 const f=await fixture(t);f.transfer();f.resume();const {s}=f,{p,j,a}=admitted(f),art=artifact(f,p,j,{actual:true}),native=s.create({...input(),computeTarget:'linux'}),other=s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner});
 const args={projectId:p.id,expectedRevision:s.get(p.id).revision,requestKey:art.requestKey,videoPath:art.path,sourceDir:art.sourceDir,sha256:art.sha256,metadata:copy,owner:f.owner,externalJob:art.externalJob};
 const held=s.get(p.id).jobs.find(x=>x.id===j.id),first=await f.app.invoke('reel_import',args);assert.notEqual(first.isError,true,first.structuredContent?.error);assert.deepEqual(s.get(p.id).jobs.find(x=>x.id===j.id),held);const v=s.get(p.id).versions[0];assert.equal(v.externalJob.jobId,j.id);
 const retry=await f.app.invoke('reel_import',args);assert.equal(retry.structuredContent.reused,true);assert.equal(s.get(p.id).versions.length,1);assert.deepEqual(s.get(p.id).jobs.find(x=>x.id===j.id),held);
 assert.throws(()=>s.begin(native.id,{requestKey:uid()}),/already active/);assert.throws(()=>s.externalJobBegin({...a,projectId:other.id,requestKey:uid()}),/already active/);
 const cue='1\n00:00:00,000 --> 00:00:00,500\nChecked caption\n',captions=['en','es','pt-BR','fr','ru'].map(language=>{const path=join(j.dir,language+'.srt');writeFileSync(path,cue);return {language,path,sha256:digest(cue)};}),zip=join(j.dir,'editable.zip');writeFileSync(zip,Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==','base64'));
 const attached=await f.app.invoke('reel_artifacts_attach',{projectId:p.id,versionId:v.id,sha256:v.sha256,expectedRevision:s.get(p.id).revision,captions,editableSourcePath:zip});assert.notEqual(attached.isError,true);assert.equal(s.get(p.id).versions[0].artifacts.captions.length,5);assert.deepEqual(s.get(p.id).jobs.find(x=>x.id===j.id),held);assert.throws(()=>s.begin(native.id,{requestKey:uid()}),/already active/);
 s.externalJobResult(result(f,p,j,{status:'uncertain',effect:'possibly_delivered'}));assert.equal((await f.app.invoke('reel_import',args)).isError,true);assert.throws(()=>s.begin(native.id,{requestKey:uid()}),/already active/);
 s.externalJobReconcile(result(f,p,j,{status:'running',effect:'delivered_unverified'}));assert.equal((await f.app.invoke('reel_import',args)).structuredContent.reused,true);assert.equal(s.get(p.id).jobs.length,1);assert.throws(()=>s.begin(native.id,{requestKey:uid()}),/already active/);
 s.externalJobResult(result(f,p,j));assert.ok(s.begin(native.id,{requestKey:uid()}));assert.equal(s.externalJobBegin(a).id,j.id);assert.equal(s.get(p.id).jobs.length,1);
});
test('bound import rejects stale/wrong/native/uncertain jobs and unrelated same-host work without changing admission',async t=>{
 const f=await fixture(t);f.transfer();f.resume();const {s}=f,{p,j}=admitted(f),art=artifact(f,p,j),other=s.create({...input(),productionLineId:f.line.id,...createCAS(f),owner:f.owner}),before=s.read();
 for(const patch of [{externalJob:undefined},{owner:f.source},{owner:{...f.owner,generation:1}},{externalJob:{...art.externalJob,jobId:uid()}},{externalJob:{...art.externalJob,requestKey:uid()}}])assert.throws(()=>s.importVersion(p.id,{...art,...patch},s.get(p.id).revision));
 assert.throws(()=>s.importVersion(other.id,art,s.get(other.id).revision));assert.deepEqual(s.read(),before);
 f.proofOverride=proof=>({...proof,externalJob:{...proof.externalJob,payloadHash:digest('wrong admission')}});assert.throws(()=>s.importVersion(p.id,art,s.get(p.id).revision));f.proofOverride=null;assert.deepEqual(s.read(),before);
 const nativeId=uid();s.tx(state=>{state.projects.find(x=>x.id===p.id).jobs.push({id:nativeId,requestKey:uid(),status:'failed',lineId:f.line.id,lineGeneration:2,computeTarget:'linux'});return null;});const nativeJob=s.get(p.id).jobs.find(x=>x.id===nativeId);assert.throws(()=>s.importVersion(p.id,{...art,externalJob:{jobId:nativeId,requestKey:nativeJob.requestKey}},s.get(p.id).revision));
 const foreign=uid();s.tx(state=>{state.projects.find(x=>x.id===other.id).jobs.push({id:foreign,requestKey:uid(),status:'uncertain',computeTarget:'linux'});return null;});const fenced=s.read();assert.throws(()=>s.importVersion(p.id,art,s.get(p.id).revision));assert.deepEqual(s.read(),fenced);
 s.tx(state=>{state.projects.find(x=>x.id===other.id).jobs.find(x=>x.id===foreign).computeTarget='macbook';return null;});const otherHostJob=s.get(other.id).jobs.find(x=>x.id===foreign),held=s.get(p.id).jobs.find(x=>x.id===j.id);assert.ok(s.importVersion(p.id,art,s.get(p.id).revision));assert.deepEqual(s.get(p.id).jobs.find(x=>x.id===j.id),held);assert.deepEqual(s.get(other.id).jobs.find(x=>x.id===foreign),otherHostJob);
});
test('managed reservation CAS pins the explicitly selected current profile and never changes the frozen line recipe',async t=>{
 const f=await fixture(t),old=f.s.read().profiles[0];f.s.tx(s=>{const line=s.productionLines[0];line.recipe.profile=structuredClone(old);line.recipe.sha256=digest({template:line.recipe.template,profile:old});return null;});
 const saved=f.s.saveProfile({...old,model:{...old.model,name:'gpt-5.6-luna',effort:'medium'}},old.revision);f.transfer();f.resume();const line=f.s.read().productionLines[0],a={...input(),productionLineId:f.line.id,owner:f.owner,expectedLineRevision:line.revision,profileId:saved.id,expectedProfileRevision:saved.revision,model:saved.model.name,effort:saved.model.effort},before=f.s.read();
 for(const patch of [{expectedLineRevision:undefined},{expectedLineRevision:1},{expectedProfileRevision:undefined},{expectedProfileRevision:old.revision},{profileId:undefined,expectedProfileRevision:old.revision}]){const r=await f.app.invoke('reel_create',{...a,...patch});assert.equal(r.isError,true);assert.deepEqual(f.s.read(),before);}
 const created=await f.app.invoke('reel_create',a);assert.notEqual(created.isError,true,created.structuredContent?.error);const p=created.structuredContent.project;assert.equal(p.productionProfile.revision,saved.revision);assert.equal(p.productionProfile.model.name,'gpt-5.6-luna');assert.equal(p.recipeSha256,digest({template:line.recipe.template,profile:saved}));assert.deepEqual(f.s.read().productionLines[0],line);
 f.s.lineReorder({lineId:line.id,expectedRevision:line.revision,projectIds:[p.id]});const changed=f.s.read();assert.equal((await f.app.invoke('reel_create',{...a,requestKey:uid()})).isError,true);assert.deepEqual(f.s.read(),changed);const retry=await f.app.invoke('reel_create',a);assert.equal(retry.structuredContent.project.id,p.id);assert.equal(f.s.read().projects.length,1);
});
function terminalPublication(f){
 const {p,v}=metadataJob(f),id=uid(),token=uid(),target='UC1234567890123456789012',execution={...f.source,status:'claimed',token,requestKey:uid(),claimedAt:'2001-01-01T00:00:00.000Z'};
 f.s.tx(s=>{s.attempts.push({id,projectId:p.id,versionId:v.id,channel:'youtube',target,status:'published',effect:'independently_verified',url:'https://youtube.com/shorts/abcdefghijk',execution});return null;});return {p,v,id,token,target,execution};
}
test('publication result validates its token/generation and original account/effect rules inside the Store transaction',async t=>{
 const f=await fixture(t),r=terminalPublication(f),input={attemptId:r.id,executionToken:r.token,status:'published',effect:'independently_verified',url:'https://youtube.com/shorts/abcdefghijk',observedAccount:r.target,receipt:'The exact public test target was verified.'},before=f.s.read();
 for(const patch of [{executionToken:uid()},{observedAccount:'UC9999999999999999999999'},{status:'uploading',effect:'possibly_delivered'}]){assert.equal((await f.app.invoke('reel_publication_result',{...input,...patch})).isError,true);assert.deepEqual(f.s.read(),before);}
 const original=f.s.attempt;let afterTransfer;f.s.attempt=function(...args){f.transfer();afterTransfer=f.s.read();return original.apply(this,args);};const result=await f.app.invoke('reel_publication_result',input);assert.equal(result.isError,true);assert.ok(afterTransfer);assert.deepEqual(f.s.read(),afterTransfer);assert.deepEqual(afterTransfer.attempts,before.attempts);
});
test('release-plan result cannot change terminal attempt/plan/project histories after its generation changes before tx',async t=>{
 const f=await fixture(t),r=terminalPublication(f),planId=uid();f.s.tx(s=>{s.attempts[0].execution.planId=planId;s.releasePlans.push({id:planId,status:'published',target:r.target,execution:r.execution,items:[{projectId:r.p.id,versionId:r.v.id,attemptId:r.id,status:'published',effect:'independently_verified',videoId:'abcdefghijk',resultHistory:[{status:'published',effect:'independently_verified',receipt:'retained historical test receipt'}]}]});return null;});
 const input={planId,projectId:r.p.id,attemptId:r.id,executionToken:r.token,status:'published',effect:'independently_verified',receipt:{videoId:'abcdefghijk',url:'https://youtube.com/shorts/abcdefghijk',observedAccount:r.target,observation:'The exact public test target was verified.',source:'native_youtube_public',status:'public_verified'}},before=f.s.read();
 assert.equal((await f.app.invoke('reel_release_plan_result',{...input,executionToken:uid()})).isError,true);assert.deepEqual(f.s.read(),before);
 const original=f.s.releasePlanResult;let afterTransfer;f.s.releasePlanResult=function(...args){f.transfer();afterTransfer=f.s.read();return original.apply(this,args);};const result=await f.app.invoke('reel_release_plan_result',input);assert.equal(result.isError,true);assert.ok(afterTransfer);assert.deepEqual(f.s.read(),afterTransfer);for(const field of ['projects','attempts','releasePlans'])assert.deepEqual(afterTransfer[field],before[field]);
});
test('video and metadata instructions stay inside the job and prohibit public effects',async t=>{
 const f=await fixture(t),profile=f.s.read().profiles[0],p={...input(),template:f.s.read().templates[0],productionProfile:profile,topic:'Why ice floats',keyPhrase:'Why ice floats',uploads:[],versions:[]},job={dir:join(f.home,'portable-job'),feedback:'',kind:'video'};
 const video=taskPrompt(p,job),profileMetadata=taskPrompt(p,{...job,kind:'metadata'}),plain={...p};delete plain.productionProfile;const metadata=taskPrompt(plain,{...job,kind:'metadata'});
 assert.match(video,/SKILL\.md/);for(const prompt of [video,profileMetadata,metadata]){assert.ok(prompt.includes(job.dir));assert.match(prompt,/no publishing|no publication|no.*publication/i);assert.doesNotMatch(prompt,/EDITORIAL-WORKFLOW|COVER-STANDARD-V5/);}
 assert.ok(video.includes(profile.editorial.exactCTA));assert.ok(video.includes('Use '+profile.model.name+' at '+profile.model.effort+' effort and '+profile.model.speed+' speed'));
});
test('native video completion cannot attach artifacts after addVersion completes and another Store handoff changes generation',async t=>{
 const f=await fixture(t),profile=f.s.read().profiles[0],p=f.s.create({...input(),productionLineId:f.line.id,profileId:profile.id,model:profile.model.name,effort:profile.model.effort,topic:'Why ice floats',keyPhrase:'Why ice floats'}),j=f.s.begin(p.id,{requestKey:uid()}),art=artifact(f,p,j,{actual:true});
 const cue='1\n00:00:00,000 --> 00:00:00,500\nChecked caption\n',captions=profile.captions.languages.map(language=>{const path=language+'.srt';writeFileSync(join(j.dir,path),cue);return {language,path};});writeFileSync(join(j.dir,'editable.zip'),Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==','base64'));writeFileSync(join(j.dir,'DELIVERY.json'),JSON.stringify({video:'checked.mp4',metadata:{...copy,category:'physics'},captions,editableSource:'editable.zip',checks:['local synthetic checked result']}));f.s.job(p.id,j.id,{threadId:uid()});
 const original=f.s.attachArtifacts;let afterTransfer;f.s.attachArtifacts=function(...args){assert.equal(args[2].sourceJobId,j.id);f.transfer();afterTransfer=f.s.read();return original.apply(this,args);};const r=await f.app.invoke('reel_reconcile',{projectId:p.id,jobId:j.id});assert.equal(r.isError,true);assert.ok(afterTransfer);assert.equal(afterTransfer.projects[0].versions.length,1);assert.equal(afterTransfer.projects[0].versions[0].sha256,art.sha256);assert.equal(afterTransfer.projects[0].jobs[0].status,'completed');assert.equal(afterTransfer.projects[0].versions[0].artifacts,undefined);assert.deepEqual(f.s.read(),afterTransfer);
 assert.equal((await f.app.invoke('reel_reconcile',{projectId:p.id,jobId:j.id,owner:f.owner})).isError,true);assert.deepEqual(f.s.read(),afterTransfer);
});
