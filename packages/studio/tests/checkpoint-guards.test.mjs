import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StudioStore} from '../server/store.mjs';
import {createStudio} from '../server/index.mjs';

const input=()=>({requestKey:randomUUID(),title:'Checkpoint test',idea:'An independent test film',templateId:'kinetic',model:'gpt-6.1-sol',effort:'high',duration:15,language:'en'});
const receipt=()=>({schema:'reel-native-job-outcome/v1',kind:'dependency_checkpoint',outcomeId:randomUUID(),filmProduced:false,effectsResolved:false,newGenerateHeld:true});
function homeFor(t){const home=mkdtempSync(join(tmpdir(),'reel-checkpoint-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return home;}
function checkpoint(s,p,j,marker='both'){
 s.tx(state=>{const project=state.projects.find(x=>x.id===p.id),job=project.jobs.find(x=>x.id===j.id);job.status=marker==='receipt'?'uncertain':'dependency_checkpoint';if(marker!=='status')job.outcome=receipt();project.status='needs_attention';});
 return readFileSync(s.path,'utf8');
}

test('persisted checkpoint markers reject native mutations and new Generate without changing state',t=>{
 for(const marker of ['status','receipt','both']){
  const home=homeFor(t),s=new StudioStore(home),p=s.create(input()),j=s.begin(p.id,{requestKey:randomUUID()});
  checkpoint(s,p,j,marker);const reopened=new StudioStore(home),before=readFileSync(s.path,'utf8');
  for(const mutate of [()=>reopened.job(p.id,j.id,{status:'completed'}),()=>reopened.event(p.id,j.id,{type:'working'}),()=>reopened.addVersion(p.id,j.id,{path:'missing.mp4'}),()=>reopened.begin(p.id,{requestKey:randomUUID()})]){
   assert.throws(mutate,/dependency checkpoint/);assert.equal(readFileSync(s.path,'utf8'),before);
  }
  const existing=reopened.begin(p.id,{requestKey:j.requestKey});assert.equal(existing.id,j.id);assert.equal(existing.reused,true);
  assert.equal(reopened.get(p.id).jobs.length,1);assert.equal(reopened.get(p.id).versions.length,0);
 }
});

test('checkpoint metadata jobs cannot replace saved publication copy',t=>{
 const s=new StudioStore(homeFor(t)),p=s.create(input()),j=s.begin(p.id,{requestKey:randomUUID()}),file=join(j.dir,'film.mp4');writeFileSync(file,'fixture');
 const v=s.addVersion(p.id,j.id,{path:file,media:{duration:15}}),metadataJob=s.begin(p.id,{requestKey:randomUUID(),kind:'metadata',versionId:v.id});
 const before=checkpoint(s,p,metadataJob);
 assert.throws(()=>s.metadata(p.id,v.id,{...v.metadata,title:'Late copy'},s.get(p.id).revision,{jobId:metadataJob.id}),/dependency checkpoint/);
 assert.equal(readFileSync(s.path,'utf8'),before);
});

test('CREATE request keys retired on any production line remain unusable',t=>{
 const s=new StudioStore(homeFor(t)),retiredKey=randomUUID();
 s.tx(state=>{state.productionLines.push({id:randomUUID(),managedCreateRetirements:[{requestKey:retiredKey}]});});
 const before=readFileSync(s.path,'utf8');assert.throws(()=>s.create({...input(),requestKey:retiredKey}),/CREATE request key was retired/);assert.equal(readFileSync(s.path,'utf8'),before);
 const p=s.create(input());assert.equal(s.create({...input(),requestKey:p.requestKey}).id,p.id);
});

async function appFixture(t,overrides={}){
 const home=homeFor(t);let onEvent;
 const runtime={start:async args=>{onEvent=args.onEvent;return {threadId:randomUUID(),turnId:randomUUID()};},close:async()=>{},...overrides};
 const app=await createStudio({home,runtime});t.after(()=>app.close());const p=app.store.create(input());
 const result=await app.invoke('reel_generate',{projectId:p.id,requestKey:randomUUID()});assert.notEqual(result.isError,true,result.structuredContent?.error);
 return {app,p,j:app.store.get(p.id).jobs[0],onEvent};
}

test('late native events and direct reconciliation leave terminal checkpoints read-only',async t=>{
 let reconciles=0;const {app,p,j,onEvent}=await appFixture(t,{reconcile:async()=>{reconciles++;throw Error('must not reconcile');}});
 const before=checkpoint(app.store,p,j);
 for(const event of [{method:'reel/thread-ready',params:{threadId:randomUUID()}},{method:'turn/started',params:{turn:{id:randomUUID()}}},{method:'item/started',params:{item:{type:'commandExecution'}}},{method:'error',params:{transportLost:true}},{method:'turn/completed',params:{turn:{status:'completed'}}},{method:'turn/completed',params:{turn:{status:'interrupted'}}}])await onEvent(event);
 const result=await app.invoke('reel_reconcile',{projectId:p.id,jobId:j.id});assert.notEqual(result.isError,true,result.structuredContent?.error);assert.equal(result.structuredContent.reconciliation.readOnly,true);assert.equal(result.structuredContent.reconciliation.status,'dependency_checkpoint');
 assert.equal(reconciles,0);assert.equal(readFileSync(app.store.path,'utf8'),before);
});

test('reconciliation rereads checkpoint after native await and before importing collected files',async t=>{
 for(const phase of ['reconcile-completed','reconcile-failed','collect']){
  let current,committed,collects=0;
  const f=await appFixture(t,{reconcile:async()=>{if(phase!=='collect')committed=checkpoint(current.app.store,current.p,current.j);return {latestTurn:{status:phase==='reconcile-failed'?'failed':'completed'}};},collect:async()=>{collects++;committed=checkpoint(current.app.store,current.p,current.j);}});current=f;
  const result=await f.app.invoke('reel_reconcile',{projectId:f.p.id,jobId:f.j.id});assert.notEqual(result.isError,true,result.structuredContent?.error);
  assert.equal(collects,phase==='collect'?1:0);assert.equal(readFileSync(f.app.store.path,'utf8'),committed);assert.equal(f.app.store.get(f.p.id).versions.length,0);
 }
});

test('observer error recovery preserves a checkpoint committed during its fallback write',async t=>{
 const {app,p,j,onEvent}=await appFixture(t);let committed;
 app.store.event=()=>{throw Error('late event failure');};const originalJob=app.store.job.bind(app.store);
 app.store.job=(...args)=>{if(args[2].status==='uncertain'){committed=checkpoint(app.store,p,j);throw Error('checkpoint won write race');}return originalJob(...args);};
 await onEvent({method:'item/started',params:{item:{type:'commandExecution'}}});assert.equal(readFileSync(app.store.path,'utf8'),committed);
});
