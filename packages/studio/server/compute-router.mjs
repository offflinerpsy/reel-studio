import net from 'node:net';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {CodexRuntime} from './codex-runtime.mjs';
import {defaultLocalHome,defaultLocalPlugin} from './remote-config.mjs';

export function workerRequest(file,method,args={},timeoutMs=120000){
 return new Promise((resolve,reject)=>{
  let d;try{d=JSON.parse(readFileSync(file,'utf8'));if(d.host!=='127.0.0.1'||!Number.isInteger(d.port)||!/^[a-f0-9]{64}$/.test(d.key||''))throw new Error();}catch{reject(new Error('MacBook worker is not connected'));return;}
  const socket=net.connect(d.port,d.host);let buffer='';const timer=setTimeout(()=>socket.destroy(new Error('MacBook request timed out; reconcile before retrying')),timeoutMs);
  socket.once('connect',()=>socket.write(JSON.stringify({key:d.key,method,args})+'\n'));
  socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024){socket.destroy(new Error('MacBook response exceeded limit'));return;}const i=buffer.indexOf('\n');if(i<0)return;try{const r=JSON.parse(buffer.slice(0,i));if(r.error)reject(new Error(r.error));else resolve(r.result);}catch(e){reject(e);}finally{clearTimeout(timer);socket.end();}});
  socket.once('error',()=>{clearTimeout(timer);reject(new Error('MacBook is offline. Check the original job before retrying.'));});
  socket.once('close',()=>{clearTimeout(timer);if(!buffer)reject(new Error('MacBook connection closed'));});
 });
}

export class RemoteMacRuntime extends CodexRuntime{
 constructor({endpoint,proxy,remoteHome,remotePlugin,localHome=defaultLocalHome(),localPlugin=defaultLocalPlugin(),spawnImpl=spawn,request=workerRequest}={}){
  super({spawnImpl:(_binary,_args,options)=>spawnImpl(process.execPath,[proxy],{...options,env:{...process.env,REEL_MAC_ENDPOINT:endpoint}})});
  Object.assign(this,{endpoint,remoteHome,remotePlugin,localHome,localPlugin,workerRequest:request});
  this.fresh=()=>new RemoteMacRuntime({endpoint,proxy,remoteHome,remotePlugin,localHome,localPlugin,spawnImpl,request});
 }
 map(value){return typeof value==='string'?value.split(this.remoteHome).join(this.localHome).split(this.remotePlugin).join(this.localPlugin):value;}
 async health(){const r=await this.workerRequest(this.endpoint,'health',{},10000);if(r.platform!=='darwin')throw new Error('The selected worker is not this MacBook');return r;}
 async start(options){
  await this.health();const prepared=await this.workerRequest(this.endpoint,'prepare',{cwd:options.cwd});
  const expected=this.map(options.cwd);if(prepared.cwd!==expected)throw new Error('MacBook workspace readback did not match');
  return super.start({...options,cwd:prepared.cwd,prompt:this.map(options.prompt),onEvent:async e=>{
   if(e.method==='turn/completed'&&e.params?.turn?.status==='completed'){try{await this.collect({dir:options.cwd});}catch{return options.onEvent?.({method:'error',params:{transportLost:true,error:{message:'MacBook delivery transfer needs reconciliation'}}});}}
   return options.onEvent?.(e);
  }});
 }
 async collect(job){return this.workerRequest(this.endpoint,'collect',{cwd:job.dir},900000);}
 async researchAccess(options){await this.health();return super.researchAccess({...options,cwd:this.map(options.cwd)});}
 async researchRequest(args,options){await this.health();return super.researchRequest(args,{...options,cwd:this.map(options.cwd)});}
}

export class ComputeRouter{
 constructor({home,linux,macbook,defaultTarget='linux',hasActiveJobs=()=>false}={}){
  Object.assign(this,{home,routes:{linux,macbook},hasActiveJobs});this.file=join(home,'compute','selection.json');this.health={linux:false,macbook:false};this.checkedAt={};
  this.selection=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{revision:1,target:defaultTarget};
  if(!this.routes[this.selection.target])throw new Error('Saved compute location is unavailable');
 }
 selectedTarget(){return this.selection.target;}
 computeState(){return {...this.selection,scope:'new_work',sessionAndProduction:true,targets:[{id:'macbook',label:'MacBook',detail:'New chat and production on this Mac',available:this.health.macbook,checkedAt:this.checkedAt.macbook||null},{id:'linux',label:'Linux',detail:'New chat and production on the remote server',available:this.health.linux,checkedAt:this.checkedAt.linux||null}]};}
 async check(){for(const id of ['linux','macbook']){try{if(this.routes[id].health)await this.routes[id].health();else await this.routes[id].catalog();this.health[id]=true;}catch{this.health[id]=false;}this.checkedAt[id]=new Date().toISOString();}return this.computeState();}
 async select(target,expectedRevision){
  if(!Object.hasOwn(this.routes,target))throw new Error('Choose MacBook or Linux');
  if(this.selection.revision!==expectedRevision)throw new Error('The build location changed. Refresh Studio.');
  if(this.routes[target].health)await this.routes[target].health();const selectedCatalog=await this.routes[target].catalog();this.health[target]=true;this.checkedAt[target]=new Date().toISOString();
  if(this.selection.revision!==expectedRevision)throw new Error('The new-work location changed while checking. Refresh Studio.');
  const next={target,revision:this.selection.revision+1,updatedAt:new Date().toISOString()};mkdirSync(dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(next),{mode:0o600});renameSync(tmp,this.file);this.selection=next;this.selectedCatalog=selectedCatalog;
  // This is only a default for new work. Existing threads stay subscribed on
  // their original runtime, including while the other computer is selected.
  return this.computeState();
 }
 route(target=this.selectedTarget()){const route=this.routes[target];if(!route)throw new Error('The original compute location is unavailable; no fallback was started');return route;}
 catalog(){return this.route().catalog();}
 start(options){return this.route(options.computeTarget).start(options);}
 cancel(threadId,turnId,target){return this.route(target).cancel(threadId,turnId);}
 reconcile(threadId,target){return this.route(target).reconcile(threadId);}
 collect(job){return this.route(job.computeTarget).collect?.(job);}
 researchAccess(options){return this.route(options.computeTarget).researchAccess(options);}
 researchRequest(args,options){return this.route(options.computeTarget).researchRequest(args,options);}
 async close(){await Promise.all(Object.values(this.routes).map(r=>r.close()));}
}
