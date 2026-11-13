// This MacBook's optional compute worker. The shared Studio library stays on Linux.
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {join,dirname,posix} from 'node:path';
import {platform} from 'node:os';
import {loadRemoteConfig} from './remote-config.mjs';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {macInputFiles} from './revision-inputs.mjs';

const config=loadRemoteConfig();
if(platform()!=='darwin')throw new Error('The worker must run on the configured MacBook');
const localHome=config.localHome,runtime=join(localHome,'runtime');mkdirSync(runtime,{recursive:true,mode:0o700});
const key=randomBytes(32).toString('hex');const children=new Set();let tunnel;
function command(binary,args,{input,timeout=180000}={}){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HEYGEN_NO_ANALYTICS:'1'}});children.add(child);let output='';child.stdout.on('data',x=>{if(output.length<1024*1024)output+=x});child.stderr.on('data',()=>{});const timer=setTimeout(()=>child.kill(),timeout);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);children.delete(child);code===0?resolve(output):reject(new Error('File transfer or native command failed; reconcile before retrying'))});if(input)child.stdin.write(input);child.stdin.end();});}
function cwdMap(cwd){if(cwd===config.remoteHome)return localHome;const suffix=cwd.slice(config.remoteHome.length);if(!cwd.startsWith(config.remoteHome+'/jobs/')||!/^\/jobs\/[a-f0-9-]{36}$/.test(suffix))throw new Error('Choose a Studio-owned job folder');return localHome+suffix;}
async function pull(remote,local,isDir=false){if(posix.normalize(remote)!==remote||!/^[A-Za-z0-9/_.-]+$/.test(remote)||(!remote.startsWith(config.remoteHome+'/jobs/')&&!remote.startsWith(config.remoteHome+'/media/')))throw new Error('Source must belong to the shared Studio');mkdirSync(isDir?local:dirname(local),{recursive:true,mode:0o700});await command('/usr/bin/rsync',['-a','--partial','--exclude=node_modules','--exclude=.venv',config.sshHost+':'+remote+(isDir?'/':''),local+(isDir?'/':'')]);}
async function prepare({cwd}){
 const local=cwdMap(cwd);mkdirSync(local,{recursive:true,mode:0o700});if(cwd===config.remoteHome)return {cwd:local};await pull(cwd,local,true);
 const brief=JSON.parse(readFileSync(join(local,'brief.json'),'utf8'));
 for(const input of macInputFiles(brief,config.remoteHome)){
  const path=localHome+input.path.slice(config.remoteHome.length);await pull(input.path,path,input.isDir);
  if(input.sha256&&createHash('sha256').update(readFileSync(path)).digest('hex')!==input.sha256)throw new Error('The transferred revision input did not match its saved SHA-256');
 }
 return {cwd:local};
}
async function collect({cwd}){const local=cwdMap(cwd);if(cwd===config.remoteHome||!existsSync(join(local,'DELIVERY.json')))throw new Error('The original MacBook job has no complete delivery receipt');await command('/usr/bin/rsync',['-a','--partial','--exclude=node_modules','--exclude=.venv',local+'/',config.sshHost+':'+cwd+'/'],{timeout:900000});return {copied:true,cwd};}
const server=net.createServer(socket=>{
 let buffer=Buffer.alloc(0),accepted=false;const timeout=setTimeout(()=>socket.destroy(),10000);
 const first=async chunk=>{if(accepted)return;buffer=Buffer.concat([buffer,chunk]);const i=buffer.indexOf(10);if(buffer.length>32768){socket.destroy();return;}if(i<0)return;accepted=true;clearTimeout(timeout);socket.off('data',first);
  try{const message=JSON.parse(buffer.subarray(0,i));const supplied=message.key;if(typeof supplied!=='string'||supplied.length!==key.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))throw new Error('Worker authentication failed');
   if(message.method==='codex'){
    const child=spawn(config.codexBinary||'codex',['app-server','--stdio'],{shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HEYGEN_NO_ANALYTICS:'1'}});children.add(child);child.stderr.on('data',()=>{});child.on('error',()=>socket.destroy());child.once('exit',()=>{children.delete(child);socket.end()});socket.write(JSON.stringify({ready:true,platform:'darwin'})+'\n');socket.pipe(child.stdin);child.stdout.pipe(socket);if(buffer.length>i+1)child.stdin.write(buffer.subarray(i+1));socket.once('close',()=>child.kill());return;
   }
   const result=message.method==='health'?{platform:'darwin',host:'MacBook',ready:true}:message.method==='prepare'?await prepare(message.args||{}):message.method==='collect'?await collect(message.args||{}):(()=>{throw new Error('Unknown worker command')})();socket.end(JSON.stringify({result})+'\n');
  }catch(e){socket.end(JSON.stringify({error:e.message})+'\n');}
 };socket.on('data',first);socket.on('error',()=>{});socket.once('close',()=>clearTimeout(timeout));
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const localPort=server.address().port,remotePort=38167;
tunnel=spawn('/usr/bin/ssh',['-N','-T','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-R',`127.0.0.1:${remotePort}:127.0.0.1:${localPort}`,config.sshHost],{stdio:['ignore','ignore','pipe']});tunnel.stderr.on('data',()=>{});tunnel.once('error',()=>process.exit(1));tunnel.once('exit',()=>process.exit(1));
await new Promise(resolve=>setTimeout(resolve,1500));if(tunnel.exitCode!==null)throw new Error('The private MacBook link could not start');
const descriptor=JSON.stringify({host:'127.0.0.1',port:remotePort,key,registeredAt:new Date().toISOString(),platform:'darwin'});
await command('/usr/bin/ssh',[config.sshHost,`umask 077; mkdir -p ${config.remoteHome}/compute; cat > ${config.remoteHome}/compute/macbook.json.tmp; mv ${config.remoteHome}/compute/macbook.json.tmp ${config.remoteHome}/compute/macbook.json`],{input:descriptor,timeout:20000});
writeFileSync(join(runtime,'worker.json'),JSON.stringify({pid:process.pid,localPort,remotePort,startedAt:new Date().toISOString()}),{mode:0o600});chmodSync(join(runtime,'worker.json'),0o600);
console.error('MacBook compute is connected privately. No production job was started.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{tunnel.kill();for(const child of children)child.kill();server.close(()=>process.exit(0))});
