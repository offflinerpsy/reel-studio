import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioStore} from '../server/store.mjs';
import {createSourceHostAuthorityVerifier} from '../server/owner-host/authority-verifier.mjs';
import {readFileSync,chmodSync} from 'node:fs';
import {authorityHash,ownerTuple,validateBBRuntime} from '../server/owner-authority.mjs';
import {adoptLineRuntime,validateRuntimeAdoptionChain} from '../server/runtime-adoption.mjs';
import {sha,uid,python,json,fixture} from './runtime-adoption-fixtures.mjs';

test('only exact Sol/max, Sol/xhigh and Terra/ultra managed pairs are supported',()=>{
 const ownerThreadId=uid(),runtime={kind:'bb',bbThreadId:'thr_fixture_pair',nativeThreadId:ownerThreadId,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:'/exact'};
 for(const [model,effort] of [['gpt-6.1-sol','max'],['gpt-6.1-sol','xhigh'],['gpt-6.1-terra','ultra']])for(const serviceTier of ['standard','fast'])assert.doesNotThrow(()=>validateBBRuntime({ownerHost:'linux',ownerThreadId,runtime:{...runtime,model,effort,serviceTier}}));
 for(const [model,effort] of [['gpt-6.1-sol','ultra'],['gpt-6.1-terra','max'],['gpt-5.6-terra','ultra'],['gpt-anything','max']])assert.throws(()=>validateBBRuntime({ownerHost:'linux',ownerThreadId,runtime:{...runtime,model,effort}}),/verified BB/);
 for(const serviceTier of ['priority','default','arbitrary'])assert.throws(()=>validateBBRuntime({ownerHost:'linux',ownerThreadId,runtime:{...runtime,serviceTier}}),/verified BB/);
});

test('same-owner Terra adoption uses the real metadata probe and preserves all historical assets and handoff',t=>{
 const f=fixture(t),before=f.store.read(),request=f.request();f.install();const receipt=adoptLineRuntime(f.store,request),after=f.store.read(),line=after.productionLines[0];
 assert.deepEqual(f.calls().map(args=>args.join(' ')),Array(2).fill('plugin rpc call reel-studio ownerMetadataEvidence --json'));
 assert.equal(receipt.schema,'reel-line-runtime-adoption/v1');assert.equal(receipt.previousRevision,3);assert.equal(receipt.revision,4);assert.equal(receipt.evidence.nativeTurnId,f.snapshot.events.length?JSON.parse(readFileSync(f.bindingPath)).nativeTurnId:null);assert.equal(receipt.evidence.previousConfigSha256,sha(readFileSync(f.configPath)));assert.equal(receipt.evidence.candidateConfigSha256,sha(readFileSync(f.candidateConfigPath)));assert.equal(receipt.receiptFingerprint,authorityHash(Object.fromEntries(Object.entries(receipt).filter(([k])=>k!=='receiptFingerprint'))));
 assert.deepEqual(line.ownerRuntime,f.nextRuntime);assert.equal(line.generation,2);assert.deepEqual(line.handoffs,before.productionLines[0].handoffs);assert.equal(line.revision,4);
 for(const key of Object.keys(before).filter(k=>!['productionLines','revision','updatedAt'].includes(k)))assert.deepEqual(after[key],before[key],key);
 const expectedLine={...before.productionLines[0],ownerRuntime:f.nextRuntime,revision:4,runtimeAdoptions:[receipt]};assert.deepEqual(line,expectedLine);assert.deepEqual(validateRuntimeAdoptionChain(line).baseRuntime,f.runtime);
 // Activate only the reviewed fixture config; production must accept the intact
 // historical Sol handoff plus the new Terra chain under a current running turn.
 json(f.configPath,f.candidate);f.store.authorityVerifier=createSourceHostAuthorityVerifier({configPath:f.configPath,python});
 const proof=f.store.authorityVerifier(f.context('line_report',{...ownerTuple(line),stage:'Verified fixture'}));assert.deepEqual(proof.runtime,f.nextRuntime);
});

test('exact adoption replay after restart changes neither global nor line revisions and does not call the verifier',t=>{
 const f=fixture(t);f.install();const a=f.request(),r=adoptLineRuntime(f.store,a),before=readFileSync(f.store.path,'utf8');
 assert.deepEqual(adoptLineRuntime(new StudioStore(f.home),a),r);assert.equal(readFileSync(f.store.path,'utf8'),before);
 assert.throws(()=>adoptLineRuntime(new StudioStore(f.home),{...a,nextRuntime:{...a.nextRuntime,cwd:'/forged'}}),/different payload/);assert.equal(readFileSync(f.store.path,'utf8'),before);
});

test('historical Sol/max production remains supported and cannot use candidate Terra evidence accidentally',t=>{
 const f=fixture(t,{selectedModel:'gpt-6.1-sol',selectedEffort:'max'});json(f.configPath,f.candidate);
 const proof=createSourceHostAuthorityVerifier({configPath:f.configPath,python})(f.context('line_report',{...ownerTuple(f.line),stage:'Historical route'}));assert.deepEqual(proof.runtime,f.runtime);
});

test('maintenance may prove the exact settled idle accepted native identity without granting production',t=>{
 const f=fixture(t,{idle:true});f.install();adoptLineRuntime(f.store,f.request());json(f.configPath,f.candidate);
 const verifier=createSourceHostAuthorityVerifier({configPath:f.configPath,python});assert.throws(()=>verifier(f.context('line_report',{...ownerTuple(f.line),stage:'No active turn'})),/current accepted running/);
 assert.throws(()=>f.store.authorityVerifier(f.context('line_begin_job',{owner:ownerTuple(f.line)})),/unsupported maintenance purpose/);
});

test('adoption rejects stale CAS and changes to immutable identity without any write',t=>{
 const f=fixture(t);f.install();const a=f.request(),before=readFileSync(f.store.path,'utf8');
 const patches=[{expectedRevision:99},{expectedGeneration:99},{expectedOwner:{...a.expectedOwner,ownerThreadId:uid()}},{expectedRuntime:{...f.runtime,effort:'ultra'}},{expectedStateFingerprint:authorityHash('stale')},...['bbThreadId','nativeThreadId','host','cwd','provider','permissionMode','serviceTier'].map(k=>({nextRuntime:{...a.nextRuntime,[k]:k==='nativeThreadId'?uid():'wrong'}})),{nextRuntime:{...a.nextRuntime,model:'unknown'}},{nextRuntime:{...a.nextRuntime,effort:'max'}}];
 for(const patch of patches){assert.throws(()=>adoptLineRuntime(f.store,{...a,...patch}));assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('adoption refuses line and host jobs, unresolved line external and publication effects',t=>{
 const cases=[s=>s.projects[0].jobs.push({status:'uncertain',computeTarget:'linux'}),s=>s.projects.push({id:uid(),jobs:[{status:'running',computeTarget:'linux'}]}),s=>s.projects.push({id:uid(),jobs:[{status:'running'}]}),s=>s.projects[0].jobs.push({status:'failed',computeTarget:'linux',external:{effect:'possibly_delivered'}}),s=>s.attempts.push({id:uid(),projectId:s.projects[0].id,status:'published',effect:'delivered_unverified'}),s=>s.releasePlans.push({id:uid(),status:'approved',items:[{projectId:s.projects[0].id}]})];
 for(const change of cases){const f=fixture(t);f.store.tx(s=>change(s));const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/active|unresolved|uncertain/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('no verifier, stale proof or forged native/config evidence cannot adopt a runtime',t=>{
 const f=fixture(t),before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/trusted server authority/);
 for(const patch of [{verifiedAt:'2001-01-01T00:00:00.000Z'},{nextRuntime:f.runtime},{owner:{...ownerTuple(f.line),ownerThreadId:uid()}},{evidence:{nativeTurnId:uid()}},{requestFingerprint:authorityHash('forged')}]){
  f.store.authorityVerifier=c=>({...c,verifiedAt:new Date().toISOString(),owner:ownerTuple(c.line),runtime:f.runtime,nextRuntime:f.nextRuntime,evidence:{nativeTurnId:uid(),...Object.fromEntries(['bindingSha256','canonicalSha256','previousConfigSha256','candidateConfigSha256','hostFingerprint'].map(k=>[k,authorityHash(k)])),requestFingerprint:c.requestFingerprint},...patch});
  assert.throws(()=>adoptLineRuntime(f.store,f.request()));assert.equal(readFileSync(f.store.path,'utf8'),before);
 }
});

test('native probe refuses mismatched current model, accepted selection and retired source runtime',t=>{
 for(const change of [f=>f.nativeChange('UPDATE threads SET model=? WHERE id=?',['gpt-6.1-sol',f.native]),f=>{f.snapshot.events[0].data.execution.reasoningLevel='max';f.saveSnapshot();},f=>f.nativeChange('UPDATE threads SET model=?, reasoning_effort=? WHERE id=?',['gpt-6.1-terra','ultra',f.source]),f=>{f.snapshot.events[2].data.providerThreadId=uid();f.saveSnapshot();}]){
  const f=fixture(t);change(f);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/model|selection|native UUID/);assert.equal(readFileSync(f.store.path,'utf8'),before);
 }
});

function locatorFixture(t){
 const f=fixture(t),env={BB_SERVER_URL:'http://127.0.0.1:32821',BB_HOST_DAEMON_PORT:'38888'};
 f.config.bb.env=env;f.candidate.bb.env={...env,BB_SERVER_URL:'http://127.0.0.1:41549'};
 json(f.configPath,f.config);f.saveCandidate();return f;
}
for(const url of ['http://127.0.0.1:41549','http://[::1]:41549/'])test('maintenance proves refreshed local locator through both metadata snapshots '+url,t=>{
 const f=locatorFixture(t);f.candidate.bb.env.BB_SERVER_URL=url;f.saveCandidate();f.install();
 const original=readFileSync(f.configPath),receipt=adoptLineRuntime(f.store,f.request());
 assert.equal(receipt.evidence.previousConfigSha256,sha(original));assert.equal(receipt.evidence.candidateConfigSha256,sha(readFileSync(f.candidateConfigPath)));
 assert.equal(f.calls().filter(args=>args[4]==='ownerMetadataEvidence').length,2);assert.deepEqual(readFileSync(f.configPath),original);
});
for(const [name,change]of [
 ...['http://example.com:41549','https://127.0.0.1:41549','http://user@127.0.0.1:41549','http://127.0.0.1:41549/path','http://127.0.0.1:41549?token=x','http://127.0.0.1:41549#x','http://127.0.0.1:0','http://127.0.0.1:65536','http://127.1:41549','http://127.0.0.1:041549','http://127.0.0.1:41549\n'].map(url=>[url,f=>f.candidate.bb.env.BB_SERVER_URL=url]),
 ['daemon change',f=>f.candidate.bb.env.BB_HOST_DAEMON_PORT='38889'],
 ['token env',f=>f.candidate.bb.env.ACCESS_TOKEN='forbidden'],
 ['conflicting alias',f=>f.candidate.bb.environment={...f.candidate.bb.env,BB_SERVER_URL:'http://127.0.0.1:41550'}],
 ['alias swap',f=>{f.candidate.bb.environment=f.candidate.bb.env;delete f.candidate.bb.env;}],
 ['executable change',f=>f.candidate.bb.executable='/bin/sh'],
 ['Node change',f=>f.candidate.bb.node='/another/node'],
 ['host identity',f=>f.candidate.bb.hostId='another-host'],
 ['unsafe original',f=>{f.config.bb.env.BB_SERVER_URL='http://example.com:32821';json(f.configPath,f.config);}],
])test('maintenance refuses locator refresh with '+name+' before metadata or Store effect',t=>{
 const f=locatorFixture(t),before=readFileSync(f.store.path);change(f);f.saveCandidate();assert.throws(f.install);assert.equal(f.calls().length,0);assert.deepEqual(readFileSync(f.store.path),before);
});
test('refreshed locator cannot adopt a mismatched exact native identity',t=>{
 const f=locatorFixture(t),before=readFileSync(f.store.path);f.snapshot.events[2].data.providerThreadId=uid();f.saveSnapshot();f.install();
 assert.throws(()=>adoptLineRuntime(f.store,f.request()),/native UUID/);assert.deepEqual(readFileSync(f.store.path),before);
});

test('refreshed locator still refuses identity drift in its second metadata snapshot',t=>{
 const f=locatorFixture(t),before=readFileSync(f.store.path),final=f.ownerMetadata();final.environment.hostId='host_foreign';f.snapshot.finalOwnerMetadata=final;f.saveSnapshot();f.install();
 assert.throws(()=>adoptLineRuntime(f.store,f.request()),/changed/);assert.deepEqual(readFileSync(f.store.path),before);assert.equal(f.calls().filter(args=>args[4]==='ownerMetadataEvidence').length,2);
});

test('private config comparison and re-read reject unapproved edits, changed preimages and nonprivate files',t=>{
 const f=fixture(t);f.candidate.source.nativeCwd='/another-source';f.saveCandidate();assert.throws(f.install,/outside target runtime/);
 f.candidate.source.nativeCwd=f.config.source.nativeCwd;f.saveCandidate();f.install();f.candidate.canonical.minimumRevision++;f.saveCandidate();assert.throws(()=>adoptLineRuntime(f.store,f.request()),/config changed/);
 chmodSync(f.candidateConfigPath,0o644);assert.throws(f.install,/0600/);
});

test('forged, reordered or stale runtime receipt chains are rejected without rewriting the handoff',t=>{
 const f=fixture(t);f.install();adoptLineRuntime(f.store,f.request());const original=f.store.read().productionLines[0];
 const forgeries=[l=>{l.runtimeAdoptions[0].nextRuntime.model='unknown';},l=>{l.runtimeAdoptions[0].receiptFingerprint=authorityHash('forged');},l=>{l.runtimeAdoptions[0].owner.ownerThreadId=uid();},l=>{l.runtimeAdoptions[0].previousRevision=2;},l=>{l.ownerRuntime={...l.ownerRuntime,cwd:'/changed'};},l=>{l.runtimeAdoptions=[];}];
 for(const forge of forgeries){const line=structuredClone(original);forge(line);if(line.runtimeAdoptions?.length&&line.runtimeAdoptions[0].receiptFingerprint!==authorityHash('forged')){const {receiptFingerprint,...body}=line.runtimeAdoptions[0];line.runtimeAdoptions[0].receiptFingerprint=authorityHash(body);}assert.throws(()=>validateRuntimeAdoptionChain(line));}
});

test('retirement maintenance proof requires protected exact legacy evidence and the currently loaded audited code',t=>{
 const f=fixture(t,{legacy:true,idle:true});f.install();const proof=f.store.authorityVerifier(f.context('line_request_retire',f.retirement()));
 assert.deepEqual(f.calls().map(args=>args[4]),['ownerMetadataEvidence','legacyOperationEvidence','ownerMetadataEvidence']);
 assert.deepEqual(proof.runtime,f.runtime);assert.equal(proof.retirement.legacyEntrySHA256,f.pin.loadedEntrySHA256);assert.equal(proof.retirement.legacyAdmission,'managed-project-cas-v1');
 for(const change of [p=>{p.operations[0].originalArgsFingerprint=authorityHash('forged');},p=>{p.runtimeInfo.loadedEntrySHA256=authorityHash('other bundle');},p=>{p.operations[0].execution={...f.runtime,effort:'ultra'};},p=>{p.operations[0].state='completed';},p=>{p.owner.ownerThreadId=uid();}]){
  const original=structuredClone(f.snapshot.legacy);change(f.snapshot.legacy);f.saveSnapshot();assert.throws(()=>f.store.authorityVerifier(f.context('line_request_retire',f.retirement())),/legacy|loaded|protected/);f.snapshot.legacy=original;f.saveSnapshot();
 }
 const without=fixture(t,{idle:true});without.install();assert.throws(()=>without.store.authorityVerifier(without.context('line_request_retire',without.retirement())),/root-owned exact legacy/);
});

test('protected metadata snapshots reject wrong schema/defaults and missing, foreign or duplicated pinned events',t=>{
 const changes=[f=>{f.snapshot.ownerMetadataSchema='unknown';},f=>{delete f.snapshot.acceptedDefaults;},f=>{f.snapshot.acceptedDefaults.source='unsupported';},f=>{f.snapshot.acceptedDefaults.model='gpt-6.1-sol';},f=>{f.snapshot.acceptedDefaults.permissionMode='workspace';},f=>{f.snapshot.acceptedDefaults.serviceTier='fast';},f=>{f.snapshot.events.splice(1,1);},f=>{f.snapshot.events[0].id=uid();},f=>{f.snapshot.events[2].threadId='thr_fixture_foreign';},f=>{f.snapshot.events.push(structuredClone(f.snapshot.events[0]));},f=>{f.snapshot.events=Array.from({length:402},()=>structuredClone(f.snapshot.events[0]));}];
 for(const change of changes){const f=fixture(t);change(f);f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/metadata|defaults|exact BB event|BB event identity/);assert.equal(readFileSync(f.store.path,'utf8'),before);assert.equal(f.calls().length,1);}
});

test('final protected metadata snapshot retains lifecycle, environment, defaults and exact pinned event equality',t=>{
 const changes=[s=>{s.thread.runtime.displayStatus='idle';},s=>{s.thread.queuedMessageCount=1;},s=>{s.thread.updatedAt++;},s=>{s.environment.hostId='host_foreign';},s=>{s.acceptedDefaults.source='client/turn/start';},s=>{s.events[2].data.clientRequestId=uid();},s=>{s.events[1].createdAt++;},s=>{s.events.splice(1,1);},s=>{s.events[1].threadId='thr_fixture_foreign';}];
 for(const change of changes){const f=fixture(t),final=f.ownerMetadata();change(final);f.snapshot.finalOwnerMetadata=final;f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/changed|exact BB event|another thread/);assert.equal(readFileSync(f.store.path,'utf8'),before);assert.deepEqual(f.calls().map(args=>args[4]),['ownerMetadataEvidence','ownerMetadataEvidence']);}
});

test('model fallback at or after the pinned request is refused in either metadata snapshot',t=>{
 for(const final of [false,true]){const f=fixture(t),event={id:uid(),threadId:f.runtime.bbThreadId,type:'provider/modelFallback',seq:4,createdAt:Date.now(),scope:'thread',data:{status:'fallback',originalModel:'gpt-6.1-terra',fallbackModel:'gpt-6.1-sol'}};
  if(final){f.snapshot.finalOwnerMetadata=f.ownerMetadata();f.snapshot.finalOwnerMetadata.events.push(event);}else f.snapshot.events.push(event);
  f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/fallback/);assert.equal(readFileSync(f.store.path,'utf8'),before);
 }
});

test('unavailable metadata RPC fails closed without falling back to thread show/log or legacy native reads',t=>{
 const f=fixture(t);f.snapshot.ownerMetadataUnavailable=true;f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/supported BB metadata read failed/);assert.equal(readFileSync(f.store.path,'utf8'),before);assert.deepEqual(f.calls().map(args=>args.join(' ')),['plugin rpc call reel-studio ownerMetadataEvidence --json']);
});

test('the fixed ten-second per-command bound accepts a simulated 6.35-second CLI startup within the unchanged overall probe budget',t=>{
 const f=fixture(t);f.snapshot.ownerMetadataDelayMsOnce=6350;f.saveSnapshot();f.install();adoptLineRuntime(f.store,f.request());assert.deepEqual(f.calls().map(args=>args[4]),['ownerMetadataEvidence','ownerMetadataEvidence']);
});
