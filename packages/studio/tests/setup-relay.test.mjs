import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {forwardProtectedSetup,parseProtectedSetupURL,relayStudio} from '../server/mac-ui-relay.mjs';
import {encodeFrame} from '../server/stdio-compress.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),token='b'.repeat(64);
const setupURL=(service='azure',port=43219)=>`http://127.0.0.1:${port}/setup/${service}?key=${token}`;
function fixture({forwardSetup,host='owner@authorized-host'}={}){
 const input=new PassThrough(),output=new PassThrough(),child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
 const replies=[],sent=[],forwards=[],releases=[];let buffer='';
 output.on('data',chunk=>{buffer+=chunk;for(;;){const n=buffer.indexOf('\n');if(n<0)break;replies.push(JSON.parse(buffer.slice(0,n)));buffer=buffer.slice(n+1);}});
 child.stdin.on('data',chunk=>sent.push(String(chunk)));
 const relay=relayStudio({input,output,child,root,sshHost:host,forwardSetup:forwardSetup||(async options=>{forwards.push(options);return {localPort:54321,close:()=>{releases.push(options.remotePort);}};})});
 const request=(id,name)=>input.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{}}})+'\n');
 const respond=(id,setup,{compressed=false}={})=>{const value=JSON.stringify({jsonrpc:'2.0',id,result:{structuredContent:{setup},content:[{type:'text',text:JSON.stringify({setup})}]}});child.stdout.write((compressed?encodeFrame(value):value)+'\n');};
 const wait=async count=>{for(let i=0;i<50&&replies.length<count;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(replies.length>=count,'expected relay response');};
 return {input,output,child,replies,sent,forwards,releases,relay,request,respond,wait};
}

test('remote protected setup descriptors share one owned forwarder and preserve exact tokens',async()=>{
 const f=fixture();try{
  f.request(1,'reel_setup_read');
  const original={services:[{service:'azure',setupURL:setupURL()},{service:'youtube',setupURL:setupURL('youtube')}],engines:[{id:'claude',setupURL:setupURL('runtime')}],runtime:{setupURL:setupURL('runtime')}};
  f.respond(1,original,{compressed:true});await f.wait(1);
  assert.deepEqual(f.forwards,[{sshHost:'owner@authorized-host',remotePort:43219}]);
  const returned=f.replies[0].result.structuredContent.setup;
  assert.equal(returned.services[0].setupURL,setupURL('azure',54321));assert.equal(returned.engines[0].setupURL,setupURL('runtime',54321));assert.equal(returned.runtime.setupURL,setupURL('runtime',54321));
  assert.deepEqual(JSON.parse(f.replies[0].result.content[0].text).setup,returned);
  f.request(2,'reel_setup_check');f.respond(2,{services:[{setupURL:setupURL('telegram')}]});await f.wait(2);assert.equal(f.forwards.length,1);
  f.request(3,'reel_setup_engine');f.respond(3,{engines:[{setupURL:setupURL('runtime')}]});await f.wait(3);assert.equal(f.forwards.length,1);
  await f.relay.close();await f.relay.close();assert.deepEqual(f.releases,[43219]);assert.equal(f.child.stdin.writableEnded,true);
 }finally{await f.relay.close();}
});

test('only matching setup tool responses are rewritten; ordinary requests and resources remain exact',async()=>{
 const f=fixture();try{
  f.request(1,'reel_open');f.respond(1,{services:[{setupURL:setupURL()}]});await f.wait(1);
  assert.equal(f.replies[0].result.structuredContent.setup.services[0].setupURL,setupURL());assert.equal(f.forwards.length,0);
  f.respond(999,{services:[{setupURL:setupURL()}]});await f.wait(2);assert.equal(f.forwards.length,0);
  assert.deepEqual(JSON.parse(f.sent[0]).params,{name:'reel_open',arguments:{}});
  f.input.write(JSON.stringify({jsonrpc:'2.0',id:3,method:'resources/read',params:{uri:f.relay.uri}})+'\n');await f.wait(3);assert.equal(f.replies[2].result.contents[0].uri,f.relay.uri);
 }finally{await f.relay.close();}
});

test('invalid setup targets and tunnel failure expose an error without unsafe local fallback',async()=>{
 for(const value of [`http://localhost:43219/setup/azure?key=${token}`,`http://evil.invalid:43219/setup/azure?key=${token}`,`${setupURL()}&redirect=http://evil.invalid`,`http://127.0.0.1:65536/setup/azure?key=${token}`,`http://127.0.0.1:43219/setup/azure/../runtime?key=${token}`]){
  const f=fixture();try{
   f.request(1,'reel_setup_read');f.respond(1,{services:[{setupURL:value}]});await f.wait(1);
   assert.equal(f.forwards.length,0);assert.equal(f.replies[0].result.isError,true);assert.equal(f.replies[0].result.structuredContent.setup.services[0].setupURL,null);
  }finally{await f.relay.close();}
 }
 const f=fixture({forwardSetup:async()=>{throw Error('sensitive-ssh-diagnostic');}});try{
  f.request(1,'reel_setup_read');f.respond(1,{services:[{setupURL:setupURL()}]});await f.wait(1);
  const text=JSON.stringify(f.replies[0]);assert.match(text,/No local fallback/);assert.equal(text.includes('sensitive-ssh-diagnostic'),false);assert.equal(text.includes(setupURL()),false);
 }finally{await f.relay.close();}
});

test('configured SSH identity must be valid before calling even an injected forwarder',async()=>{
 const f=fixture({host:'-oProxyCommand=other-account'});try{
  f.request(1,'reel_setup_read');f.respond(1,{services:[{setupURL:setupURL()}]});await f.wait(1);assert.equal(f.forwards.length,0);assert.equal(f.replies[0].result.isError,true);
 }finally{await f.relay.close();}
});

test('relay shutdown releases an in-flight forwarder without returning a stale URL',async()=>{
 let finish,releases=0;
 const f=fixture({forwardSetup:()=>new Promise(resolve=>{finish=resolve;})});
 f.request(1,'reel_setup_read');f.respond(1,{services:[{setupURL:setupURL()}]});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 const closed=f.relay.close();finish({localPort:54321,close:()=>{releases++;}});await closed;
 assert.equal(releases,1);assert.equal(f.replies.length,0);
});

test('SSH forwarder uses one validated configured host and loopback-only forwarding with fail-closed options',async()=>{
 const calls=[],child=new EventEmitter();child.stderr=new PassThrough();child.exitCode=null;
 child.kill=signal=>{calls.push(['kill',signal]);child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));return true;};
 const forward=await forwardProtectedSetup({sshHost:'owner@authorized-host',remotePort:43219,portImpl:async()=>54321,probeImpl:async()=>true,spawnImpl:(...args)=>{calls.push(args);return child;}});
 assert.equal(forward.localPort,54321);assert.equal(forward.isAlive(),true);
 const [command,args,options]=calls[0];assert.equal(command,'ssh');assert.equal(options.shell,false);assert.deepEqual(args.slice(-3),['-L','127.0.0.1:54321:127.0.0.1:43219','owner@authorized-host']);assert.ok(args.includes('-N'));assert.ok(args.includes('ExitOnForwardFailure=yes'));assert.ok(args.includes('BatchMode=yes'));
 await forward.close();await forward.close();assert.deepEqual(calls.filter(call=>call[0]==='kill'),[['kill','SIGTERM']]);
 await assert.rejects(forwardProtectedSetup({sshHost:'-bad',remotePort:43219}),/Invalid configured SSH host/);
 await assert.rejects(forwardProtectedSetup({sshHost:'authorized-host',remotePort:65536}),/Invalid remote setup port/);
});

test('URL parsing rejects alternate host encodings, credentials and extra query flags',()=>{
 assert.equal(parseProtectedSetupURL(setupURL('runtime')).hostname,'127.0.0.1');
 for(const url of [`http://127.1:43219/setup/azure?key=${token}`,`http://user@127.0.0.1:43219/setup/azure?key=${token}`,`${setupURL()}#fragment`,`${setupURL()}&key=${token}`,`http://127.0.0.1:43219/setup/unknown?key=${token}`])assert.throws(()=>parseProtectedSetupURL(url),/Invalid protected setup/);
});
