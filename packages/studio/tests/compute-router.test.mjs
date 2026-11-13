import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComputeRouter,RemoteMacRuntime} from '../server/compute-router.mjs';
import {createStudio} from '../server/index.mjs';
function fixture(t){const home=mkdtempSync(join(tmpdir(),'reel-compute-')),calls=[],active={value:false};const route=id=>({catalog:async()=>({models:[],account:{type:'chatgpt',planType:'pro'},host:id}),health:async()=>({platform:id==='macbook'?'darwin':'linux'}),start:async a=>{calls.push([id,'start',a]);return {threadId:id}},cancel:async(...a)=>calls.push([id,'cancel',...a]),reconcile:async(...a)=>{calls.push([id,'reconcile',...a]);return {host:id}},close:async()=>{}});const routes={linux:route('linux'),macbook:route('macbook')};const router=new ComputeRouter({home,...routes,hasActiveJobs:()=>active.value});t.after(()=>rmSync(home,{recursive:true,force:true}));return {home,router,routes,calls,active};}
test('compute choice persists, pins existing jobs, rejects stale changes and never silently falls back',async t=>{
 const f=fixture(t);await f.router.select('macbook',1);assert.equal(f.router.selectedTarget(),'macbook');
 assert.equal(new ComputeRouter({home:f.home,...f.routes}).selectedTarget(),'macbook');
 await f.router.start({computeTarget:'linux',cwd:'/original'});await f.router.cancel('t','u','linux');await f.router.reconcile('t','linux');assert.deepEqual(f.calls.map(c=>c.slice(0,2)),[['linux','start'],['linux','cancel'],['linux','reconcile']]);
 await assert.rejects(f.router.select('linux',1),/changed/);f.active.value=true;await f.router.select('linux',2);assert.equal(f.router.selectedTarget(),'linux');f.active.value=false;
 f.routes.macbook.start=async()=>{throw new Error('offline')};await assert.rejects(f.router.start({computeTarget:'macbook'}),/offline/);assert.equal(f.calls.length,3);
});
test('new-work selection preserves the old runtime when a job is running or starts during checking',async t=>{
 const f=fixture(t);let closed=0;f.routes.linux.close=async()=>{closed++};f.routes.linux.fresh=()=>{throw new Error('Must retain original thread subscription')};
 f.routes.macbook.health=async()=>{f.active.value=true};await f.router.select('macbook',1);
 assert.equal(f.router.selectedTarget(),'macbook');assert.equal(f.router.routes.linux,f.routes.linux);assert.equal(closed,0);assert.equal(f.router.computeState().sessionAndProduction,true);
 await f.router.reconcile('original-linux-chat','linux');assert.deepEqual(f.calls.at(-1),['linux','reconcile','original-linux-chat']);
});
test('owner pause permits the location setting without creating projects or unpausing production',async t=>{
 const f=fixture(t),app=await createStudio({home:f.home,paused:true,runtime:f.router});t.after(()=>app.close());const before=app.store.read();
 const result=await app.invoke('reel_compute_select',{target:'macbook',expectedRevision:1});assert.notEqual(result.isError,true);assert.equal(result.structuredContent.snapshot.compute.target,'macbook');assert.equal(result.structuredContent.snapshot.paused,true);assert.deepEqual(app.store.read(),before);
 assert.equal((await app.invoke('reel_generate',{})).isError,true);assert.equal(f.calls.length,0);
});
test('Mac adapter maps only its compute paths and checks native workspace before a model turn',async()=>{
 const remoteHome='/remote/studio',r=new RemoteMacRuntime({endpoint:'/not-used',proxy:'/not-used',remoteHome,remotePlugin:'/remote/plugin',localHome:'/mac/worker',localPlugin:'/mac/plugin',request:async(_file,method)=>method==='health'?{platform:'darwin'}:{cwd:'/wrong'}});
 assert.equal(r.map('/remote/studio/jobs/a read /remote/plugin/skills; /unrelated/file'),'/mac/worker/jobs/a read /mac/plugin/skills; /unrelated/file');await assert.rejects(r.start({cwd:remoteHome+'/jobs/a',prompt:'test'}),/workspace readback/);assert.equal(r.child,undefined);await r.close();
});

test('saved drafts and both native job sessions stay on their hosts when the new-work selector changes',async t=>{
 const f=fixture(t),app=await createStudio({home:f.home,runtime:f.router});t.after(()=>app.close());
 const input=title=>({requestKey:crypto.randomUUID(),title,idea:'A separate original direction',templateId:'kinetic',model:'gpt-6.1-sol',effort:'ultra',duration:30,language:'en'});
 const create=async title=>{const r=await app.invoke('reel_create',input(title));assert.notEqual(r.isError,true);return r.structuredContent.project;};
 const linux=await create('Linux draft');assert.equal(linux.computeTarget,'linux');
 await f.router.select('macbook',1);const mac=await create('Mac experiment');assert.equal(mac.computeTarget,'macbook');
 const run=async p=>app.invoke('reel_generate',{projectId:p.id,requestKey:crypto.randomUUID()});
 assert.notEqual((await run(linux)).isError,true);assert.notEqual((await run(mac)).isError,true);
 assert.deepEqual(f.calls.filter(c=>c[1]==='start').map(c=>c[0]),['linux','macbook']);
 assert.equal(app.store.get(linux.id).jobs[0].computeTarget,'linux');assert.equal(app.store.get(mac.id).jobs[0].computeTarget,'macbook');
 await f.router.select('linux',2);assert.equal((await run(mac)).isError,true);assert.equal(f.calls.filter(c=>c[1]==='start').length,2);
});
