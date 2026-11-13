import {readFileSync,lstatSync,fstatSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,rmSync,constants} from 'node:fs';
import {isAbsolute,dirname,join} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {StudioStore} from './store.mjs';
import {adoptLineRuntime} from './runtime-adoption.mjs';
import {reconcileManagedRequest} from './request-reconciliation.mjs';
import {createMaintenanceAuthorityVerifier} from './owner-host/authority-verifier.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function privateFile(path){
  if(!isAbsolute(path||''))throw new Error('A private absolute configuration path is required.');
  const before=lstatSync(path);
  if(!before.isFile()||before.isSymbolicLink()||before.size>65536||(before.mode&0o777)!==0o600||![0,process.getuid?.()].includes(before.uid))throw new Error('The configuration must be a bounded server-owned 0600 file.');
  const bytes=readFileSync(path),after=lstatSync(path);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('The private configuration changed during read.');
  return {bytes,sha256:digest(bytes),config:JSON.parse(bytes)};
}

/** Native local maintenance entrypoint. It uses the original Store transaction
 * and trusted host verifier. It never executes a worker or writes raw state.
 */
export function maintainLine({action,configPath,candidateConfigPath,expectedConfigSha256,request}, {verifierFactory=createMaintenanceAuthorityVerifier}={}){
  if(!['retire','adopt'].includes(action)||!/^[a-f0-9]{64}$/.test(expectedConfigSha256||''))throw new Error('An exact maintenance action and configuration preimage are required.');
  const original=privateFile(configPath),candidate=privateFile(candidateConfigPath);
  if(original.sha256!==expectedConfigSha256||original.config.hostname!==hostname())throw new Error('The original host/configuration preimage changed.');
  const state=original.config.paths?.state;
  if(!isAbsolute(state||'')||state!==join(dirname(state),'state.json'))throw new Error('The original Studio state path is required.');
  const stateStat=lstatSync(state);
  if(!stateStat.isFile()||stateStat.isSymbolicLink()||stateStat.size>33554432)throw new Error('The existing Studio Store must be a bounded regular file.');
  const lock=configPath+'.binding-lock';
  const lockFd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),lockStat=fstatSync(lockFd);
  const token=JSON.stringify({pid:process.pid,operation:'native-line-maintenance',token:randomUUID()})+'\n';
  let lockInitialized=false;
  const sameLockFile=()=>{try{const st=lstatSync(lock);return st.isFile()&&!st.isSymbolicLink()&&st.dev===lockStat.dev&&st.ino===lockStat.ino;}catch{return false;}};
  const ownsLock=()=>{try{return sameLockFile()&&readFileSync(lock,'utf8')===token;}catch{return false;}};
  const assertLock=()=>{if(!ownsLock())throw new Error('The maintenance configuration lock ownership changed.');};
  let configActivated=false,result;
  try{
    writeFileSync(lockFd,token);fsyncSync(lockFd);lockInitialized=true;
    if(privateFile(configPath).sha256!==original.sha256||privateFile(candidateConfigPath).sha256!==candidate.sha256)throw new Error('Configuration changed before maintenance.');
    const verify=verifierFactory({configPath,candidateConfigPath,python:'/usr/bin/python3'});
    const store=new StudioStore(dirname(state),{requireExisting:true,authorityVerifier:input=>{assertLock();const proof=verify(input);assertLock();return proof;}});
    result=action==='retire'?reconcileManagedRequest(store,request):adoptLineRuntime(store,request);
    assertLock();
    if(action==='adopt'){
      // The retained adoption receipt is the recovery point if activation fails.
      // The same adoption UUID may be read/reconciled; never issue another one.
      if(result.evidence.previousConfigSha256!==original.sha256||result.evidence.candidateConfigSha256!==candidate.sha256||privateFile(configPath).sha256!==original.sha256||privateFile(candidateConfigPath).sha256!==candidate.sha256)throw new Error('Runtime adopted; exact configuration activation requires reconciliation.');
      const temp=join(dirname(configPath),'.authority-'+randomUUID()+'.tmp');
      const fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      try{writeFileSync(fd,candidate.bytes);fsyncSync(fd);}finally{closeSync(fd);}
      try{
        assertLock();
        if(privateFile(configPath).sha256!==original.sha256||privateFile(candidateConfigPath).sha256!==candidate.sha256)throw new Error('Runtime adopted; configuration changed before atomic activation.');
        renameSync(temp,configPath);
      }catch(error){rmSync(temp,{force:true});throw error;}
      const dir=openSync(dirname(configPath),constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}
      if(privateFile(configPath).sha256!==candidate.sha256)throw new Error('Runtime adopted; configuration activation readback failed.');
      configActivated=true;
    }
    return {ok:true,action,result,configActivated,configSha256:privateFile(configPath).sha256,productionStarted:false};
  }catch(error){
    if(result){error.maintenanceResult=result;error.configActivated=configActivated;}
    throw error;
  }finally{
    const owned=lockInitialized?ownsLock():sameLockFile();closeSync(lockFd);
    if(owned)unlinkSync(lock);
    else{const error=new Error('The maintenance lock was replaced; foreign lock preserved.');if(result){error.maintenanceResult=result;error.configActivated=configActivated;}throw error;}
  }
}

/** Same-target readback after any lost maintenance response. No repair replay. */
export function readLineMaintenance({configPath,lineId,projectId,requestKey,adoptionId}){
  const {config,sha256}=privateFile(configPath);
  if(config.hostname!==hostname()||config.lineId!==lineId)throw new Error('The exact configured host/direction is required.');
  if(!isAbsolute(config.paths?.state||'')||config.paths.state!==join(dirname(config.paths.state),'state.json'))throw new Error('The original Studio state path is required.');
  const store=new StudioStore(dirname(config.paths.state),{requireExisting:true}),state=store.read(),line=state.productionLines.find(l=>l.id===lineId);
  if(!line)throw new Error('The configured direction is missing.');
  const project=projectId?state.projects.find(p=>p.id===projectId&&p.productionLineId===lineId):null;
  return {schema:'reel-line-maintenance-readback/v1',readOnly:true,storeRevision:state.revision,configSha256:sha256,
    line:{id:line.id,revision:line.revision,generation:line.generation,ownerRuntime:line.ownerRuntime,runtimeAdoptions:line.runtimeAdoptions??[]},
    project:project?{id:project.id,revision:project.revision,jobs:project.jobs.filter(j=>!requestKey||j.requestKey===requestKey),retirements:(project.managedRequestRetirements??[]).filter(r=>!requestKey||r.requestKey===requestKey)}:null,
    adoption:adoptionId?(line.runtimeAdoptions??[]).find(r=>r.adoptionId===adoptionId)??null:null};
}
