import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID as uid} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createStudio} from '../server/index.mjs';
import {digest} from '../server/store.mjs';
import {ownerTuple} from '../server/owner-authority.mjs';
const input=()=>({requestKey:uid(),title:'A new topic',idea:'Explain a new topic',templateId:'kinetic',model:'gpt-6.1-sol',effort:'xhigh',duration:30,language:'en'});
async function setup(t,{verifier=false}={}){
 const home=mkdtempSync(join(tmpdir(),'reel-handoff-api-')),runtime={close:async()=>{},start:async()=>{throw new Error('No second native producer may start in this test');}};
 const authorityVerifier=verifier?({purpose,request:a,requestFingerprint,stateFingerprint,line})=>{
  const proof={purpose,requestFingerprint,stateFingerprint,verifiedAt:new Date().toISOString(),owner:ownerTuple(line),runtime:line.ownerRuntime};
  if(purpose==='line_handoff')Object.assign(proof,{source:{...ownerTuple(line),scheduler:{id:'exact-existing-source-schedule',host:line.ownerHost,ownerThreadId:line.ownerThreadId,status:'paused',fingerprint:a.evidence.scheduler},currentTurn:{status:'settled',fingerprint:a.evidence.currentTurn},workers:{status:'settled',active:0,fingerprint:a.evidence.workers},effects:{status:'resolved',fingerprint:a.evidence.effects}},target:{status:'ready',owner:a.nextOwner,fingerprint:a.evidence.target},manifest:{status:'verified',fingerprint:a.evidence.manifest}});
  return proof;
 }:undefined;
 const app=await createStudio({home,runtime,authorityVerifier});t.after(async()=>{await app.close();rmSync(home,{recursive:true,force:true});});
 const s=app.store,c=s.addAccount({channel:'youtube',account:'UC1234567890123456789012',label:'Channel',method:'browser'});s.connection('youtube',{connectionId:c.id,account:c.account,profileName:'Existing Linux Chrome'});
 const line=s.lineCreate({requestKey:uid(),name:'Science',connectionId:c.id,mode:'production',ownerHost:'linux',ownerThreadId:uid(),templateId:'kinetic',publicationEnabled:true});
 s.lineStatus({lineId:line.id,expectedRevision:line.revision,status:'paused'});
 const native=uid(),a={lineId:line.id,transferId:uid(),expectedRevision:2,expectedGeneration:1,expectedOwner:ownerTuple(line),expectedStateFingerprint:s.lineHandoffRead({lineId:line.id}).stateFingerprint,nextOwner:{ownerHost:'linux',ownerThreadId:native,runtime:{kind:'bb',bbThreadId:'thr_fixture_exactbbtarget',nativeThreadId:native,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:'/fixture/workspace/project'}},evidence:Object.fromEntries(['scheduler','currentTurn','workers','effects','target','manifest'].map(k=>[k,digest(k)]))};
 return {app,s,line,a,home};
}
test('MCP exposes app-only transfer/shared-job APIs, rejects caller safety flags and fake native UUID',async t=>{
 const {app,a}=await setup(t),client=new Client({name:'handoff-test',version:'1'}),[x,y]=InMemoryTransport.createLinkedPair();await Promise.all([app.server.connect(x),client.connect(y)]);t.after(()=>client.close());
 const {tools}=await client.listTools();for(const name of ['reel_line_handoff','reel_line_handoff_read','reel_external_job_begin','reel_external_job_result','reel_external_job_reconcile'])assert.deepEqual(tools.find(t=>t.name===name)._meta.ui.visibility,['app']);
 assert.equal((await app.invoke('reel_line_handoff',{...a,sourceSettled:true,schedulerPaused:true})).isError,true);
 assert.equal((await app.invoke('reel_line_handoff',{...a,nextOwner:{...a.nextOwner,ownerThreadId:'thr_fixture_fabricated'}})).isError,true);
});
test('typed handoff is fail-closed in the original server with no authority verifier and readback is available',async t=>{
 const {app,s,a}=await setup(t),before=s.read(),r=await app.invoke('reel_line_handoff',a);assert.equal(r.isError,true);assert.match(r.structuredContent.error,/trusted server authority verifier/);assert.deepEqual(s.read(),before);
 const read=await app.invoke('reel_line_handoff_read',{lineId:a.lineId,transferId:a.transferId});assert.equal(read.structuredContent.handoff.receipt,null);assert.equal(read.structuredContent.handoff.stateFingerprint,a.expectedStateFingerprint);
});
test('server binds transferred reservations/import replay/shared BB admission to the current native/BB owner',async t=>{
 const {app,s,a,line,home}=await setup(t,{verifier:true});
 const p=s.create({...input(),productionLineId:line.id}),source=join(home,'master.mp4');writeFileSync(source,'master');
 const artifact={requestKey:uid(),path:source,sourceDir:home,sha256:digest('master'),media:{duration:1},metadata:{title:'Master',caption:'Viewer copy',hashtags:[],evidence:[]},checks:[]};s.importVersion(p.id,artifact,p.revision);
 a.expectedStateFingerprint=s.lineHandoffRead({lineId:line.id}).stateFingerprint;
 const r=await app.invoke('reel_line_handoff',a);assert.notEqual(r.isError,true);assert.deepEqual((await app.invoke('reel_line_handoff',a)).structuredContent.receipt,r.structuredContent.receipt);
 s.lineStatus({lineId:line.id,expectedRevision:3,status:'active'});const owner=ownerTuple(s.read().productionLines[0]);
 assert.equal((await app.invoke('reel_create',{...input(),productionLineId:line.id})).isError,true);
 assert.equal((await app.invoke('reel_create',{...input(),productionLineId:line.id,owner:a.expectedOwner})).isError,true);
 const created=await app.invoke('reel_create',{...input(),productionLineId:line.id,owner,expectedLineRevision:4});assert.notEqual(created.isError,true);const project=created.structuredContent.project;
 const imported={projectId:p.id,expectedRevision:p.revision,requestKey:artifact.requestKey,videoPath:source,sourceDir:home,sha256:artifact.sha256,metadata:artifact.metadata,checks:[]};
 assert.equal((await app.invoke('reel_import',{...imported,owner:a.expectedOwner})).isError,true);
 assert.equal((await app.invoke('reel_import',{...imported,owner})).structuredContent.reused,true);
 assert.equal((await app.invoke('reel_generate',{projectId:project.id,requestKey:uid()})).isError,true);
 const started=await app.invoke('reel_external_job_begin',{projectId:project.id,requestKey:uid(),owner,bbThreadId:owner.bbThreadId,operation:'continue_reserved_episode',inputFingerprint:digest('accepted source packet')});assert.notEqual(started.isError,true);assert.equal(started.structuredContent.job.lineGeneration,2);assert.equal(s.get(project.id).jobs.length,1);
 const native=s.create({...input(),computeTarget:'linux'});assert.throws(()=>s.begin(native.id,{requestKey:uid()}),/already active/);
});
