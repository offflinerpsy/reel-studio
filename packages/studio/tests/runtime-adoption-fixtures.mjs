import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {StudioStore} from '../server/store.mjs';
import {authorityHash,lineStateFingerprint,ownerTuple} from '../server/owner-authority.mjs';
import {createMaintenanceAuthorityVerifier} from '../server/owner-host/authority-verifier.mjs';

// Shared fixture setup keeps real metadata probes in bounded, focused test files.
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

export {sha,uid,python,json,fixture,retainedFixture};
