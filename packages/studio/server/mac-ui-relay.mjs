// Keep the interface local. Tools and media still use the existing Linux MCP route.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createConnection,createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {decodeFrame} from './stdio-compress.mjs';
import {loadRemoteConfig} from './remote-config.mjs';

const setupTools=new Set(['reel_setup_read','reel_setup_check','reel_setup_engine']);
export function parseProtectedSetupURL(value){
 const match=typeof value==='string'?value.match(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/setup\/(?:runtime|azure|dataforseo|telegram|youtube)\?key=[A-Za-z0-9_-]{24,256}$/):null;
 if(!match)throw new Error('Invalid protected setup URL');
 let url;try{url=new URL(value);}catch{throw new Error('Invalid protected setup URL');}
 if(Number(match[1])>65535)throw new Error('Invalid protected setup port');
 return url;
}
function sshHost(value){
 if(typeof value!=='string'||!/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value)||value.includes('..'))throw new Error('Invalid configured SSH host for protected setup');
 return value;
}
async function unusedLoopbackPort(){
 const server=createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
function probeLoopback(port){
 return new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port});let settled=false;
  const done=ready=>{if(settled)return;settled=true;socket.destroy();resolve(ready);};
  socket.setTimeout(200,()=>done(false));socket.once('connect',()=>done(true));socket.once('error',()=>done(false));
 });
}
export async function forwardProtectedSetup({sshHost:host,remotePort,spawnImpl=spawn,portImpl=unusedLoopbackPort,probeImpl=probeLoopback,timeoutMs=12000}){
 sshHost(host);if(!Number.isInteger(remotePort)||remotePort<1||remotePort>65535)throw new Error('Invalid remote setup port');
 const localPort=await portImpl();if(!Number.isInteger(localPort)||localPort<1||localPort>65535)throw new Error('Invalid local setup port');
 let process;
 try{process=spawnImpl('ssh',['-N','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-L',`127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,host],{shell:false,stdio:['ignore','ignore','pipe']});}
 catch{throw new Error('Protected setup SSH forwarding could not start; no local fallback');}
 let stopped=false,closed=false,closing;
 process.stderr?.on('data',()=>{});process.stderr?.on('error',()=>{});
 process.once('error',()=>{stopped=true;});process.once('exit',()=>{stopped=true;});
 const close=()=>{
  if(closed)return closing||Promise.resolve();closed=true;
  if(stopped||process.exitCode!=null)return Promise.resolve();
  closing=new Promise(resolve=>{let timer;process.once('exit',()=>{clearTimeout(timer);resolve();});process.kill('SIGTERM');timer=setTimeout(()=>{process.kill('SIGKILL');resolve();},2000);});return closing;
 };
 const deadline=Date.now()+timeoutMs;
 while(!stopped&&Date.now()<deadline){
  if(await probeImpl(localPort)&&!stopped)return {localPort,close,isAlive:()=>!stopped&&!closed};
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 await close();throw new Error('Protected setup SSH forwarding failed; no local fallback');
}

export function relayStudio({input,output,child,root,sshHost:configuredHost,forwardSetup=forwardProtectedSetup}){
 const version=JSON.parse(readFileSync(resolve(root,'plugin.json'),'utf8')).version;
 const uri='ui://reel-studio/workspace/'+version,listRequests=new Set(),setupRequests=new Map(),forwards=new Map();let closed=false,closing;
 const send=value=>output.write(JSON.stringify(value)+'\n');
 const incoming=createInterface({input}),remote=createInterface({input:child.stdout});
 incoming.on('line',line=>{
  let request;try{request=JSON.parse(line);}catch{child.stdin.write(line+'\n');return;}
  const {id,method,params}=request;
  // Existing chats can retain an older resource URI after a supported update.
  if(method==='resources/read'&&/^ui:\/\/reel-studio\/workspace\/\d+\.\d+\.\d+$/.test(params?.uri||'')){
   try{send({jsonrpc:'2.0',id,result:{contents:[{uri:params.uri,mimeType:'text/html;profile=mcp-app',text:readFileSync(resolve(root,'dist/workspace.html'),'utf8'),_meta:{ui:{csp:{resourceDomains:['data:','blob:']}},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen']}}}]}});}
   catch{send({jsonrpc:'2.0',id,error:{code:-32603,message:'The installed Studio interface could not load. Update Reel Studio.'}});}
   return;
  }
  if(['tools/list','resources/list'].includes(method))listRequests.add(id);
  if(method==='tools/call'&&setupTools.has(params?.name)&&id!==undefined)setupRequests.set(id,params.name);
  child.stdin.write(line+'\n');
 });
 const forwardURL=async value=>{
  const url=parseProtectedSetupURL(value),remotePort=Number(url.port||80);sshHost(configuredHost);
  let forward=forwards.get(remotePort);
  if(forward){const existing=await forward;if(existing.isAlive&&!existing.isAlive()){await existing.close();forwards.delete(remotePort);forward=null;}}
  if(!forward){forward=Promise.resolve().then(()=>forwardSetup({sshHost:configuredHost,remotePort})).then(owned=>{
   if(!Number.isInteger(owned?.localPort)||owned.localPort<1||owned.localPort>65535||typeof owned.close!=='function')throw new Error('Invalid protected setup forwarder');
   let release;return {...owned,close:()=>release||(release=Promise.resolve().then(()=>owned.close()))};
  });forwards.set(remotePort,forward);forward.catch(()=>{if(forwards.get(remotePort)===forward)forwards.delete(remotePort);});}
  const owned=await forward;
  if(closed){await owned.close();throw new Error('Relay closed');}
  // Replace only the port. Retain path and the exact ephemeral capability query.
  return value.replace(/^http:\/\/127\.0\.0\.1:\d+\//,`http://127.0.0.1:${owned.localPort}/`);
 };
 const rewriteSetup=async response=>{
  const setup=response.result?.structuredContent?.setup;
  if(!setup||typeof setup!=='object')return response;
  const descriptors=[...(Array.isArray(setup.services)?setup.services:[]),...(Array.isArray(setup.engines)?setup.engines:[]),...(setup.runtime&&typeof setup.runtime==='object'?[setup.runtime]:[])];
  let failed=false;
  await Promise.all(descriptors.map(async descriptor=>{
   if(!descriptor||typeof descriptor!=='object'||descriptor.setupURL===undefined||descriptor.setupURL===null)return;
   try{descriptor.setupURL=await forwardURL(descriptor.setupURL);}catch{descriptor.setupURL=null;descriptor.setupError='Remote protected setup forwarding is unavailable. No local fallback.';failed=true;}
  }));
  // Text mirrors structured content in ordinary MCP results. Update the same
  // descriptor there too, without touching unrelated resource/tool replies.
  if(response.result.content?.some(item=>item.type==='text'))response.result.content=response.result.content.map(item=>{
   if(item.type!=='text')return item;
   try{const text=JSON.parse(item.text);if(text?.setup)return {...item,text:JSON.stringify({...text,setup})};}catch{}
   return item;
  });
  if(failed){response.result.isError=true;response.result.structuredContent.error='Remote protected setup forwarding is unavailable. No local fallback.';}
  return response;
 };
 remote.on('line',line=>{
  try{line=decodeFrame(line);}catch{console.error('Linux Studio returned an invalid transport frame.');child.kill?.('SIGTERM');return;}
  if(listRequests.size||setupRequests.size){
   let response;try{response=JSON.parse(line);}catch{output.write(line+'\n');return;}
   if(listRequests.delete(response.id)){
    for(const tool of response.result?.tools||[])if(['reel_open','reel_board'].includes(tool.name))tool._meta.ui.resourceUri=uri;
    for(const resource of response.result?.resources||[])if(resource.uri?.startsWith('ui://reel-studio/workspace/'))resource.uri=uri;
    send(response);return;
   }
   if(setupRequests.delete(response.id)){
    void rewriteSetup(response).then(value=>{if(!closed)send(value);}).catch(()=>{if(!closed)send({jsonrpc:'2.0',id:response.id,error:{code:-32603,message:'Remote protected setup forwarding failed. No local fallback.'}});});return;
   }
  }
  output.write(line+'\n');
 });
 const close=()=>{
  if(closed)return closing||Promise.resolve();closed=true;
  closing=Promise.allSettled([...forwards.values()].map(async promise=>{const owned=await promise;await owned.close();})).then(()=>{forwards.clear();});
  incoming.close();remote.close();child.stdin.end();setupRequests.clear();listRequests.clear();return closing;
 };
 incoming.once('close',()=>{child.stdin.end();void close();});
 child.once?.('exit',()=>{void close();});
 return {uri,close};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const config=loadRemoteConfig();
 const child=spawn('ssh',['-C','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2',config.sshHost,'env',`REEL_STUDIO_HOME=${config.remoteHome}`,config.remoteNode,config.remotePlugin+'/server/stdio-compress.mjs'],{stdio:['pipe','pipe','inherit']});
 const relay=relayStudio({input:process.stdin,output:process.stdout,child,root,sshHost:config.sshHost});
 child.once('error',()=>{console.error('Linux Studio connection could not start. No MacBook fallback.');process.exitCode=1;});
 child.once('exit',code=>{void relay.close().finally(()=>process.exit(code??1));});
 process.stdout.once('error',()=>{void relay.close().finally(()=>child.kill('SIGTERM'));});
 for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>{void relay.close().finally(()=>child.kill(signal));});
}
