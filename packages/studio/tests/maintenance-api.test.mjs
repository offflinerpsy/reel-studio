import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync,writeFileSync,readdirSync,lstatSync,chmodSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {StudioStore} from '../server/store.mjs';
import {authorityHash,lineStateFingerprint,ownerTuple} from '../server/owner-authority.mjs';
import {maintainLine,readLineMaintenance} from '../server/maintenance-api.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const json=(path,value)=>writeFileSync(path,JSON.stringify(value)+'\n',{mode:0o600});
const clone=value=>structuredClone(value);
const cli=fileURLToPath(new URL('../scripts/line-maintenance.mjs',import.meta.url));

function fixture(t){
  const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-maintenance-api-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const data=join(home,'data'),privateDir=join(home,'private');mkdirSync(privateDir,{mode:0o700});
  const store=new StudioStore(data),native=randomUUID(),lineId=randomUUID(),projectId=randomUUID(),turnId=randomUUID();
  const runtime={kind:'bb',bbThreadId:'thr_fixture_native_maintenance_fixture',nativeThreadId:native,host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:join(home,'existing-workspace')};
  const nextRuntime={...runtime,model:'gpt-6.1-terra',effort:'ultra'};
  const line={id:lineId,revision:3,generation:2,status:'active',mode:'production',admissionVersion:1,ownerHost:'linux',ownerThreadId:native,ownerRuntime:runtime,recipe:{title:'Preserved recipe'},handoffs:[]};
  line.handoffs.push({transferId:randomUUID(),lineId,previousRevision:2,revision:3,status:'paused',previousOwner:{lineId,generation:1,ownerHost:'linux',ownerThreadId:randomUUID()},nextOwner:{...ownerTuple(line),runtime:clone(runtime)},committedAt:'2026-10-28T00:00:00.000Z',evidence:{manifest:authorityHash('retained manifest')}});
  const project={id:projectId,revision:2,title:'Existing accepted project',status:'draft',productionLineId:lineId,lineGeneration:2,computeTarget:'linux',versions:[{id:randomUUID(),sha256:authorityHash('accepted master')}],uploads:[{id:randomUUID(),sha256:authorityHash('accepted source')}],jobs:[],updatedAt:'2026-10-28T00:00:00.000Z'};
  store.tx(s=>{s.productionLines.push(line);s.projects.push(project);s.accounts.push({id:randomUUID(),account:'preserved account'});});
  const bindingPath=join(privateDir,'binding-old.json'),candidateBindingPath=join(privateDir,'binding-candidate.json');json(bindingPath,{fixture:'historical binding'});json(candidateBindingPath,{fixture:'current exact binding',nativeTurnId:turnId});
  const config={schema:'reel-source-host-authority/v1',lineId,hostname:hostname(),paths:{state:store.path,canonical:join(home,'HANDOFF.md')},target:{ownerHost:'linux',bbThreadId:runtime.bbThreadId,nativeThreadId:native,environmentDirectory:runtime.cwd,runtime},source:{threadId:line.handoffs[0].previousOwner.ownerThreadId,ownerHost:'linux',generation:1},bb:{bindingPath,bindingSha256:sha(readFileSync(bindingPath))}};
  const candidate={...clone(config),target:{...clone(config.target),runtime:nextRuntime},bb:{bindingPath:candidateBindingPath,bindingSha256:sha(readFileSync(candidateBindingPath))}};
  writeFileSync(config.paths.canonical,'Preserve this SAME handoff and accepted assets.\n');
  const configPath=join(privateDir,'authority.json'),candidateConfigPath=join(privateDir,'candidate.json');json(configPath,config);json(candidateConfigPath,candidate);
  const f={home,data,store,line,project,runtime,nextRuntime,turnId,config,candidate,configPath,candidateConfigPath,calls:[],factoryCalls:0};
  f.packet=(action,request)=>({action,configPath,candidateConfigPath,expectedConfigSha256:sha(readFileSync(configPath)),request});
  f.adoption=()=>{const s=store.read(),l=s.productionLines[0];return {lineId,adoptionId:randomUUID(),expectedRevision:l.revision,expectedGeneration:l.generation,expectedOwner:ownerTuple(l),expectedRuntime:clone(l.ownerRuntime),expectedStateFingerprint:lineStateFingerprint(s,l),nextRuntime:clone(nextRuntime)};};
  f.retirement=()=>{const s=store.read(),l=s.productionLines[0],p=s.projects[0],owner=ownerTuple(l),requestKey=randomUUID();const originalArgs={owner,projectId,requestKey,expectedRevision:p.revision,execution:clone(runtime),kind:'video',feedback:'Keep existing assets.',computeTarget:'linux'};return {retirementId:randomUUID(),owner,projectId,requestKey,expectedGeneration:l.generation,expectedRevision:p.revision,originalArgs,originalArgsFingerprint:authorityHash(originalArgs),operationId:authorityHash('exact original unresolved operation'),expectedStateFingerprint:lineStateFingerprint(s,l)};};
  // This injection is confined to temporary tests. Production CLI uses the
  // real native verifier and cannot receive a verifier in its JSON packet.
  f.verifierFactory=options=>{
    f.factoryCalls++;assert.equal(options.configPath,configPath);assert.equal(options.candidateConfigPath,candidateConfigPath);assert.equal(options.python,'/usr/bin/python3');
    const originalSha=sha(readFileSync(configPath)),candidateSha=sha(readFileSync(candidateConfigPath));
    return context=>{
      assert.equal(existsSync(join(data,'.write-lock')),true,'proof runs under the original Store lock');assert.equal(existsSync(configPath+'.binding-lock'),true,'private binding lock is held');
      f.calls.push(context.purpose);const request=context.request;
      const proof={purpose:context.purpose,requestFingerprint:context.requestFingerprint,stateFingerprint:context.stateFingerprint,verifiedAt:new Date().toISOString(),owner:ownerTuple(context.line),runtime:clone(context.line.ownerRuntime)};
      if(context.purpose==='line_runtime_adopt')Object.assign(proof,{nextRuntime:clone(nextRuntime),evidence:{nativeTurnId:turnId,bindingSha256:candidate.bb.bindingSha256,canonicalSha256:sha(readFileSync(config.paths.canonical)),requestFingerprint:context.requestFingerprint,previousConfigSha256:originalSha,candidateConfigSha256:candidateSha,hostFingerprint:authorityHash('bound native host observation')}});
      if(context.purpose==='line_request_retire')proof.retirement={...Object.fromEntries(['operationId','projectId','requestKey','originalArgsFingerprint','expectedRevision','expectedGeneration'].map(k=>[k,request[k]])),legacyAdmission:'managed-project-cas-v1',legacyEntrySHA256:authorityHash('reviewed original entry')};
      f.onVerify?.(context,proof);return proof;
    };
  };
  f.run=packet=>maintainLine(packet,{verifierFactory:f.verifierFactory});
  f.read=extra=>readLineMaintenance({configPath,lineId,projectId,...extra});
  return f;
}

function tree(path){
  const visit=(current,relative='')=>{const st=lstatSync(current),row={path:relative,type:st.isDirectory()?'directory':st.isSymbolicLink()?'symlink':'file',ino:st.ino,size:st.size,mtimeMs:st.mtimeMs,mode:st.mode&0o777};if(st.isFile())row.sha256=sha(readFileSync(current));return [row,...(st.isDirectory()?readdirSync(current).sort().flatMap(name=>visit(join(current,name),join(relative,name))):[])];};
  return visit(path);
}

test('native retirement entrypoint changes only the exact project receipt and CAS revision, never activates runtime or creates a job',t=>{
  const f=fixture(t),request=f.retirement(),before=f.store.read(),original=readFileSync(f.configPath),candidate=readFileSync(f.candidateConfigPath),result=f.run(f.packet('retire',request)),after=f.store.read();
  assert.equal(result.ok,true);assert.equal(result.action,'retire');assert.equal(result.productionStarted,false);assert.equal(result.configActivated,false);assert.equal(result.result.outcome,'retired_no_admission');
  assert.deepEqual(readFileSync(f.configPath),original);assert.deepEqual(readFileSync(f.candidateConfigPath),candidate);assert.equal(after.revision,before.revision+1);assert.deepEqual(after.productionLines,before.productionLines);assert.deepEqual(after.projects[0].jobs,[]);assert.equal(after.projects[0].revision,before.projects[0].revision+1);assert.deepEqual(after.projects[0].managedRequestRetirements,[result.result.receipt]);assert.deepEqual(f.calls,['line_request_retire']);
  const normalized=clone(after);normalized.revision=before.revision;normalized.updatedAt=before.updatedAt;normalized.projects[0].revision=before.projects[0].revision;normalized.projects[0].updatedAt=before.projects[0].updatedAt;delete normalized.projects[0].managedRequestRetirements;assert.deepEqual(normalized,before);
  const saved=readFileSync(f.store.path),again=f.run(f.packet('retire',request));assert.equal(again.result.reused,true);assert.deepEqual(readFileSync(f.store.path),saved);assert.deepEqual(f.calls,['line_request_retire']);assert.equal(existsSync(f.configPath+'.binding-lock'),false);
  const read=f.read({requestKey:request.requestKey});assert.deepEqual(read.project.retirements,[result.result.receipt]);assert.deepEqual(read.project.jobs,[]);assert.deepEqual(readFileSync(f.store.path),saved);
});

test('native adoption commits exact same-owner receipt then atomically activates only the private candidate configuration',t=>{
  const f=fixture(t),before=f.store.read(),candidate=readFileSync(f.candidateConfigPath),result=f.run(f.packet('adopt',f.adoption())),after=f.store.read();
  assert.equal(result.productionStarted,false);assert.equal(result.configActivated,true);assert.equal(result.configSha256,sha(candidate));assert.deepEqual(readFileSync(f.configPath),candidate);assert.deepEqual(readFileSync(f.candidateConfigPath),candidate);assert.equal(lstatSync(f.configPath).mode&0o777,0o600);
  assert.equal(after.revision,before.revision+1);assert.equal(after.productionLines[0].revision,before.productionLines[0].revision+1);assert.equal(after.productionLines[0].generation,before.productionLines[0].generation);assert.deepEqual(after.productionLines[0].ownerRuntime,f.nextRuntime);assert.deepEqual(after.productionLines[0].handoffs,before.productionLines[0].handoffs);assert.deepEqual(after.productionLines[0].runtimeAdoptions,[result.result]);assert.deepEqual(after.projects,before.projects);assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(f.calls,['line_runtime_adopt']);assert.equal(existsSync(f.configPath+'.binding-lock'),false);
});

for(const [name,change]of [
  ['wrong configuration preimage',(f,p)=>p.expectedConfigSha256='0'.repeat(64)],
  ['wrong hostname',(f,p)=>{f.config.hostname='another-host';json(f.configPath,f.config);p.expectedConfigSha256=sha(readFileSync(f.configPath));}],
  ['nonprivate original',(f)=>chmodSync(f.configPath,0o644)],
  ['nonprivate candidate',(f)=>chmodSync(f.candidateConfigPath,0o644)],
  ['original symlink',(f)=>{const target=f.configPath+'.real';writeFileSync(target,readFileSync(f.configPath),{mode:0o600});rmSync(f.configPath);symlinkSync(target,f.configPath);}],
])test('maintenance rejects '+name+' before native proof or Store changes',t=>{
  const f=fixture(t),packet=f.packet('adopt',f.adoption());change(f,packet);const before=tree(f.home);assert.throws(()=>f.run(packet));assert.deepEqual(tree(f.home),before);assert.deepEqual(f.calls,[]);assert.equal(f.factoryCalls,0);
});

for(const kind of ['file','directory'])test('maintenance never steals an existing '+kind+' binding lock',t=>{
  const f=fixture(t),lock=f.configPath+'.binding-lock';if(kind==='file')writeFileSync(lock,'another owner',{mode:0o600});else{mkdirSync(lock,{mode:0o700});writeFileSync(join(lock,'owner'),'another owner');}
  const before=tree(f.home);assert.throws(()=>f.run(f.packet('adopt',f.adoption())));assert.deepEqual(tree(f.home),before);assert.equal(f.factoryCalls,0);
});

test('maintenance preserves a replacement foreign lock and refuses activation after losing its own lock',t=>{
  const f=fixture(t),packet=f.packet('adopt',f.adoption()),lock=f.configPath+'.binding-lock',original=readFileSync(f.configPath),state=readFileSync(f.store.path);
  f.onVerify=()=>{rmSync(lock,{recursive:true,force:true});writeFileSync(lock,'foreign replacement lock',{mode:0o600});};
  assert.throws(()=>f.run(packet));assert.equal(readFileSync(lock,'utf8'),'foreign replacement lock');assert.deepEqual(readFileSync(f.configPath),original);assert.deepEqual(readFileSync(f.store.path),state);
});

test('same adoption packet recovers commit-before-activation failure without another native proof, receipt, or Store revision',t=>{
  const f=fixture(t),packet=f.packet('adopt',f.adoption()),original=readFileSync(f.configPath),candidate=readFileSync(f.candidateConfigPath);let refused;
  f.onVerify=()=>writeFileSync(f.candidateConfigPath,Buffer.concat([candidate,Buffer.from(' ')]));
  assert.throws(()=>f.run(packet),error=>{refused=error;return /activation|reconciliation/i.test(error.message);});
  assert.equal(refused.configActivated,false);assert.equal(refused.maintenanceResult.adoptionId,packet.request.adoptionId);assert.deepEqual(readFileSync(f.configPath),original);
  const committed=readFileSync(f.store.path),read=f.read({adoptionId:packet.request.adoptionId});assert.deepEqual(read.adoption,refused.maintenanceResult);assert.deepEqual(f.calls,['line_runtime_adopt']);
  writeFileSync(f.candidateConfigPath,candidate);f.onVerify=()=>assert.fail('the retained same adoption must not rerun proof');const recovered=f.run(packet);
  assert.equal(recovered.configActivated,true);assert.deepEqual(recovered.result,refused.maintenanceResult);assert.deepEqual(readFileSync(f.store.path),committed);assert.deepEqual(readFileSync(f.configPath),candidate);assert.deepEqual(f.calls,['line_runtime_adopt']);
});

test('missing original state is refused without creating an empty Store or any native directory',t=>{
  const f=fixture(t),missing=join(f.home,'not-an-existing-store','state.json');f.config.paths.state=missing;f.candidate.paths.state=missing;json(f.configPath,f.config);json(f.candidateConfigPath,f.candidate);const before=tree(f.home);
  assert.throws(()=>f.run(f.packet('adopt',f.adoption())));assert.deepEqual(tree(f.home),before);assert.equal(f.factoryCalls,0);
  assert.throws(()=>f.read());assert.deepEqual(tree(f.home),before);assert.equal(existsSync(missing),false);
});

test('readback requires the configured exact state.json path instead of reading a sibling Store',t=>{
  const f=fixture(t);f.config.paths.state=join(f.data,'other.json');json(f.configPath,f.config);json(f.config.paths.state,{unrelated:'private data'});const before=tree(f.home);
  assert.throws(()=>f.read());assert.deepEqual(tree(f.home),before);
});

test('native proof refusal releases only its owned binding lock and commits no Store effect',t=>{
  const f=fixture(t),packet=f.packet('adopt',f.adoption()),state=readFileSync(f.store.path),original=readFileSync(f.configPath);
  f.onVerify=()=>{throw new Error('native fixture proof refused');};assert.throws(()=>f.run(packet),/native fixture proof refused/);
  assert.deepEqual(readFileSync(f.store.path),state);assert.deepEqual(readFileSync(f.configPath),original);assert.equal(existsSync(f.configPath+'.binding-lock'),false);assert.equal(existsSync(join(f.data,'.write-lock')),false);
});

test('same-target readback is fully read-only, including missing Store working directories',t=>{
  const f=fixture(t);for(const name of ['jobs','media','exports'])rmSync(join(f.data,name),{recursive:true,force:true});const before=tree(f.home),state=JSON.parse(readFileSync(f.store.path)),read=f.read({requestKey:randomUUID(),adoptionId:randomUUID()});
  assert.equal(read.readOnly,true);assert.equal(read.storeRevision,state.revision);assert.equal(read.line.id,f.line.id);assert.equal(read.project.id,f.project.id);assert.deepEqual(read.project.jobs,[]);assert.equal(read.adoption,null);assert.deepEqual(tree(f.home),before);
});

test('maintenance CLI read uses the same read-only entrypoint and requires a private packet',t=>{
  const f=fixture(t),packetPath=join(f.home,'read-packet.json');json(packetPath,{action:'read',configPath:f.configPath,lineId:f.line.id,projectId:f.project.id});const before=tree(f.home);
  const result=spawnSync(process.execPath,[cli,'--input-file',packetPath],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).readOnly,true);assert.deepEqual(tree(f.home),before);
  chmodSync(packetPath,0o644);const invalidBefore=tree(f.home),invalid=spawnSync(process.execPath,[cli,'--input-file',packetPath],{encoding:'utf8'});assert.notEqual(invalid.status,0);assert.equal(JSON.parse(invalid.stdout).productionStarted,false);assert.deepEqual(tree(f.home),invalidBefore);
});
