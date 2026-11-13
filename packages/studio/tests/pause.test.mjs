import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStudio} from '../server/index.mjs';
test('owner pause blocks every write before mutation while remote review stays available',async t=>{
 const home=mkdtempSync(join(tmpdir(),'reel-pause-'));const app=await createStudio({home,paused:true,runtimeLabel:'remote_linux',runtime:{close:async()=>{}}});
 t.after(async()=>{await app.close();rmSync(home,{recursive:true,force:true})});
 const before=app.store.read();
 for(const name of ['reel_create','reel_generate','reel_metadata','reel_publish','reel_targets']){
  const result=await app.invoke(name,{});assert.equal(result.isError,true);assert.match(result.structuredContent.error,/Production is paused/);
 }
 const draft=await app.invoke('reel_create',{requestKey:randomUUID(),title:'Migration test',idea:'A valid creation request must stay paused',templateId:'kinetic',model:'gpt-5.6-luna',effort:'medium',duration:15,language:'en'});assert.equal(draft.isError,true);assert.match(draft.structuredContent.error,/Production is paused/);
 assert.deepEqual(app.store.read(),before);const review=await app.invoke('reel_state');assert.notEqual(review.isError,true);assert.equal(review.structuredContent.snapshot.paused,true);assert.equal(review.structuredContent.snapshot.runtime,'remote_linux');
});
test('a remote MCP view forwards commands without starting or recovering a second production runtime',async t=>{
 const home=mkdtempSync(join(tmpdir(),'reel-forward-'));const calls=[];let catalogCalls=0;
 const setup=await createStudio({home,runtime:{close:async()=>{}}});const before=setup.store.read();await setup.close();
 const app=await createStudio({home,rpcForwarder:async(name,args)=>{calls.push({name,args});return {structuredContent:{snapshot:{runtime:'remote_linux',paused:true}}}},runtime:{catalog:async()=>{catalogCalls++},close:async()=>{}}});
 t.after(async()=>{await app.close();rmSync(home,{recursive:true,force:true})});
 assert.deepEqual(app.store.read(),before);const r=await app.invoke('reel_models',{});assert.equal(r.structuredContent.snapshot.runtime,'remote_linux');assert.deepEqual(calls,[{name:'reel_models',args:{}}]);assert.equal(catalogCalls,0);assert.deepEqual(app.store.read(),before);
});
