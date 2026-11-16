import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReelHandoffs,freezeHandoff} from '../src/reel-handoffs.mjs';

function fixture(){
  const state={primaryHostId:'mac',sends:[],history:[],queued:[],records:new Map(),metadata:{},nativeCalls:[],account:{id:'connection',account:'@exact',channel:'instagram',method:'browser',archived:false,status:'needs_verification'},thread:{id:'thread',projectId:'project',environmentId:'environment',providerId:'codex',visibility:'visible',archivedAt:null,deletedAt:null,title:'Reel workflow',status:'idle',runtime:{displayStatus:'idle'}},environment:{id:'environment',projectId:'project',hostId:'mac',path:'/work/reel/job',status:'ready',lifecycle:{phase:'active'},hostLifecycle:'active'}};
  state.host={id:'mac',name:'MacBook',status:'connected',lifecycle:{phase:'active'}};
  state.project={id:'project',name:'Reel Studio',sources:[{hostId:'mac',path:'/work/reel'}]};
  const api={system:{config:async()=>({primaryHostId:state.primaryHostId,primaryHostPlatform:'darwin'})},threads:{list:async args=>{state.listArgs=args;return [{...state.thread,environmentHostId:state.listHostId||state.environment.hostId}];},get:async()=>structuredClone(state.thread),updatePluginMetadata:async args=>{Object.assign(state.metadata,args.set);return state.metadata;},send:async args=>{state.sends.push(args);if(state.sendError)throw Error('lost response');return {ok:true,delivery:state.delivery||'sent'};},promptHistory:async()=>state.history,queuedMessages:{list:async()=>state.queued}},projects:{get:async()=>structuredClone(state.project)},environments:{get:async()=>structuredClone(state.environment)},hosts:{get:async()=>structuredClone(state.host)}};
  const kv={get:async key=>structuredClone(state.records.get(key)),set:async(key,value)=>{state.records.set(key,structuredClone(value));},list:async prefix=>[...state.records.keys()].filter(key=>key.startsWith(prefix))};
  const nativeCall=async(name,args)=>{
    state.nativeCalls.push({name,args});
    if(name==='reel_state')return {structuredContent:{snapshot:{accounts:[structuredClone(state.account)],privateOtherAccount:'never expose'}}};
    if(name==='reel_connection_record'){
      if(state.nativeWriteLostBefore)throw Error('unknown before result');
      Object.assign(state.account,args,{status:'browser_verified'});
      if(state.nativeWriteLost)throw Error('response lost');
      return {structuredContent:{connection:structuredClone(state.account),snapshot:{privateOtherAccount:'never expose'}}};
    }
    if(name==='reel_publication_job')return {structuredContent:{job:structuredClone(state.job)}};
    if(name==='reel_release_plan')return {structuredContent:{plan:structuredClone(state.plan)}};
    throw Error('unsupported fixture native call');
  };
  const reload=()=>createReelHandoffs({sdk:()=>api,kv,pluginId:'reel-studio',nativeCall});
  const controller=reload();
  const selection=async(target=controller)=>{const {destinations}=await target.destinations('project',state.host.id);if(!destinations[0])throw Error('REEL_BB_DESTINATION_NOT_FOUND');const {threadId,projectId,hostId,fingerprint}=destinations[0];return {threadId,projectId,hostId,fingerprint};};
  const bind=async()=>{const sessionId=randomUUID();const result=await controller.bind({sessionId,...await selection()});return {sessionId,bindingToken:result.bindingToken};};
  const prepare=async(binding,target=controller)=>target.capture(binding,'reel_account_verify_prepare',{connectionId:'connection'},{structuredContent:{prompt:'Inspect exact saved account without publication.',snapshot:{accounts:[structuredClone(state.account)],unrelatedPrivateData:'must not be sent'}}});
  const message={role:'user',content:[{type:'text',text:'Inspect exact saved account without publication.'}]};
  return {state,api,controller,bind,prepare,message,reload,selection};
}

test('picker and explicit binding are read-only and resolve meaningful current host/project labels',async()=>{
  const f=fixture();const list=await f.controller.destinations('project');
  assert.equal(list.destinations.length,1);assert.equal(list.destinations[0].hostName,'MacBook');assert.equal(list.destinations[0].projectName,'Reel Studio');
  const binding=await f.bind();await f.controller.authorize(binding);assert.deepEqual(f.state.sends,[]);assert.equal(f.state.records.size,0);
  await assert.rejects(()=>f.controller.authorize(),/DESTINATION_REQUIRED/);
});
test('connected Linux destination is selected on its exact host without sending or changing execution authority',async()=>{
  const f=fixture();
  Object.assign(f.state.host,{id:'linux',name:'Production server'});
  Object.assign(f.state.environment,{hostId:'linux',path:'/srv/reel/job'});
  f.state.project.sources=[{hostId:'linux',path:'/srv/reel'}];
  const choice=await f.selection();
  assert.equal(f.state.listArgs.hostId,'linux');assert.equal(choice.hostId,'linux');
  const binding=await f.bind();assert.equal(f.state.sends.length,0);assert.deepEqual(f.state.metadata,{});
  await f.prepare(binding);await f.controller.send({...binding,message:f.message});
  assert.equal(f.state.sends.length,1);assert.equal(f.state.sends[0].threadId,'thread');
  assert.equal(f.state.metadata.reelHandoffRecipient.hostId,'linux');
  assert.equal(f.state.sends[0].permissionMode,undefined);assert.equal(f.state.sends[0].model,undefined);assert.equal(f.state.sends[0].serviceTier,undefined);
  const ctx={pluginMetadata:f.state.metadata,thread:{id:'thread'},project:{id:'project'},environment:{id:'environment',path:'/srv/reel/job'},host:{id:'linux'},provider:{id:'codex'}};
  assert.equal(f.controller.toolsForThread(ctx).tools.length,2);
  const receipt=[...f.state.records.values()].find(r=>r.requestKey);
  assert.equal((await f.controller.workerRead({requestKey:receipt.requestKey},{threadId:'thread',projectId:'project',signal:new AbortController().signal})).live.connection.account,'@exact');
  assert.deepEqual(f.controller.toolsForThread({...ctx,host:{id:'mac'}}).tools,[]);
});
test('Windows host paths use Windows containment while drive, share and sibling escapes are rejected',async()=>{
  for(const [source,path,eligible]of [
    ['C:\\Reel','c:\\reel\\job',true],
    ['C:\\Reel','C:/Reel/job',true],
    ['C:\\Reel','C:\\Reel\\..\\other-client',false],
    ['C:\\Reel','C:\\Reel-other\\job',false],
    ['C:\\Reel','D:\\Reel\\job',false],
    ['C:\\Reel','C:Reel\\job',false],
    ['C:\\Reel','/Reel/job',false],
    ['\\\\server\\share\\Reel','\\\\server\\share\\Reel\\job',true],
    ['\\\\server\\share\\Reel','\\\\server\\other-share\\Reel\\job',false],
  ]){
    const f=fixture();Object.assign(f.state.host,{id:'windows',name:'Windows server'});
    Object.assign(f.state.environment,{hostId:'windows',path});f.state.project.sources=[{hostId:'windows',path:source}];
    const list=await f.controller.destinations('project','windows');
    assert.equal(list.destinations.length,eligible?1:0,`${source} -> ${path}`);assert.equal(f.state.sends.length,0);
  }
});
test('disconnected, suspended and mismatched host/environment candidates fail closed',async()=>{
  for(const mutate of [s=>s.host.status='disconnected',s=>s.host.lifecycle.phase='suspended',s=>s.host.id='other',s=>s.environment.hostLifecycle='suspended',s=>s.environment.id='other',s=>s.project.sources[0].hostId='other']){
    const f=fixture();const choice=await f.selection();mutate(f.state);
    await assert.rejects(()=>f.controller.bind({sessionId:randomUUID(),...choice}),/DESTINATION/);
    assert.equal(f.state.sends.length,0);assert.deepEqual(f.state.metadata,{});
  }
  const f=fixture();f.state.listHostId='other';assert.deepEqual((await f.controller.destinations('project','mac')).destinations,[]);
});
test('binding rejects changed selection fingerprints and selected hosts before any side effect',async()=>{
  const f=fixture(),choice=await f.selection();
  await assert.rejects(()=>f.controller.bind({sessionId:randomUUID(),...choice,hostId:'other'}),/DESTINATION_CHANGED/);
  await assert.rejects(()=>f.controller.bind({sessionId:randomUUID(),...choice,fingerprint:'a'.repeat(64)}),/DESTINATION_CHANGED/);
  await assert.rejects(()=>f.controller.bind({sessionId:randomUUID(),threadId:'thread',projectId:'project'}),/SELECTION_REQUIRED/);
  f.state.environment.path='/work/reel/moved';
  await assert.rejects(()=>f.controller.bind({sessionId:randomUUID(),...choice}),/DESTINATION_CHANGED/);
  assert.equal(f.state.sends.length,0);assert.deepEqual(f.state.metadata,{});assert.equal(f.state.records.size,0);
});
test('a remote host disconnect or environment migration invalidates bound sends and worker reads',async()=>{
  const f=fixture();Object.assign(f.state.host,{id:'linux',name:'Remote'});f.state.environment.hostId='linux';f.state.project.sources[0].hostId='linux';
  const binding=await f.bind();await f.prepare(binding);
  f.state.host.status='disconnected';await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/HOST_UNAVAILABLE/);assert.equal(f.state.sends.length,0);
  f.state.host.status='connected';const receipt=await f.controller.send({...binding,message:f.message});
  f.state.environment.hostId='other';
  await assert.rejects(()=>f.controller.workerRead({requestKey:receipt.requestKey},{threadId:'thread',projectId:'project',signal:new AbortController().signal}),/HOST_UNAVAILABLE/);
  assert.equal(f.state.nativeCalls.length,0);assert.equal(f.state.sends.length,1);
});
test('non-Codex, hidden, foreign-host and project-path candidates cannot bind',async()=>{
  for(const mutate of [s=>s.thread.providerId='other',s=>s.thread.visibility='hidden',s=>s.thread.archivedAt=1,s=>s.environment.hostId='linux',s=>s.environment.path='/other/client',s=>s.environment.path='/work/reel/../other-client',s=>s.environment.projectId='other']){
    const f=fixture();mutate(f.state);await assert.rejects(()=>f.bind(),/DESTINATION/);assert.deepEqual(f.state.sends,[]);
  }
});
test('binding is fixed per panel and revalidated before preparation or send',async()=>{
  const f=fixture();const binding=await f.bind();
  await assert.rejects(async()=>f.controller.bind({sessionId:binding.sessionId,...await f.selection(),threadId:'other'}),/ALREADY_BOUND/);
  await f.prepare(binding);f.state.environment.path='/work/reel/moved';
  await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/CHANGED_REBIND/);assert.deepEqual(f.state.sends,[]);
});
test('only native prepared original prompt authorizes sending and unrelated snapshot is excluded',async()=>{
  const f=fixture();const binding=await f.bind();
  await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/NO_FROZEN_PREPARE/);
  await f.prepare(binding);
  await assert.rejects(()=>f.controller.send({...binding,message:{role:'user',content:[{type:'text',text:'Do other work'}]}}),/NO_FROZEN_PREPARE/);
  const result=await f.controller.send({...binding,message:f.message});
  assert.equal(result.isError,false);assert.equal(f.state.sends.length,1);
  const sent=f.state.sends[0];assert.equal(sent.threadId,'thread');assert.equal(sent.mode,'queue-if-active');assert.equal(sent.input[0].text,f.message.content[0].text);
  assert.equal(sent.permissionMode,undefined);assert.equal(sent.model,undefined);assert.equal(sent.serviceTier,undefined);
  assert.ok(sent.input[1].text.includes('"account":"@exact"'));assert.ok(!sent.input[1].text.includes('unrelatedPrivateData'));
  const original=JSON.parse(sent.input[1].text.slice(sent.input[1].text.indexOf('{'))).message;assert.deepEqual(original,f.message);
});
test('accepted queue is a delivery receipt and repeated request is idempotent including transport metadata changes',async()=>{
  const f=fixture();f.state.delivery='queued';const binding=await f.bind();await f.prepare(binding);
  const first=await f.controller.send({...binding,message:{...f.message,_meta:{progressToken:'first'}}});
  const second=await f.controller.send({...binding,message:{...f.message,_meta:{progressToken:'second'}}});
  assert.equal(first.requestKey,second.requestKey);assert.equal(second.duplicate,true);assert.equal(second.delivery,'queued');assert.equal(f.state.sends.length,1);
});
test('lost send response persists an uncertainty fence across panel remount and controller reload',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);f.state.sendError=true;
  await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/UNCERTAIN_RECONCILE/);
  const next=await f.bind();await f.prepare(next);
  await assert.rejects(()=>f.controller.send({...next,message:f.message}),/UNCERTAIN_RECONCILE/);assert.equal(f.state.sends.length,1);
  assert.equal((await f.controller.receipts(next)).receipts[0].state,'possibly_delivered');
  f.controller.dispose();const reloaded=f.reload();const sessionId=randomUUID();const rebound=await reloaded.bind({sessionId,...await f.selection(reloaded)}),binding2={sessionId,bindingToken:rebound.bindingToken};await f.prepare(binding2,reloaded);
  await assert.rejects(()=>reloaded.send({...binding2,message:f.message}),/UNCERTAIN_RECONCILE/);assert.equal(f.state.sends.length,1);
});
test('exact queued/history marker readback resolves delivery without another send; absence never clears fence',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);f.state.sendError=true;
  await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/UNCERTAIN_RECONCILE/);
  const {requestKey}= (await f.controller.receipts(binding)).receipts[0];
  const missing=await f.controller.reconcile({...binding,requestKey});assert.equal(missing.found,false);
  await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/UNCERTAIN_RECONCILE/);
  f.state.queued=[{content:f.state.sends[0].input}];
  const observed=await f.controller.reconcile({...binding,requestKey});assert.equal(observed.state,'delivered_unverified');assert.equal(observed.found,true);
  await f.controller.send({...binding,message:f.message});assert.equal(f.state.sends.length,1);
});
test('concurrent same request sends serialize behind one durable fence',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);
  await Promise.all([f.controller.send({...binding,message:f.message}),f.controller.send({...binding,message:f.message})]);assert.equal(f.state.sends.length,1);
});
test('disposed panel refuses sends and unreadable target reconciliation never starts another request',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);f.controller.dispose();
  await assert.rejects(()=>f.controller.send({...binding,message:f.message}),/DISPOSED/);assert.deepEqual(f.state.sends,[]);
  const g=fixture();const bound=await g.bind();await g.prepare(bound);g.state.sendError=true;
  await assert.rejects(()=>g.controller.send({...bound,message:g.message}),/UNCERTAIN_RECONCILE/);
  const {requestKey}=(await g.controller.receipts(bound)).receipts[0];g.api.threads.promptHistory=async()=>{throw Error('history unavailable');};
  await assert.rejects(()=>g.controller.reconcile({...bound,requestKey}),/history unavailable/);
  await assert.rejects(()=>g.controller.send({...bound,message:g.message}),/UNCERTAIN_RECONCILE/);assert.equal(g.state.sends.length,1);
});
test('original queued producer work creates no chat handoff and publication identity changes fail closed',()=>{
  assert.equal(freezeHandoff('reel_browser_prepare',{},{structuredContent:{queued:true,prompt:'unused'}}),null);
  assert.throws(()=>freezeHandoff('reel_browser_prepare',{projectId:'p',versionId:'v',connectionId:'c',channel:'youtube'},{structuredContent:{prompt:'publish',canSend:true,attempt:{id:'a',projectId:'other',versionId:'v',connectionId:'c',channel:'youtube'}}}),/IDENTITY_CHANGED/);
});
const workerContext=()=>({threadId:'thread',projectId:'project',signal:new AbortController().signal});
const accountResult=()=>({connectionId:'connection',channel:'instagram',account:'@exact',profileName:'Personal Chrome',browserId:'chrome',evidenceURL:'https://www.instagram.com/',draftPresent:false,note:'Observed exact authenticated account and publishing access.'});
test('worker tools are selected from exact destination metadata and genuine execution scope is required',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);const {requestKey}=await f.controller.send({...binding,message:f.message});
  const configured={pluginMetadata:f.state.metadata,thread:{id:'thread'},project:{id:'project'},environment:{id:'environment',path:'/work/reel/job'},host:{id:'mac'},provider:{id:'codex'}};
  assert.deepEqual(f.controller.toolsForThread(configured).tools,['bb_reel_handoff_read','bb_reel_handoff_record']);
  assert.deepEqual(f.controller.toolsForThread({...configured,host:{id:'other'}}).tools,[]);
  await assert.rejects(()=>f.controller.workerRead({requestKey},{...workerContext(),threadId:'other'}),/SCOPE_MISMATCH/);
  const read=await f.controller.workerRead({requestKey},workerContext());assert.equal(read.live.connection.account,'@exact');assert.ok(!JSON.stringify(read).includes('privateOtherAccount'));
});
test('worker account result refuses other identities and original state is read back after recording',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);const {requestKey}=await f.controller.send({...binding,message:f.message});
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result:{...accountResult(),connectionId:'other'}},workerContext()),/ACCOUNT_MISMATCH/);
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result:{...accountResult(),account:'@other'}},workerContext()),/ACCOUNT_MISMATCH/);
  assert.deepEqual(f.state.nativeCalls,[]);
  const receipt=await f.controller.workerRecord({requestKey,result:accountResult()},workerContext());assert.equal(receipt.state,'independently_verified');assert.equal(receipt.receipt.fields.account,'@exact');
  assert.deepEqual(f.state.nativeCalls.map(call=>call.name),['reel_state','reel_connection_record','reel_state']);
  const duplicate=await f.controller.workerRecord({requestKey,result:accountResult()},workerContext());assert.equal(duplicate.duplicate,true);assert.equal(f.state.nativeCalls.filter(call=>call.name==='reel_connection_record').length,1);
});
test('lost native result response reconciles exact saved fields without another mutation',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);const {requestKey}=await f.controller.send({...binding,message:f.message});f.state.nativeWriteLost=true;
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result:accountResult()},workerContext()),/RESULT_UNCERTAIN/);
  const read=await f.controller.workerRead({requestKey},workerContext());assert.equal(read.resultOperations[0].state,'independently_verified');
  const repeated=await f.controller.workerRecord({requestKey,result:accountResult()},workerContext());assert.equal(repeated.duplicate,true);assert.equal(f.state.nativeCalls.filter(call=>call.name==='reel_connection_record').length,1);
});
test('changed result arguments cannot bypass an unresolved earlier recording attempt',async()=>{
  const f=fixture();const binding=await f.bind();await f.prepare(binding);const {requestKey}=await f.controller.send({...binding,message:f.message});f.state.nativeWriteLostBefore=true;
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result:accountResult()},workerContext()),/RESULT_UNCERTAIN/);
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result:{...accountResult(),note:'Different observation must not bypass an unresolved recording.'}},workerContext()),/RESULT_UNCERTAIN/);
  assert.equal(f.state.nativeCalls.filter(call=>call.name==='reel_connection_record').length,1);
});
test('YouTube handle verification requires an explicit observation of the saved alias and matching immutable channel',async()=>{
  const f=fixture();Object.assign(f.state.account,{channel:'youtube',account:'@saved-channel'});const binding=await f.bind();await f.prepare(binding);const {requestKey}=await f.controller.send({...binding,message:f.message});
  const result={...accountResult(),channel:'youtube',account:'UC'+'a'.repeat(22),evidenceURL:'https://studio.youtube.com/channel/UC'+'a'.repeat(22)};
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result},workerContext()),/ACCOUNT_MISMATCH/);
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result,observedSavedAccount:'@other'},workerContext()),/ACCOUNT_MISMATCH/);
  const saved=await f.controller.workerRecord({requestKey,result,observedSavedAccount:'@saved-channel'},workerContext());assert.equal(saved.state,'independently_verified');
  const read=await f.controller.workerRead({requestKey},workerContext());assert.equal(read.live.connection.account,result.account);
  assert.equal(f.state.nativeCalls.filter(call=>call.name==='reel_connection_record').length,1);assert.equal('observedSavedAccount'in f.state.nativeCalls.find(call=>call.name==='reel_connection_record').args,false);
});
test('assigned producer claims and changed immutable media never become BB worker authority',async()=>{
  const f=fixture(),binding=await f.bind();
  const args={projectId:'p',versionId:'v',connectionId:'c',channel:'youtube'},approval={sha256:'a'.repeat(64),metadataHash:'m',targetsHash:'t'},attempt={id:'a',...args,target:'UC'+'a'.repeat(22),metadataHash:'m',targetsHash:'t',payloadHash:'payload'};
  await f.controller.capture(binding,'reel_browser_prepare',args,{structuredContent:{prompt:'Publish this exact approved master.',attempt,canSend:true,snapshot:{projects:[{id:'p',versions:[{id:'v',sha256:'a'.repeat(64),approval}]}]}}});
  const {requestKey}=await f.controller.send({...binding,message:{role:'user',content:[{type:'text',text:'Publish this exact approved master.'}]}});
  f.state.job={attempt:{...attempt,execution:{ownerThreadId:'existing-producer'}},sha256:'a'.repeat(64),approval};
  await assert.rejects(()=>f.controller.workerRead({requestKey},workerContext()),/PRODUCER_OWNED/);
  f.state.job={attempt,sha256:'b'.repeat(64),approval};await assert.rejects(()=>f.controller.workerRead({requestKey},workerContext()),/FROZEN_PUBLICATION/);
  await assert.rejects(()=>f.controller.workerRecord({requestKey,result:{attemptId:'a',executionToken:'stolen',effect:'not_delivered',status:'awaiting_owner',receipt:'Observed state'}},workerContext()),/ATTEMPT_MISMATCH/);
});
test('release overview excludes all masters and each item requires an exact frozen project read',async()=>{
  const f=fixture(),binding=await f.bind(),approval={sha256:'a'.repeat(64),metadataHash:'m',targetsHash:'t'};
  const item={projectId:'p',versionId:'v',sha256:'a'.repeat(64),metadataHash:'m',targetsHash:'t',attemptId:'a',scheduleAtUTC:'2027-01-01T12:00:00Z',timezone:'America/New_York'};
  const plan={id:'plan',connectionId:'c',channel:'youtube',target:'UC'+'a'.repeat(22),startsAt:item.scheduleAtUTC,timezone:item.timezone,intervalMinutes:60,items:[item]};
  await f.controller.capture(binding,'reel_release_plan_dispatch_prepare',{planId:'plan'},{structuredContent:{planId:'plan',prompt:'Schedule exact approved plan.',snapshot:{releasePlans:[plan]}}});
  const {requestKey}=await f.controller.send({...binding,message:{role:'user',content:[{type:'text',text:'Schedule exact approved plan.'}]}});
  f.state.plan={...plan,items:[{...item,job:{path:'/immutable/master.mp4',metadata:{caption:'PRIVATE MASTER CONTENT'}},resultHistory:[{receipt:'historical'}]}]};
  f.state.job={attempt:{id:'a',projectId:'p',versionId:'v',target:plan.target},sha256:item.sha256,approval,videoPath:'/immutable/master.mp4'};
  const overview=await f.controller.workerRead({requestKey},workerContext());assert.deepEqual(overview.live.jobs,[]);assert.ok(!JSON.stringify(overview).includes('PRIVATE MASTER CONTENT'));assert.ok(!('job'in overview.live.plan.items[0]));
  assert.equal(f.state.nativeCalls.filter(call=>call.name==='reel_publication_job').length,0);
  const selected=await f.controller.workerRead({requestKey,studioProjectId:'p'},workerContext());assert.equal(selected.live.jobs[0].videoPath,'/immutable/master.mp4');
  await assert.rejects(()=>f.controller.workerRead({requestKey,studioProjectId:'other'},workerContext()),/NOT_IN_FROZEN_PLAN/);
  f.state.plan.execution={ownerThreadId:'existing-producer'};await assert.rejects(()=>f.controller.workerRead({requestKey},workerContext()),/PRODUCER_OWNED/);
});
