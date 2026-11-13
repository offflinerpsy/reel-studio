// Private SSH-forwarded native Codex transport. Stdout is protocol only.
import net from 'node:net';
import {readFileSync} from 'node:fs';
const descriptor=JSON.parse(readFileSync(process.env.REEL_MAC_ENDPOINT,'utf8'));
if(descriptor.host!=='127.0.0.1'||!Number.isInteger(descriptor.port)||!/^[a-f0-9]{64}$/.test(descriptor.key||''))throw new Error('Invalid private Mac worker endpoint');
const socket=net.connect(descriptor.port,descriptor.host);let ready=false,buffer=Buffer.alloc(0);
const timer=setTimeout(()=>socket.destroy(new Error('MacBook did not confirm the connection')),10000);
socket.once('connect',()=>socket.write(JSON.stringify({key:descriptor.key,method:'codex'})+'\n'));
socket.on('data',chunk=>{
 if(ready){process.stdout.write(chunk);return;}
 buffer=Buffer.concat([buffer,chunk]);const i=buffer.indexOf(10);if(i<0){if(buffer.length>32768)socket.destroy();return;}
 const ack=JSON.parse(buffer.subarray(0,i));if(!ack.ready){socket.destroy(new Error('MacBook worker unavailable'));return;}
 clearTimeout(timer);ready=true;process.stdin.pipe(socket);if(buffer.length>i+1)process.stdout.write(buffer.subarray(i+1));buffer=Buffer.alloc(0);
});
socket.once('error',()=>{console.error('MacBook connection lost; reconcile the original job before retrying.');process.exitCode=1;});
socket.once('close',()=>process.exit(process.exitCode||0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{socket.destroy();process.exit(0)});
