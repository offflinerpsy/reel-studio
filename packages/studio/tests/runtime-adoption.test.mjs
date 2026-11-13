import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {StudioStore} from '../server/store.mjs';
import {authorityHash,lineStateFingerprint,ownerTuple,validateBBRuntime} from '../server/owner-authority.mjs';
import {adoptLineRuntime,validateRuntimeAdoptionChain} from '../server/runtime-adoption.mjs';
import {createMaintenanceAuthorityVerifier,createSourceHostAuthorityVerifier} from '../server/owner-host/authority-verifier.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uid=()=>randomUUID();
const python=['/opt/homebrew/bin/python3.12','/usr/bin/python3','python3'].find(binary=>spawnSync(binary,['-I','-B','-c','import tomllib, sqlite3']).status===0);
const json=(path,value)=>writeFileSync(path,JSON.stringify(value),{mode:0o600});
const pythonRun=(code,value)=>{const r=spawnSync(python,['-I','-B','-c',code],{input:JSON.stringify(value),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
const dbFixture=`import json,sqlite3,sys
v=json.load(sys.stdin)
for key,sql in {"threadsDb":"CREATE TABLE threads(id TEXT,model_provider TEXT,model TEXT,reasoning_effort TEXT,approval_mode TEXT,sandbox_policy TEXT,cwd TEXT,originator TEXT,source TEXT)","historyDb":"CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,duration_ms INTEGER,rollout_ordinal INTEGER)","queueDb":"CREATE TABLE queued_items(id TEXT,thread_id TEXT,queue_order INTEGER,created_at_ms INTEGER,updated_at_ms INTEGER)","scheduleDb":"CREATE TABLE automations(id TEXT,account_id TEXT,user_id TEXT,installation_id TEXT,legacy_automation_id TEXT,kind TEXT,target_thread_id TEXT,status TEXT,next_run_at INTEGER)"}.items():
 c=sqlite3.connect(v['paths'][key]);c.execute(sql)
 if key=='threadsDb':
  for thread,model,effort,cwd,origin in v['metadata']: c.execute('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)',(thread,'openai',model,effort,'never',json.dumps({'type':'disabled'}),cwd,origin,'{}'))
 if key=='historyDb':
  for thread,turn,status in v['turns']: c.execute('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)',(thread,turn,status,v['startedAt'],None if status=='inProgress' else v['startedAt']+1,1,1))
 if key=='scheduleDb': c.execute('INSERT INTO automations VALUES(?,?,?,?,?,?,?,?,?)',(v['scheduleId'],None,None,None,None,'heartbeat',v['source'],'ACTIVE',None))
 c.commit();c.close()
`;

function fixture(t,{selectedModel='gpt-6.1-terra',selectedEffort='ultra',selectedTier='standard',idle=false,legacy=false}={}){
 assert.ok(python,'a Python 3.11+ installation is required for the actual metadata probe');
 const home=mkdtempSync(join(tmpdir(),'reel-runtime-adoption-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const store=new StudioStore(home),lineId=uid(),native=uid(),source=uid(),turnId=uid(),sourceTurn=uid(),projectId=uid(),stamp=Math.floor(Date.now()/1000)-3;
 const runtime={kind:'bb',bbThreadId:'thr_fixture_exact_runtime_fixture',nativeThreadId:native,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:join(home,'workspace')};
 const nextRuntime={...runtime,model:selectedModel,effort:selectedEffort,serviceTier:selectedTier};
 const line={id:lineId,revision:3,generation:2,status:'active',admissionVersion:1,ownerHost:'linux',ownerThreadId:native,ownerRuntime:runtime,recipe:{title:'Preserved recipe'},handoffs:[]};
 line.handoffs.push({transferId:uid(),lineId,previousRevision:2,revision:3,status:'paused',previousOwner:{lineId,generation:1,ownerHost:'linux',ownerThreadId:source},nextOwner:{...ownerTuple(line),runtime:structuredClone(runtime)},sourceStateFingerprint:authorityHash('historical state'),evidence:{manifest:authorityHash('manifest')}});
 store.tx(s=>{s.productionLines.push(line);s.projects.push({id:projectId,productionLineId:lineId,lineGeneration:2,revision:2,title:'Keep accepted assets',versions:[{id:uid(),sha256:authorityHash('accepted master')}],jobs:[{id:uid(),status:'completed',lineGeneration:1,computeTarget:'linux'}],uploads:[]});});
 const paths={state:store.path,canonical:join(home,'canonical.md'),threadsDb:join(home,'threads.db'),historyDb:join(home,'history.db'),queueDb:join(home,'queue.db'),scheduleDb:join(home,'schedule.db')};
 const scheduleId='exact-existing-source-schedule',schedulePath=join(home,'schedule.toml'),rrule='FREQ=HOURLY;INTERVAL=1',prompt='Preserved source prompt';
 const schedule=`id = "${scheduleId}"\nstatus = "PAUSED"\nkind = "heartbeat"\ntarget_thread_id = "${source}"\nrrule = "${rrule}"\nprompt = "${prompt}"\n`;
 writeFileSync(schedulePath,schedule);writeFileSync(paths.canonical,'revision: 9\n\n## ONE next_action\nPreserve exact assets and reconcile the old request.\n');
 pythonRun(dbFixture,{paths,metadata:[[source,'gpt-6.1-sol','max',join(home,'source'),'codex'],[native,selectedModel,selectedEffort,runtime.cwd,'bb']],turns:[[source,sourceTurn,'completed'],[native,turnId,idle?'completed':'inProgress']],startedAt:stamp,source,scheduleId});
 const execution={model:selectedModel,reasoningLevel:selectedEffort,permissionMode:'full',serviceTier:selectedTier==='standard'?'default':selectedTier};
 const events=[{id:uid(),seq:1,type:'client/turn/requested',threadId:runtime.bbThreadId,createdAt:stamp*1000,scope:'thread',data:{requestId:uid(),execution}},{id:uid(),seq:2,type:'thread/identity',threadId:runtime.bbThreadId,createdAt:stamp*1000,scope:'thread',data:{providerThreadId:native}},{id:uid(),seq:3,type:'turn/input/accepted',threadId:runtime.bbThreadId,createdAt:stamp*1000,scope:'thread',data:{providerThreadId:native}}];events[2].data.clientRequestId=events[0].data.requestId;
 const target={ownerHost:'linux',bbThreadId:runtime.bbThreadId,nativeThreadId:native,projectId:uid(),environmentId:uid(),hostId:'host_fixture_linux',hostname:hostname(),environmentDirectory:runtime.cwd,runtime:nextRuntime};
 const binding={schema:'reel-bb-host-binding/v1',...Object.fromEntries(['bbThreadId','nativeThreadId','projectId','environmentId','hostId','hostname','environmentDirectory'].map(k=>[k,target[k]])),providerId:'codex',threadUpdatedAt:stamp*1000,nativeTurnId:turnId,request:{seq:1,eventId:events[0].id,execution,requestId:events[0].data.requestId,createdAt:events[0].createdAt},identity:{seq:2,eventId:events[1].id},accepted:{seq:3,eventId:events[2].id}};
 const snapshot={events,acceptedDefaults:{...execution,source:'client/turn/requested'},show:{thread:{id:target.bbThreadId,projectId:target.projectId,environmentId:target.environmentId,providerId:'codex',updatedAt:binding.threadUpdatedAt,runtime:{displayStatus:idle?'idle':'active'},queuedMessageCount:0,activeBackgroundAgentCount:0},environment:{id:target.environmentId,projectId:target.projectId,hostId:target.hostId,path:runtime.cwd,status:'ready',hostLifecycle:'active',lifecycle:{phase:'active'}}}};
 const snapshotPath=join(home,'bb-snapshot.json'),callLog=join(home,'bb-calls.jsonl'),fakeBB=join(home,'bb-fixture.mjs');json(snapshotPath,snapshot);
 writeFileSync(fakeBB,`import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const s=JSON.parse(readFileSync(${JSON.stringify(snapshotPath)},'utf8')),a=process.argv.slice(2),log=${JSON.stringify(callLog)};
const prior=existsSync(log)?readFileSync(log,'utf8').trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line)):[];
appendFileSync(log,JSON.stringify(a)+'\\n');
if(a.join(' ')==='plugin rpc call reel-studio ownerMetadataEvidence --json'){
 if(s.ownerMetadataUnavailable)process.exit(2);
 const reads=prior.filter(args=>args[4]==='ownerMetadataEvidence').length;
 if(reads===0&&s.ownerMetadataDelayMsOnce)await new Promise(resolve=>setTimeout(resolve,s.ownerMetadataDelayMsOnce));
 if(reads>0&&s.finalNativeChange){const changed=spawnSync(${JSON.stringify(python)},['-I','-B','-c','import json,sqlite3,sys;v=json.load(sys.stdin);c=sqlite3.connect(v["path"]);c.execute(v["sql"],v["args"]);c.commit();c.close()'],{input:JSON.stringify(s.finalNativeChange),encoding:'utf8'});if(changed.status!==0)process.exit(3);}
 const value=reads>0&&s.finalOwnerMetadata?s.finalOwnerMetadata:{schema:s.ownerMetadataSchema??'reel-bb-owner-metadata/v1',...s.show,acceptedDefaults:s.acceptedDefaults,events:s.events};
 console.log(JSON.stringify(value));
}else if(a.join(' ')==='plugin rpc call reel-studio legacyOperationEvidence --json')console.log(JSON.stringify(s.legacy));
else process.exit(2);
`);
 const oldBindingPath=join(home,'binding-original.json'),bindingPath=join(home,'binding-candidate.json');json(oldBindingPath,{...binding,request:{...binding.request,execution:{...execution,model:'gpt-6.1-sol',reasoningLevel:'max'}}});json(bindingPath,binding);
 const config={schema:'reel-source-host-authority/v1',lineId,hostname:hostname(),paths,source:{threadId:source,ownerHost:'linux',generation:1,nativeCwd:join(home,'source'),schedule:{id:scheduleId,path:schedulePath,pausedSha256:sha(schedule),rrule,promptSha256:sha(prompt)}},target:{...target,runtime},bb:{executable:fakeBB,node:process.execPath,hostId:target.hostId,bindingPath:oldBindingPath,bindingSha256:sha(readFileSync(oldBindingPath))},canonical:{minimumRevision:9,handoffSha256:sha(readFileSync(paths.canonical)),handoffManifestFingerprint:line.handoffs[0].evidence.manifest}};
 const candidate={...structuredClone(config),target:{...target,runtime:nextRuntime},bb:{...config.bb,bindingPath,bindingSha256:sha(readFileSync(bindingPath))}};
 const pin={schema:'reel-legacy-admission-pin/v1',operationId:authorityHash('exact old operation'),projectId,requestKey:uid(),originalArgsFingerprint:authorityHash('original normalized legacy args'),expectedRevision:2,expectedGeneration:2,legacyAdmission:'managed-project-cas-v1',loadedEntrySHA256:authorityHash('audited old native entry')};
 snapshot.legacy={owner:ownerTuple(line),operations:[{...Object.fromEntries(['operationId','projectId','requestKey','originalArgsFingerprint','expectedRevision'].map(k=>[k,pin[k]])),operation:'generate',state:'possibly_delivered',neverReplay:true,owner:ownerTuple(line),transferId:line.handoffs[0].transferId,execution:runtime}],runtimeInfo:{version:'0.1.32',ownerProtocol:2,platform:'linux',hostname:hostname(),loadedEntrySHA256:pin.loadedEntrySHA256}};
 if(legacy)candidate.legacyAdmission=pin;
 json(snapshotPath,snapshot);
 const configPath=join(home,'original-private.json'),candidateConfigPath=join(home,'candidate-private.json');json(configPath,config);json(candidateConfigPath,candidate);
 const f={home,store,line,paths,config,configPath,candidate,candidateConfigPath,snapshot,snapshotPath,pin,runtime,nextRuntime,projectId,bindingPath,source,native};
 f.calls=()=>existsSync(callLog)?readFileSync(callLog,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 f.ownerMetadata=()=>structuredClone({schema:'reel-bb-owner-metadata/v1',...snapshot.show,acceptedDefaults:snapshot.acceptedDefaults,events:snapshot.events});
 f.saveSnapshot=()=>json(snapshotPath,snapshot);f.saveCandidate=()=>json(candidateConfigPath,candidate);
 f.install=()=>store.authorityVerifier=createMaintenanceAuthorityVerifier({configPath,candidateConfigPath,python});
 f.request=()=>{const s=store.read(),l=s.productionLines[0];return {lineId,adoptionId:uid(),expectedRevision:l.revision,expectedGeneration:l.generation,expectedOwner:ownerTuple(l),expectedRuntime:structuredClone(l.ownerRuntime),expectedStateFingerprint:lineStateFingerprint(s,l),nextRuntime:structuredClone(nextRuntime)};};
 f.retirement=()=>({...Object.fromEntries(['operationId','projectId','requestKey','originalArgsFingerprint','expectedRevision','expectedGeneration'].map(k=>[k,pin[k]])),owner:ownerTuple(store.read().productionLines[0])});
 f.context=(purpose,request)=>{const s=store.read(),l=s.productionLines[0];return {purpose,request,requestFingerprint:authorityHash(request),stateFingerprint:lineStateFingerprint(s,l),line:l,state:s};};
 f.nativeChange=(sql,args=[])=>pythonRun('import json,sqlite3,sys\nv=json.load(sys.stdin);c=sqlite3.connect(v["path"]);c.execute(v["sql"],v["args"]);c.commit();c.close()', {path:paths.threadsDb,sql,args});
 f.dbChange=(key,sql,args=[])=>pythonRun('import json,sqlite3,sys\nv=json.load(sys.stdin);c=sqlite3.connect(v["path"]);c.execute(v["sql"],v["args"]);c.commit();c.close()', {path:paths[key],sql,args});
 return f;
}

function retainedFixture(t){
 const f=fixture(t,{selectedModel:'gpt-6.1-sol',selectedEffort:'xhigh',selectedTier:'fast'});
 // Seed the already accepted historical adoption. The new adoption below uses
 // real read-only SQLite/BB metadata and must preserve this prior receipt.
 const terra={...f.runtime,model:'gpt-6.1-terra',effort:'ultra'};
 f.store.tx(s=>{
  const line=s.productionLines[0],body={schema:'reel-line-runtime-adoption/v1',adoptionId:uid(),payloadHash:authorityHash('prior accepted adoption'),lineId:line.id,generation:2,owner:ownerTuple(line),previousRevision:3,revision:4,previousRuntime:structuredClone(f.runtime),nextRuntime:terra,adoptedAt:new Date(Date.now()-10000).toISOString(),evidence:{nativeTurnId:uid(),...Object.fromEntries(['bindingSha256','canonicalSha256','previousConfigSha256','candidateConfigSha256','hostFingerprint'].map(k=>[k,authorityHash(k)])),requestFingerprint:authorityHash('prior accepted adoption')}};
  line.ownerRuntime=terra;line.revision=4;line.runtimeAdoptions=[{...body,receiptFingerprint:authorityHash(body)}];
 });
 f.config.target.runtime=terra;json(f.configPath,f.config);f.runtime=terra;
 const jobId=uid(),worker=uid(),workerTurn=uid(),dir=join(f.home,'jobs',jobId);mkdirSync(dir);
 const line=f.store.read().productionLines[0],job={id:jobId,requestKey:uid(),status:'uncertain',kind:'video',lineId:line.id,lineGeneration:2,lineOwner:ownerTuple(line),computeTarget:'linux',execution:structuredClone(terra),executionPayloadHash:authorityHash('admitted exact request'),model:terra.model,effort:terra.effort,modelProvider:'openai',threadId:worker,executorThreadId:worker,turnId:workerTurn,dir,error:'File readiness needs verification: DELIVERY.json is absent',events:[]};
 f.store.tx(s=>{const p=s.projects[0];p.jobs.push(job);p.status='needs_attention';});
 f.nativeChange('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)',[worker,'openai',terra.model,terra.effort,'never','{"type":"disabled"}',dir,'reel-studio','{}']);
 const stamp=Math.floor(Date.now()/1000)-20;
 f.dbChange('historyDb','INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)',[worker,workerTurn,'completed',stamp,stamp+1,1,1]);
 const originalRequest=f.request;f.request=()=>({...originalRequest(),retainedJobId:jobId});
 return Object.assign(f,{jobId,worker,workerTurn,job});
}

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

test('Sol/xhigh/Fast adoption retains only the proven completed local worker and all uncertainty bytes',t=>{
 const f=retainedFixture(t),before=f.store.read(),request=f.request();f.install();
 const nativeBytes=Object.fromEntries(['threadsDb','historyDb','queueDb','scheduleDb'].map(k=>[k,sha(readFileSync(f.paths[k]))]));
 const verify=f.store.authorityVerifier;let proof;f.store.authorityVerifier=input=>(proof=verify(input));
 const receipt=adoptLineRuntime(f.store,request),after=f.store.read(),line=after.productionLines[0];
 assert.equal(line.ownerRuntime.model,'gpt-6.1-sol');assert.equal(line.ownerRuntime.effort,'xhigh');assert.equal(line.ownerRuntime.serviceTier,'fast');assert.equal(line.generation,2);
 assert.equal(receipt.evidence.retainedJobFingerprint,authorityHash(proof.retainedJob));assert.equal(proof.retainedJob.jobFingerprint,authorityHash(f.job));
 assert.deepEqual(after.projects,before.projects);assert.deepEqual(line.handoffs,before.productionLines[0].handoffs);assert.deepEqual(line.runtimeAdoptions.slice(0,-1),before.productionLines[0].runtimeAdoptions);
 for(const k of Object.keys(before).filter(k=>!['productionLines','revision','updatedAt'].includes(k)))assert.deepEqual(after[k],before[k],k);
 for(const [k,hash]of Object.entries(nativeBytes))assert.equal(sha(readFileSync(f.paths[k])),hash,k);
 assert.equal(f.store.nativeJobRead(f.projectId,f.jobId).job.status,'uncertain');assert.equal(f.store.nativeJobRead(f.projectId,f.jobId).job.execution.serviceTier,'standard');
 const committed=readFileSync(f.store.path,'utf8');assert.deepEqual(adoptLineRuntime(new StudioStore(f.home),request),receipt);assert.equal(readFileSync(f.store.path,'utf8'),committed);
 assert.throws(()=>adoptLineRuntime(new StudioStore(f.home),{...request,retainedJobId:uid()}),/different payload/);assert.equal(readFileSync(f.store.path,'utf8'),committed);
 // Current selected coordinator authority can read/reconcile the old standard
 // worker. It cannot launch a Fast worker through the default-tier adapter.
 json(f.configPath,f.candidate);f.store.authorityVerifier=createSourceHostAuthorityVerifier({configPath:f.configPath,python});
 const owner=ownerTuple(line),admission=f.store.projectAdmission(f.projectId,owner,'line_reconcile',{owner,projectId:f.projectId,jobId:f.jobId});
 assert.equal(admission.runtime.serviceTier,'fast');assert.deepEqual(f.store.nativeJobRead(f.projectId,f.jobId).job,f.job);
 for(const execution of [f.nextRuntime,undefined])assert.throws(()=>f.store.begin(f.projectId,{requestKey:uid(),owner,execution,expectedRevision:after.projects[0].revision,kind:'video'}),/does not support the selected Fast tier/);
 assert.equal(readFileSync(f.store.path,'utf8'),committed);
});

test('the default boundary still refuses the uncertain job and retirement cannot request an exception',t=>{
 const f=retainedFixture(t);f.install();const before=readFileSync(f.store.path,'utf8'),request=f.request();delete request.retainedJobId;
 assert.throws(()=>adoptLineRuntime(f.store,request),/active or uncertain/);
 assert.throws(()=>f.store.authorityVerifier(f.context('line_request_retire',{...f.retirement(),retainedJobId:f.jobId})),/only runtime adoption/);
 assert.equal(readFileSync(f.store.path,'utf8'),before);
});

test('a retained reference cannot exempt foreign, active, external, changed or ambiguous admissions',t=>{
 const changes=[
  s=>s.projects[0].jobs.at(-1).status='running',s=>s.projects[0].jobs.at(-1).status='starting',s=>s.projects[0].jobs.at(-1).status='cancel_requested',
  s=>s.projects[0].jobs.at(-1).external={effect:'possibly_delivered'},s=>s.projects[0].jobs.at(-1).lineGeneration=1,
  s=>s.projects[0].jobs.at(-1).lineOwner.ownerThreadId=uid(),s=>s.projects[0].jobs.at(-1).computeTarget='macbook',
  s=>s.projects[0].jobs.at(-1).execution.effort='max',s=>s.projects[0].jobs.at(-1).model='gpt-6.1-sol',
  s=>s.projects[0].jobs.at(-1).threadId=s.productionLines[0].ownerThreadId,s=>s.projects[0].jobs.at(-1).executorThreadId=uid(),
  s=>s.projects[0].jobs.at(-1).versionId=uid(),s=>s.projects[0].jobs.at(-1).executionPayloadHash='bad',
  s=>s.projects.push({id:uid(),jobs:[structuredClone(s.projects[0].jobs.at(-1))]})
 ];
 for(const change of changes){const f=retainedFixture(t);f.store.tx(change);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/retained/);assert.equal(readFileSync(f.store.path,'utf8'),before);assert.equal(f.calls().length,0);}
 for(const retainedJobId of ['not-a-uuid',uid(),null]){const f=retainedFixture(t);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,{...f.request(),retainedJobId}),/retained/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('the retained exception leaves other line/host jobs and all publication effects blocking',t=>{
 const changes=[s=>s.projects[0].jobs.push({id:uid(),status:'uncertain',computeTarget:'linux'}),s=>s.projects.push({id:uid(),jobs:[{id:uid(),status:'running',computeTarget:'linux'}]}),s=>s.projects.push({id:uid(),jobs:[{id:uid(),status:'uncertain'}]}),s=>s.projects[0].jobs.push({id:uid(),status:'failed',external:{effect:'possibly_delivered'}}),s=>s.attempts.push({id:uid(),projectId:s.projects[0].id,status:'published',effect:'delivered_unverified'}),s=>s.releasePlans.push({id:uid(),status:'approved',items:[{projectId:s.projects[0].id}]})];
 for(const change of changes){const f=retainedFixture(t);f.store.tx(change);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/active|unresolved|uncertain/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('independent retained worker proof requires exact completed turn, Studio origin, original runtime/cwd and an empty tree queue',t=>{
 const changes=[
  f=>f.nativeChange('UPDATE threads SET originator=? WHERE id=?',['bb',f.worker]),
  f=>f.nativeChange('UPDATE threads SET cwd=? WHERE id=?',['/another-job',f.worker]),
  f=>f.nativeChange('UPDATE threads SET model=? WHERE id=?',['gpt-6.1-sol',f.worker]),
  f=>f.dbChange('historyDb','UPDATE thread_turns SET status=?,completed_at=NULL WHERE thread_id=?',['inProgress',f.worker]),
  f=>f.dbChange('historyDb','UPDATE thread_turns SET turn_id=? WHERE thread_id=?',[uid(),f.worker]),
  f=>f.dbChange('queueDb','INSERT INTO queued_items VALUES(?,?,?,?,?)',[uid(),f.worker,1,1,1]),
  f=>f.store.tx(s=>{s.projects[0].jobs.at(-1).dir=f.home;}),
  f=>{const child=uid();f.nativeChange('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)',[child,'openai','gpt-6.1-terra','ultra','never','{"type":"disabled"}',f.job.dir,'reel-studio',JSON.stringify({subagent:{thread_spawn:{parent_thread_id:f.worker}}})]);f.dbChange('historyDb','INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)',[child,uid(),'inProgress',1,null,null,1]);},
  f=>{const child=uid();f.nativeChange('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)',[child,'openai','gpt-6.1-terra','ultra','never','{"type":"disabled"}',f.job.dir,'reel-studio',JSON.stringify({subagent:{thread_spawn:{parent_thread_id:f.worker}}})]);f.dbChange('historyDb','INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)',[child,uid(),'completed',1,2,1,1]);f.dbChange('queueDb','INSERT INTO queued_items VALUES(?,?,?,?,?)',[uid(),child,1,1,1]);}
 ];
 for(const change of changes){const f=retainedFixture(t);change(f);f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/retained|native model|native access/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('retained worker state changing during the final BB snapshot fails before adoption',t=>{
 const f=retainedFixture(t);f.snapshot.finalNativeChange={path:f.paths.historyDb,sql:'UPDATE thread_turns SET status=?,completed_at=NULL WHERE thread_id=?',args:['inProgress',f.worker]};f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');
 assert.throws(()=>adoptLineRuntime(f.store,f.request()),/retained native worker/);assert.equal(readFileSync(f.store.path,'utf8'),before);
});

test('retained job evidence is mandatory, exact and hash bound before any adoption write',t=>{
 const changes=[proof=>delete proof.retainedJob,proof=>proof.retainedJob.jobId=uid(),proof=>proof.retainedJob.jobFingerprint=authorityHash('different job'),proof=>proof.retainedJob.nativeFingerprint='bad',proof=>delete proof.evidence.retainedJobFingerprint,proof=>proof.evidence.retainedJobFingerprint=authorityHash('different proof')];
 for(const change of changes){const f=retainedFixture(t);f.install();const verify=f.store.authorityVerifier;f.store.authorityVerifier=input=>{const proof=verify(input);change(proof);return proof;};const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/terminal local job evidence/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
});

test('Fast adoption is rejected when accepted defaults or pinned request tier differs',t=>{
 for(const change of [f=>f.snapshot.acceptedDefaults.serviceTier='default',f=>f.snapshot.events[0].data.execution.serviceTier='default']){const f=retainedFixture(t);change(f);f.saveSnapshot();f.install();const before=readFileSync(f.store.path,'utf8');assert.throws(()=>adoptLineRuntime(f.store,f.request()),/defaults|selection/);assert.equal(readFileSync(f.store.path,'utf8'),before);}
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
