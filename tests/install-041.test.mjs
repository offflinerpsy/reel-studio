import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {version} from '../scripts/common.mjs';

test('packaged smoke isolates owner configuration and checks an empty paused library',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reel-install-smoke-'));
 try{
  await mkdir(join(root,'scripts'),{recursive:true});
  for(const name of ['common.mjs','smoke-package.mjs'])await copyFile(new URL('../scripts/'+name,import.meta.url),join(root,'scripts',name));
  const packaged=join(root,'package');
  for(const name of ['remote-config','owner-authority','codex-runtime','compute-router','mac-ui-relay']){
   const path=join(packaged,'studio/server',name+'.mjs');await mkdir(dirname(path),{recursive:true});await writeFile(path,'export {};\n');
  }
  await mkdir(join(root,'packages/bb/node_modules'),{recursive:true});
  await mkdir(join(packaged,'bb/src'),{recursive:true});
  await writeFile(join(packaged,'bb/package.json'),'{"type":"module"}\n');
  await writeFile(join(packaged,'bb/src/reel-gateway.mjs'),`
   import assert from 'node:assert/strict';
   export function createReelGateway({env}){
    assert.equal(env.REEL_NODE_BIN,process.execPath);
    assert.equal(env.REEL_STUDIO_PAUSED,'1');
    assert.notEqual(env.HOME,process.env.HOME);
    for(const name of ['REEL_REMOTE_CONFIG','REEL_MAC_ENDPOINT','REEL_TELEGRAM_BOT_TOKEN','CODEX_BIN','CLAUDE_BIN','NODE_OPTIONS'])assert.equal(env[name],undefined,name);
    return {workspace:async()=>({version:${JSON.stringify(version)},backendVersion:${JSON.stringify(version)},html:'<html>'}),
     call:async input=>{assert.equal(input.name,'reel_state');return {structuredContent:{snapshot:{paused:process.env.SMOKE_UNPAUSED!=='1',projects:[]}}};},dispose:async()=>{}};
   }
  `);
  const env={...process.env,REEL_REMOTE_CONFIG:'private-config',REEL_MAC_ENDPOINT:'private-endpoint',REEL_TELEGRAM_BOT_TOKEN:'private-token',CODEX_BIN:'private-codex',CLAUDE_BIN:'private-claude',NODE_OPTIONS:'--no-warnings'};
  const run=extra=>spawnSync(process.execPath,[join(root,'scripts/smoke-package.mjs'),packaged],{cwd:root,env:{...env,...extra},encoding:'utf8'});
  const safe=run({});assert.equal(safe.status,0,safe.stderr);assert.match(safe.stdout,/empty paused workspace/);
  const unsafe=run({SMOKE_UNPAUSED:'1'});assert.notEqual(unsafe.status,0);assert.match(unsafe.stderr,/empty paused library/);
 }finally{await rm(root,{recursive:true,force:true});}
});
