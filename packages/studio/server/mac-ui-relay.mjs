// Keep the interface local. Tools and media still use the existing Linux MCP route.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {decodeFrame} from './stdio-compress.mjs';
import {loadRemoteConfig} from './remote-config.mjs';

export function relayStudio({input,output,child,root}){
 const version=JSON.parse(readFileSync(resolve(root,'plugin.json'),'utf8')).version;
 const uri='ui://reel-studio/workspace/'+version,listRequests=new Set();
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
  child.stdin.write(line+'\n');
 });
 remote.on('line',line=>{
  try{line=decodeFrame(line);}catch{console.error('Linux Studio returned an invalid transport frame.');child.kill?.('SIGTERM');return;}
  if(listRequests.size){
   let response;try{response=JSON.parse(line);}catch{output.write(line+'\n');return;}
   if(listRequests.delete(response.id)){
    for(const tool of response.result?.tools||[])if(['reel_open','reel_board'].includes(tool.name))tool._meta.ui.resourceUri=uri;
    for(const resource of response.result?.resources||[])if(resource.uri?.startsWith('ui://reel-studio/workspace/'))resource.uri=uri;
    send(response);return;
   }
  }
  output.write(line+'\n');
 });
 incoming.once('close',()=>child.stdin.end());
 return {uri,close:()=>{incoming.close();remote.close();child.stdin.end();}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const config=loadRemoteConfig();
 const child=spawn('ssh',['-C','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2',config.sshHost,'env',`REEL_STUDIO_HOME=${config.remoteHome}`,config.remoteNode,config.remotePlugin+'/server/stdio-compress.mjs'],{stdio:['pipe','pipe','inherit']});
 relayStudio({input:process.stdin,output:process.stdout,child,root});
 child.once('error',()=>{console.error('Linux Studio connection could not start. No MacBook fallback.');process.exitCode=1;});
 child.once('exit',code=>process.exit(code??1));
 process.stdout.once('error',()=>child.kill('SIGTERM'));
 for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>child.kill(signal));
}
