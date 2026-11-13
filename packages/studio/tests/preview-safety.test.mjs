import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../server/index.mjs';

test('preview denies effectful commands before local or forwarded execution',async t=>{
 const blocked=['reel_generate','reel_metadata','reel_speech_sample','reel_publish','reel_browser_prepare','reel_dispatch_record','reel_account_verify_prepare','reel_release_plan_dispatch_prepare','reel_release_plan_dispatch_record','reel_external_job_begin','reel_line_claim'];
 for(const forwarded of [false,true]){
  const home=mkdtempSync(join(tmpdir(),'reel-preview-safety-'));let starts=0,remoteCalls=0;
  const runtime={start:async()=>{starts++;throw new Error('unexpected runtime start');},close:async()=>{}};
  const app=await createStudio({home,preview:true,runtime,...(forwarded?{rpcForwarder:async()=>{remoteCalls++;throw new Error('unexpected remote call');}}:{})});
  t.after(async()=>{await app.close();rmSync(home,{recursive:true,force:true});});
  const before=app.store.read();
  for(const name of blocked){const result=await app.invoke(name,{});assert.equal(result.isError,true,name);assert.match(result.structuredContent.error,/Preview mode/);}
  assert.equal(starts,0);assert.equal(remoteCalls,0);assert.deepEqual(app.store.read(),before);
 }
});
