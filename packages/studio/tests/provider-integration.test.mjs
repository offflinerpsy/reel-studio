import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStudio} from '../server/index.mjs';
import {createConnectionSettings} from '../server/connection-settings.mjs';
import {createNarrationService} from '../server/narration.mjs';

const wav=()=>{const b=Buffer.alloc(48044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(48000,40);return b;};
const voices={configured:true,provider:'Microsoft Azure Speech',voices:[{id:'en-US-GuyNeural',name:'Guy',locale:'en-US',gender:'Male',type:'Neural',styles:['friendly']}]};
function fakeRuntime(engine){return {engine,starts:[],reconciles:[],closes:0,catalogs:0,async catalog(){this.catalogs++;return {models:[{id:engine==='codex'?'gpt-6.1-sol':'sonnet',displayName:engine}],account:{type:engine==='codex'?'chatgpt':'claude-subscription',loggedIn:true},availability:{authenticated:true}};},async start(options){this.starts.push(options);const threadId=randomUUID(),turnId=randomUUID();await options.onEvent?.({method:'reel/thread-ready',params:{threadId,cwd:options.cwd,nativeSessionId:threadId,nativeModel:engine==='claude'?'claude-sonnet-native':'gpt-6.1-sol',modelProvider:engine==='claude'?'anthropic':'openai',permissions:{approvalPolicy:'never',sandbox:{type:'dangerFullAccess'}}}});return {threadId,turnId,nativeSessionId:threadId,nativeModel:engine==='claude'?'claude-sonnet-native':'gpt-6.1-sol'};},async reconcile(threadId){this.reconciles.push(threadId);return {latestTurn:{status:'running'}};},async cancel(){},async close(){this.closes++;}};}
async function fixture(t,options={}){const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-integration-')),codex=fakeRuntime('codex'),claude=fakeRuntime('claude');t.after(()=>rmSync(home,{recursive:true,force:true}));const app=await createStudio({home,env:{},runtime:codex,claudeRuntime:claude,fetchImpl:async()=>{throw new Error('Unexpected provider request');},...options});t.after(()=>app.close());return {home,app,codex,claude};}
async function call(app,name,args={}){const result=await app.invoke(name,args);assert.notEqual(result.isError,true,result.structuredContent?.error);return result.structuredContent;}
const create=app=>call(app,'reel_create',{requestKey:randomUUID(),title:'A film',idea:'Explain one concrete idea.',templateId:'kinetic',model:'gpt-6.1-sol',effort:'high',duration:15,language:'en'});
async function save(app,service,fields){const {setup}=await call(app,'reel_setup_read'),url=setup.services.find(s=>s.id===service).setupURL;const response=await fetch(url,{method:'POST',headers:{Origin:new URL(url).origin},body:new URLSearchParams({operation:'save',...fields})});assert.equal(response.status,200);return response.text();}
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('readiness keeps never-connected optional services unconfigured without provider requests',async t=>{
 const {app}=await fixture(t,{renderCheck:async()=>true});
 const {setup}=await call(app,'reel_setup_check',{service:'all'});
 assert.equal(setup.render.status,'ready');
 for(const service of setup.services){assert.equal(service.configured,false);assert.equal(service.status,'not_configured');assert.match(service.detail,/Connect your own/);}
});

test('createStudio provides live protected setup URLs, persists engine, and does not check providers on read',async t=>{
 const f=await fixture(t),{setup}=await call(f.app,'reel_setup_read');assert.equal(setup.engine,'codex');assert.equal(f.codex.catalogs+f.claude.catalogs,0);assert.ok(setup.engines.every(e=>e.setupURL.startsWith(f.app.address+'/setup/runtime?key=')));
 const url=setup.services.find(s=>s.id==='azure').setupURL;assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url.split('?')[0])).status,403);
 const secret='private-owner-key';assert.equal((await save(f.app,'azure',{key:secret,region:'eastus'})).includes(secret),false);
 assert.equal(JSON.stringify(await call(f.app,'reel_setup_read')).includes(secret),false);assert.equal(JSON.stringify(f.app.snapshot()).includes(f.home),false);
 const invalid=await f.app.invoke('reel_setup_check',{service:'azure',key:secret});assert.equal(invalid.isError,true);assert.equal(JSON.stringify(invalid).includes(secret),false);
 const oldModels=await call(f.app,'reel_models');assert.equal(oldModels.catalog.models[0].id,'gpt-6.1-sol');
 const switched=await call(f.app,'reel_setup_engine',{engine:'claude'});assert.equal(switched.snapshot.engine,'claude');assert.equal(switched.snapshot.catalog.engine,'claude');assert.deepEqual(switched.snapshot.catalog.models,[]);assert.equal(f.claude.catalogs,0);assert.equal((await call(f.app,'reel_settings_read')).settings.config.engine,'claude');
 const check=await call(f.app,'reel_setup_check',{service:'runtime'});assert.equal(check.setup.engines.find(e=>e.id==='claude').status,'ready');assert.equal(f.claude.catalogs,1);assert.equal(f.codex.catalogs,1);
 const second=await createStudio({home:f.home,env:{},runtime:fakeRuntime('codex'),claudeRuntime:fakeRuntime('claude')});t.after(()=>second.close());assert.equal((await call(second,'reel_setup_read')).setup.engine,'claude');
});

test('new jobs use chosen engine while original native provenance and reconciliation keep their engine',async t=>{
 const f=await fixture(t),{project:p}=await create(f.app);const first=await call(f.app,'reel_generate',{projectId:p.id,requestKey:randomUUID()});assert.equal(first.job.engine,'codex');assert.equal(f.codex.starts.length,1);assert.equal(first.job.dir,undefined);assert.equal(first.job.nativeCwd,undefined);
 await call(f.app,'reel_setup_engine',{engine:'claude'});await call(f.app,'reel_reconcile',{projectId:p.id,jobId:first.job.id});assert.equal(f.codex.reconciles.length,1);assert.equal(f.claude.reconciles.length,0);
 await f.codex.starts[0].onEvent({method:'turn/completed',params:{threadId:first.job.threadId,turn:{id:first.job.turnId,status:'interrupted'}}});
 const {project:q}=await create(f.app),second=await call(f.app,'reel_generate',{projectId:q.id,requestKey:randomUUID()});assert.equal(second.job.engine,'claude');assert.equal(second.job.nativeModel,'claude-sonnet-native');assert.equal(second.job.nativeSessionId,second.job.threadId);assert.equal(f.claude.starts.length,1);assert.match(f.claude.starts[0].prompt,/official Claude Code subscription/);assert.equal(f.claude.starts[0].prompt.includes('existing ChatGPT subscription'),false);
 await call(f.app,'reel_setup_engine',{engine:'codex'});await call(f.app,'reel_reconcile',{projectId:q.id,jobId:second.job.id});assert.equal(f.claude.reconciles.length,1);
 await f.claude.starts[0].onEvent({method:'turn/completed',params:{threadId:second.job.threadId,nativeSessionId:second.job.threadId,nativeTurnId:'native-result-id',nativeModel:'claude-sonnet-native',turn:{id:second.job.turnId,status:'interrupted'}}});assert.equal(f.app.store.get(q.id).jobs[0].nativeTurnId,'native-result-id');
});

test('saved Azure credentials reach catalog/sample and narration maps safely, attaches, freezes and survives restart',async t=>{
 const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-narration-integration-'));t.after(()=>rmSync(home,{recursive:true,force:true}));let syntheses=0,samples=0;const credentials=createConnectionSettings({home,env:{}});credentials.save('azure',{key:'private-own-speech-key',region:'eastus'});
 const service=createNarrationService(home,{getCredentials:s=>credentials.credentials(s),listVoices:async()=>voices,synthesize:async request=>{syntheses++;assert.equal(request.text,'The full private narration sentence.');assert.equal(request.credentials.key,'private-own-speech-key');return {audio:wav(),provider:'Microsoft Azure Speech',model:'azure-speech-neural-tts',wordTimings:[{text:'private',offset:0,duration:200}]};}});
 const codex=fakeRuntime('codex'),app=await createStudio({home,env:{},runtime:codex,claudeRuntime:fakeRuntime('claude'),narrationService:service,listVoices:async options=>{assert.equal(options.credentials.key,'private-own-speech-key');return voices;},synthesizeSample:async options=>{samples++;assert.equal(options.credentials.key,'private-own-speech-key');return {requestId:'a'.repeat(32),duration:1};}});t.after(()=>app.close());
 await call(app,'reel_speech_catalog');assert.equal(samples,0);await call(app,'reel_speech_sample',{voice:'en-US-GuyNeural',locale:'en-US',text:'Explicit sample.'});assert.equal(samples,1);
 const requestKey=randomUUID(),created=await call(app,'reel_narration_create',{requestKey,text:'The full private narration sentence.',voice:'en-US-GuyNeural',locale:'en-US'});assert.equal(created.narration.status,'completed');assert.equal(created.narration.requestKey,requestKey);assert.equal(syntheses,1);assert.ok(created.narration.mediaURL.startsWith(app.address+'/media/speech-'));
 for(const forbidden of [home,'private-own-speech-key','The full private narration sentence.','timingsPath','audioPath'])assert.equal(JSON.stringify(created).includes(forbidden),false);
 assert.equal((await (await fetch(created.narration.mediaURL)).arrayBuffer()).byteLength,wav().length);
 assert.equal((await call(app,'reel_narration_read',{requestKey})).narration.status,'completed');assert.equal((await call(app,'reel_narration_list')).narrations[0].requestKey,requestKey);assert.equal(syntheses,1);
 const {project:p}=await create(app),assigned=await call(app,'reel_narration_assign',{projectId:p.id,requestKey,expectedRevision:p.revision});assert.ok(assigned.project.narration.mediaURL);assert.equal(JSON.stringify(assigned).includes(home),false);
 const generated=await call(app,'reel_generate',{projectId:p.id,requestKey:randomUUID()});assert.equal(generated.job.narration.requestKey,requestKey);assert.equal(JSON.stringify(generated).includes(home),false);assert.equal(syntheses,1);assert.match(codex.starts[0].prompt,/Do not synthesize replacement speech/);assert.ok(codex.starts[0].prompt.includes(join(home,'speech-audio')));
 const second=await createStudio({home,env:{},runtime:fakeRuntime('codex'),claudeRuntime:fakeRuntime('claude')});t.after(()=>second.close());assert.equal((await call(second,'reel_setup_read')).setup.narration.requestKey,requestKey);assert.equal((await call(second,'reel_narration_list')).narrations[0].status,'completed');
});

test('saved direct DataForSEO access works with Claude selected without a hidden Codex call or paid POST',async t=>{
 const requests=[],f=await fixture(t,{fetchImpl:async(url,init)=>{requests.push({url,init});assert.equal(init.method,'GET');return json({status_code:20000,tasks:[{id:'safe-task-id',status_code:20000,cost:0,result:[]}]});}});
 await save(f.app,'dataforseo',{login:'owner@example.test',password:'private-dfs-password'});await call(f.app,'reel_setup_engine',{engine:'claude'});const {project}=await create(f.app);const result=await call(f.app,'reel_research_check',{projectId:project.id});assert.equal(result.access.route,'direct');assert.equal(result.access.status,'verified');assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.dataforseo.com/v3/appendix/user_data');assert.match(requests[0].init.headers.Authorization,/^Basic /);assert.equal(f.codex.starts.length+f.claude.starts.length,0);assert.equal(JSON.stringify(result).includes('private-dfs-password'),false);
});

test('Telegram uses saved own credential and canonical verified destination behind exact approval/no-replay fence',async t=>{
 const methods=[],f=await fixture(t,{fetchImpl:async(url,init)=>{const method=new URL(url).pathname.split('/').pop();methods.push(method);assert.ok(url.includes('123456:private-telegram-key'));return json({ok:true,result:method==='getMe'?{id:123456,is_bot:true}:method==='getChat'?{id:-100123,type:'channel',username:'owner_channel'}:method==='getChatMember'?{status:'administrator',can_post_messages:true}:{message_id:17,chat:{id:-100123},video:{file_id:'file-id'}}});}});
 await save(f.app,'telegram',{token:'123456:private-telegram-key',chatId:'@owner_channel'});const {project:p}=await create(f.app),job=f.app.store.begin(p.id,{requestKey:randomUUID()}),file=join(job.dir,'fixture.mp4');writeFileSync(file,'synthetic positive-size fixture');const v=f.app.store.addVersion(p.id,job.id,{path:file,media:{duration:1},metadata:{title:'A fact',caption:'An explanation.',hashtags:[],evidence:[]}});
 let r=await f.app.invoke('reel_publish',{projectId:p.id,versionId:v.id,channel:'telegram',target:'@owner_channel'});assert.equal(r.isError,true);assert.equal(methods.includes('sendVideo'),false);
 f.app.store.approve(p.id,v.id,v.sha256,f.app.store.get(p.id).revision);r=await call(f.app,'reel_publish',{projectId:p.id,versionId:v.id,channel:'telegram',target:'@owner_channel'});assert.equal(r.attempt.effect,'delivered_unverified');assert.equal(r.attempt.chatId,'-100123');assert.equal(methods.filter(m=>m==='sendVideo').length,1);assert.equal(JSON.stringify(r).includes('private-telegram-key'),false);
 await call(f.app,'reel_publish',{projectId:p.id,versionId:v.id,channel:'telegram',target:'@owner_channel'});assert.equal(methods.filter(m=>m==='sendVideo').length,1);
});

test('preview blocks explicit paid narration creation while read/setup remain usable',async t=>{
 let generated=0;const f=await fixture(t,{preview:true,narrationService:{latest:async()=>null,list:async()=>[],generate:async()=>{generated++;}}});await call(f.app,'reel_setup_read');const r=await f.app.invoke('reel_narration_create',{requestKey:randomUUID(),text:'Entire script.',voice:'en-US-GuyNeural',locale:'en-US'});assert.equal(r.isError,true);assert.equal(generated,0);
});
test('missing historical narration audio or unreadable receipt does not disable protected Settings',async t=>{
 const f=await fixture(t),id='a'.repeat(32);mkdirSync(join(f.home,'narration'));writeFileSync(join(f.home,'narration',id+'.json'),JSON.stringify({id,requestKey:'historical_request',status:'complete',effect:'independently_verified',duration:1,bytes:48044,sha256:'b'.repeat(64)}));
 let result=await call(f.app,'reel_setup_read');assert.equal(result.setup.narration.status,'artifact_unverified');assert.equal(result.setup.narration.requestKey,'historical_request');assert.equal(result.setup.narration.mediaURL,undefined);assert.equal(result.setup.services.length,4);
 writeFileSync(join(f.home,'narration',id+'.json'),'{invalid receipt');result=await call(f.app,'reel_setup_read');assert.equal(result.setup.narration.status,'artifact_unverified');assert.equal(result.setup.narration.requestKey,'historical_request');assert.equal(JSON.stringify(result).includes(f.home),false);assert.equal((await fetch(result.setup.services[0].setupURL)).status,200);
});
test('a pending old-engine model read cannot replace the newly selected empty catalog',async t=>{
 const f=await fixture(t);let release,entered;const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 f.codex.catalog=async()=>{entered();return pending;};
 const oldRead=f.app.invoke('reel_models');await started;
 const changed=await call(f.app,'reel_setup_engine',{engine:'claude'});assert.equal(changed.snapshot.catalog.engine,'claude');assert.deepEqual(changed.snapshot.catalog.models,[]);
 release({models:[{id:'old-codex-model'}],account:{type:'chatgpt'}});
 const rejected=await oldRead;assert.equal(rejected.isError,true);assert.match(rejected.structuredContent.error,/engine changed/i);assert.equal(rejected.structuredContent.snapshot,undefined);
 assert.equal(f.app.snapshot().catalog.engine,'claude');assert.deepEqual(f.app.snapshot().catalog.models,[]);assert.equal(f.claude.catalogs,0);
});
