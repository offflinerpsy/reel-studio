import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadRemoteConfig,validateRemoteConfig,defaultLocalHome,defaultLocalPlugin} from '../server/remote-config.mjs';

const valid={sshHost:'worker@studio.example',remoteHome:'/srv/studio/data',remotePlugin:'/srv/studio/plugin',remoteNode:'/usr/local/bin/node',localHome:'/tmp/studio-worker',localPlugin:'/tmp/studio-plugin'};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'reel-remote-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('only an explicit absolute JSON file enables validated remote settings',t=>{
 const dir=fixture(t),file=join(dir,'remote.json');writeFileSync(file,JSON.stringify(valid));
 assert.deepEqual(loadRemoteConfig(file),valid);
 assert.throws(()=>loadRemoteConfig('relative.json'),/absolute/);
 assert.throws(()=>loadRemoteConfig(join(dir,'missing.json')),/could not be read/);
 writeFileSync(file,'{');assert.throws(()=>loadRemoteConfig(file),/could not be read/);
 const defaults=validateRemoteConfig({sshHost:'alias',remoteHome:'/srv/data',remotePlugin:'/srv/plugin',remoteNode:'/usr/bin/node'});
 assert.equal(defaults.localHome,defaultLocalHome());assert.equal(defaults.localPlugin,defaultLocalPlugin());
});

test('SSH flags, shell metacharacters, traversal, and unsafe paths are rejected',()=>{
 for(const sshHost of ['-oProxyCommand=evil','good;touch /tmp/pwn','good host','user@-host','host\ncommand','$(id)','host..example'])assert.throws(()=>validateRemoteConfig({...valid,sshHost}),/sshHost/,sshHost);
 for(const field of ['remoteHome','remotePlugin','remoteNode'])for(const value of ['/','relative','/srv/../etc','/srv//data','/srv/data/','/srv/data;id','/srv/$(id)','/srv/a b','/srv/\nfoo'])assert.throws(()=>validateRemoteConfig({...valid,[field]:value}),new RegExp(field),`${field}: ${value}`);
 for(const field of ['localHome','localPlugin','codexBinary'])for(const value of ['relative','/','/tmp/../other','/tmp/trailing/','/tmp/\0bad'])assert.throws(()=>validateRemoteConfig({...valid,[field]:value}),new RegExp(field));
 assert.throws(()=>validateRemoteConfig({...valid,unknown:'x'}),/unknown/);
});

test('relay fails closed without explicit config and passes validated arguments to ssh',t=>{
 const dir=fixture(t),capture=join(dir,'args.txt'),bin=join(dir,'ssh'),config=join(dir,'remote.json');
 writeFileSync(bin,'#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n',{mode:0o755});
 writeFileSync(config,JSON.stringify(valid));
 const relay=resolve('server/mac-ui-relay.mjs');
 const env={...process.env,PATH:dir,CAPTURE:capture};delete env.REEL_REMOTE_CONFIG;
 const absent=spawnSync(process.execPath,[relay],{cwd:resolve('.'),env,input:'',encoding:'utf8'});
 assert.notEqual(absent.status,0);assert.equal(existsSync(capture),false);
 const accepted=spawnSync(process.execPath,[relay],{cwd:resolve('.'),env:{...env,REEL_REMOTE_CONFIG:config},input:'',encoding:'utf8'});
 assert.equal(accepted.status,0,accepted.stderr);
 const args=readFileSync(capture,'utf8').trim().split('\n');assert.deepEqual(args.slice(-5),[valid.sshHost,'env',`REEL_STUDIO_HOME=${valid.remoteHome}`,valid.remoteNode,valid.remotePlugin+'/server/stdio-compress.mjs']);
 writeFileSync(config,JSON.stringify({...valid,remoteNode:'/usr/bin/node;touch /tmp/forbidden'}));rmSync(capture);
 const rejected=spawnSync(process.execPath,[relay],{cwd:resolve('.'),env:{...env,REEL_REMOTE_CONFIG:config},input:'',encoding:'utf8'});
 assert.notEqual(rejected.status,0);assert.equal(existsSync(capture),false);
});
