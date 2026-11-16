// Synthetic stubs only: no Studio process, media, account or network effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import expected from '../capabilities.json' with {type:'json'};
import {createReelGateway,verifyCapabilities,verifyNodeRuntime,UI_TOOLS,validateMediaUri} from '../src/reel-gateway.mjs';
const workers=['reel_state','reel_publication_job','reel_release_plan','reel_connection_record','reel_publication_result','reel_release_plan_result'];
const catalog=()=>({tools:[...new Set([...UI_TOOLS,...workers])].map(name=>({name,inputSchema:structuredClone(expected.schemas[name]),_meta:{ui:{visibility:['app','model']}}}))});
function transportFixture(options={}){
 const launches=[],verified=[],runtimes=[];
 const client={connect:async()=>{},getServerVersion:()=>({version:expected.sourceVersion}),listTools:async()=>catalog(),readResource:async({uri})=>({contents:[{uri,text:'<!doctype html><html><head></head><body>Studio</body></html>'}]}),close:async()=>{},...options.client};
 const gateway=createReelGateway({root:'/trusted/studio',env:{},verifyInstalled:async(...args)=>{verified.push(args);},verifyRuntime:async(...args)=>{runtimes.push(args);},...options,clientFactory:()=>client,transportFactory:config=>{launches.push(config);return {stderr:{resume(){}},close:async()=>{}};}});
 return {gateway,launches,verified,runtimes};
}
test('same-release catalog must retain every allowed schema and visibility',()=>{
 const good=catalog();verifyCapabilities(good);
 const changed=catalog();changed.tools[0].inputSchema={type:'string'};assert.throws(()=>verifyCapabilities(changed),/CAPABILITY_CHANGED/);
 const missing=catalog();missing.tools.pop();assert.throws(()=>verifyCapabilities(missing),/CAPABILITY_CHANGED/);
});
test('handoffs require binding and failed tool calls are never replayed',async()=>{
 let calls=0,authorized=0;
 const client={connect:async()=>{},getServerVersion:()=>({version:expected.sourceVersion}),listTools:async()=>catalog(),callTool:async()=>{calls++;throw new Error('transport lost');},close:async()=>{}};
 const gateway=createReelGateway({verifyInstalled:async()=>{},verifyRuntime:async()=>{},clientFactory:()=>client,transportFactory:()=>({stderr:{resume(){}},close:async()=>{}}),authorizeHandoff:async binding=>{authorized++;if(!binding)throw new Error('binding required');}});
 await assert.rejects(gateway.call({name:'reel_browser_prepare'}),/binding required/);assert.equal(calls,0);
 await assert.rejects(gateway.call({name:'reel_browser_prepare',binding:{}}),/transport lost/);assert.equal(calls,1);assert.equal(authorized,2);
 await assert.rejects(gateway.call({name:'arbitrary_tool'}),/NOT_ALLOWED/);assert.equal(calls,1);await gateway.dispose();
});
test('media resource paths remain constrained',()=>{assert.throws(()=>validateMediaUri('file:///private/data'));assert.throws(()=>validateMediaUri('reel-media-info://studio/../../data'));assert.equal(validateMediaUri('reel-media-info://studio/kinetic.jpg'),'reel-media-info://studio/kinetic.jpg');});
test('Studio settings are app tools and cannot become worker execution tools',async()=>{
 const gateway=createReelGateway();
 for(const name of ['reel_settings_read','reel_settings_save','reel_settings_export']){
  assert.ok(UI_TOOLS.includes(name));
  await assert.rejects(()=>gateway.handoffCall({name}),/TOOL_NOT_ALLOWED/);
 }
 await gateway.dispose();
});
test('absent remote configuration launches only the local engine and reports the local route',async()=>{
 const f=transportFixture({env:{PRESERVED:'value',NON_STRING:3}});
 assert.equal((await f.gateway.workspace()).route,'local');
 assert.deepEqual(f.verified,[['/trusted/studio','/trusted/studio/dist/server.mjs',undefined]]);
 assert.deepEqual(f.launches,[{command:'node',args:['/trusted/studio/dist/server.mjs'],cwd:'/trusted/studio',env:{PRESERVED:'value',REEL_STUDIO_HOME:join(homedir(),'.local','share','reel-studio-bb')},stderr:'pipe'}]);
 await f.gateway.dispose();
});
test('explicit remote configuration launches only the SSH relay with its exact environment and reports ssh',async()=>{
 const env={REEL_REMOTE_CONFIG:'/trusted/remote.json',REEL_STUDIO_HOME:'/trusted/library',PRESERVED:'value'},f=transportFixture({env});
 // A later environment mutation must not silently switch the selected route
 // or pair a validated config with a different launch configuration.
 env.REEL_REMOTE_CONFIG='/changed/config.json';
 assert.equal((await f.gateway.workspace()).route,'ssh');
 assert.deepEqual(f.verified,[['/trusted/studio','/trusted/studio/server/mac-ui-relay.mjs','/trusted/remote.json']]);
 assert.deepEqual(f.launches,[{command:'node',args:['/trusted/studio/server/mac-ui-relay.mjs'],cwd:'/trusted/studio',env:{REEL_REMOTE_CONFIG:'/trusted/remote.json',REEL_STUDIO_HOME:'/trusted/library',PRESERVED:'value'},stderr:'pipe'}]);
 await f.gateway.dispose();
});
test('present but empty or invalid remote config path fails before any launch without local fallback',async()=>{
 for(const value of ['',undefined,' ','remote.json','/trusted/../remote.json','/trusted/remote\0.json']){
  const f=transportFixture({env:{REEL_REMOTE_CONFIG:value}});
  await assert.rejects(()=>f.gateway.workspace(),/REEL_REMOTE_CONFIG_INVALID:.*No local fallback/);
  assert.deepEqual(f.launches,[]);assert.deepEqual(f.verified,[]);await f.gateway.dispose();
 }
});
test('source verification checks only the selected entrypoint and validates remote JSON with the Studio validator',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reel-bb-route-'));
 try{
  await writeFile(join(root,'plugin.json'),JSON.stringify({version:expected.sourceVersion}));
  await mkdir(join(root,'dist'));await writeFile(join(root,'dist','server.mjs'),'// local fixture');
  const local=transportFixture({root,verifyInstalled:undefined});
  assert.equal((await local.gateway.workspace()).route,'local');await local.gateway.dispose();
  await rm(join(root,'dist'),{recursive:true});
  await mkdir(join(root,'server'));await writeFile(join(root,'server','mac-ui-relay.mjs'),'// remote fixture');
  await copyFile(new URL('../../studio/server/remote-config.mjs',import.meta.url),join(root,'server','remote-config.mjs'));
  const configPath=join(root,'remote.json'),config={sshHost:'studio-server',remoteHome:'/srv/reel/library',remotePlugin:'/srv/reel/plugin',remoteNode:'/usr/bin/node'};
  await writeFile(configPath,JSON.stringify(config));
  const remote=transportFixture({root,env:{REEL_REMOTE_CONFIG:configPath},verifyInstalled:undefined});
  assert.equal((await remote.gateway.workspace()).route,'ssh');assert.equal(remote.launches.length,1);await remote.gateway.dispose();
  for(const invalid of ['{',JSON.stringify({...config,sshHost:'-oProxyCommand=unsafe'})]){
   await writeFile(configPath,invalid);
   const rejected=transportFixture({root,env:{REEL_REMOTE_CONFIG:configPath},verifyInstalled:undefined});
   await assert.rejects(()=>rejected.gateway.workspace(),/REEL_REMOTE_CONFIG_OR_INSTALLATION_INVALID:.*No local fallback/);
   assert.equal(rejected.launches.length,0);await rejected.gateway.dispose();
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('the SSH route still rejects changed release or catalog and never starts a fallback process',async()=>{
 const changedCatalog=catalog();changedCatalog.tools[0].inputSchema={type:'string'};
 for(const [client,error]of [
  [{getServerVersion:()=>({version:'different'})},/RELEASE_MISMATCH/],
  [{listTools:async()=>changedCatalog},/CAPABILITY_CHANGED/],
  [{connect:async()=>{throw Error('SSH transport unavailable');}},/SSH transport unavailable/],
 ]){
  const f=transportFixture({env:{REEL_REMOTE_CONFIG:'/trusted/remote.json'},client});
  await assert.rejects(()=>f.gateway.workspace(),error);
  assert.equal(f.launches.length,1);assert.deepEqual(f.launches[0].args,['/trusted/studio/server/mac-ui-relay.mjs']);await f.gateway.dispose();
 }
});
test('a desktop host executable is never reused as the Node command',async()=>{
 const original=process.execPath;
 try{
  // Simulate the exact native QA failure without ever launching this path.
  process.execPath='/Applications/bb.app/Contents/MacOS/bb';
  const f=transportFixture();await f.gateway.workspace();
  assert.equal(f.launches[0].command,'node');assert.equal(f.runtimes[0][0],'node');await f.gateway.dispose();
 }finally{process.execPath=original;}
});
test('an explicit Node override is validated and used by both version probe and child transport',async()=>{
 const f=transportFixture({env:{REEL_NODE_BIN:'/opt/runtime/node',PATH:'/trusted/bin'}});await f.gateway.workspace();
 assert.equal(f.launches[0].command,'/opt/runtime/node');
 assert.deepEqual(f.runtimes,[['/opt/runtime/node',{env:f.launches[0].env,cwd:'/trusted/studio'}]]);await f.gateway.dispose();
 for(const value of ['',undefined,'node','/opt/../runtime/node','/opt/node\0']){
  const rejected=transportFixture({env:{REEL_NODE_BIN:value}});
  await assert.rejects(()=>rejected.gateway.workspace(),/REEL_NODE_BIN_INVALID/);assert.equal(rejected.launches.length,0);assert.equal(rejected.runtimes.length,0);await rejected.gateway.dispose();
 }
});
test('Node prerequisite checks use the selected environment and reject old, missing or non-Node runtimes clearly',async()=>{
 const calls=[],options={env:{PATH:'/trusted/bin'},cwd:'/trusted/studio'};
 await verifyNodeRuntime('node',options,async(...args)=>{calls.push(args);return {stdout:'v22.19.0\n'};});
 assert.deepEqual(calls,[['node',['--version'],{...options,encoding:'utf8',timeout:5000,maxBuffer:4096,windowsHide:true}]]);
 for(const stdout of ['v20.19.0','bb 0.49.0','v1.3.0',''])await assert.rejects(()=>verifyNodeRuntime('node',options,async()=>({stdout})),/REEL_NODE_REQUIRED: Node.js 22 or newer/);
 await assert.rejects(()=>verifyNodeRuntime('node',options,async()=>{throw Error('ENOENT');}),/REEL_NODE_REQUIRED: Node.js 22 or newer could not start/);
 const rejected=transportFixture({verifyRuntime:async()=>{throw Error('REEL_NODE_REQUIRED: missing Node');}});
 await assert.rejects(()=>rejected.gateway.workspace(),/REEL_NODE_REQUIRED/);assert.equal(rejected.launches.length,0);await rejected.gateway.dispose();
});
test('bounded speech WAV chunks are accepted without opening other audio media routes',async()=>{
 const speechId='speech-'+'a'.repeat(32),digest='b'.repeat(64),uri=`reel-media-chunk://studio/${speechId}/${digest}/0`,blob=Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE').toString('base64');
 const f=transportFixture({client:{readResource:async({uri})=>({contents:[{uri,mimeType:'audio/wav',blob}]})}});
 assert.deepEqual(await f.gateway.media(uri),{contents:[{uri,mimeType:'audio/wav',blob}]});
 await assert.rejects(()=>f.gateway.media(`reel-media-chunk://studio/kinetic.mp4/${digest}/0`),/MEDIA_CHUNK_INVALID/);
 await f.gateway.dispose();
 for(const item of [{mimeType:'audio/mpeg',blob},{mimeType:'audio/wav',blob:'A'.repeat(16385)},{mimeType:'audio/wav',blob,uri:uri.replace(digest,'c'.repeat(64))}]){
  const rejected=transportFixture({client:{readResource:async()=>({contents:[{uri,...item}]})}});
  await assert.rejects(()=>rejected.gateway.media(uri),/MEDIA_(?:CHUNK_INVALID|INVALID_RESPONSE)/);await rejected.gateway.dispose();
 }
});
test('speech media rejects unsupported paths and malformed digests before any transport starts',async()=>{
 const f=transportFixture(),speechId='speech-'+'a'.repeat(32),digest='b'.repeat(64);
 for(const uri of [
  `file:///speech-${'a'.repeat(32)}.wav`,
  `reel-media-chunk://studio/../${speechId}/${digest}/0`,
  `reel-media-chunk://studio/${speechId}.wav/${digest}/0`,
  `reel-media-chunk://studio/${speechId}/${'b'.repeat(63)}/0`,
  `reel-media-chunk://studio/${speechId}/${'g'.repeat(64)}/0`,
  `reel-media-chunk://studio/${speechId}/${digest}/../0`,
 ])await assert.rejects(()=>f.gateway.media(uri),/MEDIA_RESOURCE_NOT_ALLOWED/);
 assert.equal(f.launches.length,0);await f.gateway.dispose();
});
