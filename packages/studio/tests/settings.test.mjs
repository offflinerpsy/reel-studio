import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installationSettings,settingsSchema} from '../server/settings.mjs';
import {createStudio} from '../server/index.mjs';

function fixture(t){const home=mkdtempSync(join(tmpdir(),'reel-settings-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return home;}
const local=home=>({mode:'local',localHome:home,localPlugin:'/opt/reel-studio',telegramChatId:'@example_channel'});
const remote={sshHost:'worker@studio.example',remoteHome:'/srv/studio/data',remotePlugin:'/srv/studio/plugin',remoteNode:'/usr/bin/node'};

test('private settings validate SSH boundaries and reject credential fields before persistence',t=>{
 const home=fixture(t),s=installationSettings({home,pluginRoot:'/opt/plugin',runtimeLabel:'local',env:{REEL_TELEGRAM_BOT_TOKEN:'never-return-this-token',REEL_TELEGRAM_CHAT_ID:'@active_channel'}});
 assert.equal(s.read().saved,false);const saved=s.save({...local(home),mode:'ssh',remote});assert.equal(saved.saved,true);assert.equal(saved.active.telegram.credentialsPresent,true);
 assert.equal(JSON.stringify(saved).includes('never-return-this-token'),false);assert.equal(statSync(join(home,'installation-settings.json')).mode&0o777,0o600);
 const before=readFileSync(join(home,'installation-settings.json'),'utf8');
 for(const config of [{...local(home),token:'secret'},{...local(home),telegramChatId:'123:raw-bot-token'},{...local(home),localHome:'relative'},{...local(home),mode:'ssh',remote:{...remote,sshHost:'host;id'}},{...local(home),mode:'ssh',remote:{...remote,remoteNode:'/usr/bin/node;id'}},{...local(home),remote:{...remote,accessToken:'secret'}}])assert.throws(()=>s.save(config));
 assert.equal(readFileSync(join(home,'installation-settings.json'),'utf8'),before);
 assert.equal(settingsSchema.safeParse({...local(home),mode:'ssh'}).success,false);
 const restored=installationSettings({home,pluginRoot:'/other',runtimeLabel:'remote'}).read();assert.deepEqual(restored.config,saved.config);
});

test('setup exports safe existing launch routes without applying them or writing credentials',t=>{
 const home=fixture(t),s=installationSettings({home,pluginRoot:'/opt/plugin',runtimeLabel:'local',env:{REEL_TELEGRAM_BOT_TOKEN:'private-secret'}});
 s.save({...local(home),localPlugin:"/opt/owner's studio"});const localSetup=s.setup();assert.match(localSetup.command,/env -u REEL_REMOTE_CONFIG REEL_STUDIO_HOME=/);assert.match(localSetup.command,/'\\''/);assert.equal(localSetup.applied,false);assert.equal(localSetup.requiresReconnect,true);
 s.save({...local(home),mode:'ssh',remote});const setup=s.setup(),config=JSON.parse(readFileSync(setup.remoteConfigPath,'utf8'));assert.equal(config.sshHost,remote.sshHost);assert.match(setup.command,/REEL_REMOTE_CONFIG=/);assert.match(setup.command,/scripts\/run-server.sh/);assert.equal(statSync(setup.remoteConfigPath).mode&0o777,0o600);assert.equal(statSync(join(home,'installation-setup')).mode&0o777,0o700);assert.equal(JSON.stringify(setup).includes('private-secret'),false);
 assert.equal(s.read().active.home,home);assert.equal(s.read().active.runtime,'local');
 const target=join(home,'other.json');writeFileSync(target,'untouched');rmSync(join(home,'installation-settings.json'));symlinkSync(target,join(home,'installation-settings.json'));assert.throws(()=>s.save(local(home)),/symbolic link/);assert.equal(readFileSync(target,'utf8'),'untouched');
});

test('settings operations remain separate from snapshots and do not unpause or mutate the library',async t=>{
 const home=fixture(t),app=await createStudio({home,paused:true,runtime:{close:async()=>{}}});t.after(()=>app.close());const before=app.store.read();
 const save=await app.invoke('reel_settings_save',{config:local(home)});assert.notEqual(save.isError,true);assert.equal(save.structuredContent.snapshot,undefined);assert.equal(save.structuredContent.settings.active.home,home);
 const setup=await app.invoke('reel_settings_export');assert.equal(setup.structuredContent.setup.applied,false);assert.equal(setup.structuredContent.snapshot,undefined);
 const read=await app.invoke('reel_settings_read');assert.deepEqual(read.structuredContent.settings.config,{...local(home),engine:'codex'});assert.equal(app.snapshot().settings,undefined);assert.equal(app.snapshot().paused,true);assert.deepEqual(app.store.read(),before);
 const bad=await app.invoke('reel_settings_save',{config:{...local(home),token:'super-secret'}});assert.equal(bad.isError,true);assert.equal(JSON.stringify(bad).includes('super-secret'),false);
});

test('engine selection persists across restart and unrelated installation saves',t=>{
 const home=fixture(t),s=installationSettings({home,pluginRoot:'/opt/plugin',runtimeLabel:'local'});
 assert.equal(s.read().config.engine,'codex');
 s.save({...local(home),mode:'ssh',remote});s.setEngine('claude');
 const restored=installationSettings({home,pluginRoot:'/other',runtimeLabel:'remote'});
 assert.equal(restored.read().config.engine,'claude');assert.deepEqual(restored.read().config.remote,remote);
 restored.save({...local(home),mode:'ssh',remote});assert.equal(restored.read().config.engine,'claude');
 assert.throws(()=>restored.setEngine('other'));assert.equal(restored.read().config.engine,'claude');
});

test('speech media uses only the owning Studio home, including the environment override',async t=>{
 const homeA=fixture(t),homeB=fixture(t),requestId='a'.repeat(32);for(const [home,audio]of [[homeA,'audio-A'],[homeB,'audio-B']]){mkdirSync(join(home,'speech-audio'));writeFileSync(join(home,'speech-audio',requestId+'.wav'),audio);}
 const a=await createStudio({home:homeA,runtime:{close:async()=>{}}});t.after(()=>a.close());const old=process.env.REEL_STUDIO_HOME;process.env.REEL_STUDIO_HOME=homeB;let b;try{b=await createStudio({runtime:{close:async()=>{}}});}finally{if(old===undefined)delete process.env.REEL_STUDIO_HOME;else process.env.REEL_STUDIO_HOME=old;}t.after(()=>b.close());
 for(const [app,audio]of [[a,'audio-A'],[b,'audio-B']]){const url=new URL(app.previewURL);url.pathname='/media/speech-'+requestId;assert.equal(await (await fetch(url)).text(),audio);}
 rmSync(join(homeA,'speech-audio',requestId+'.wav'));const url=new URL(a.previewURL);url.pathname='/media/speech-'+requestId;assert.equal((await fetch(url)).status,404);
});
