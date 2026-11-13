import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexRuntime } from '../server/codex-runtime.mjs';

function fixture({ wrongPermissions = false, wrongProvider = false, drop = null, supportedEfforts = ['xhigh'], catalogModel = 'gpt-6.1-sol' } = {}) {
  const calls = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); return true; };
  const emit = message => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const request = JSON.parse(chunk.toString()); calls.push(request);
    if (request.id === undefined || request.error) { callback(); return; }
    if (request.method === drop) { callback(); return; }
    let result = {};
    if (request.method === 'account/read') result = { account: { type: 'chatgpt', planType: 'pro', email: 'should-not-leak' } };
    if (request.method === 'model/list') result = { data: [{ id: 'picker-id', model: catalogModel, displayName: catalogModel, supportedReasoningEfforts: supportedEfforts.map(reasoningEffort=>({reasoningEffort})), defaultReasoningEffort: 'xhigh', hidden: false }], nextCursor: null };
    if (request.method === 'thread/start') result = { thread: { id: 'thread-1' }, model: request.params.model, modelProvider:wrongProvider?'untrusted_fixture_gateway':request.params.modelProvider||'openai', cwd: request.params.cwd, reasoningEffort: request.params.config.model_reasoning_effort, approvalPolicy: 'never', sandbox: { type: wrongPermissions ? 'workspaceWrite' : 'dangerFullAccess' } };
    if (request.method === 'turn/start') result = { turn: { id: 'turn-1', status: 'inProgress' } };
    if (request.method === 'thread/read') result = { thread: { id: request.params.threadId, status: { type: 'idle' }, model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' } };
    if (request.method === 'thread/turns/list') result = { data: [{ id: 'turn-1', status: 'completed', error: null, startedAt: 1, completedAt: 2 }], nextCursor: null };
    if (request.method === 'mcpServerStatus/list') result = {data:[{name:'codex_apps',tools:{'dataforseo.api_request':{},'dataforseo.docs_search':{}}}]};
    if (request.method === 'mcpServer/tool/call') result = {content:[{type:'text',text:request.params.tool==='dataforseo.docs_search'?'Live YouTube Organic Advanced':JSON.stringify({tasks:[]})}]};
    queueMicrotask(() => emit({ id: request.id, result })); callback();
  } });
  let spawnCount = 0;
  const runtime = new CodexRuntime({ timeoutMs: 30, spawnImpl: (_binary, args, options) => { spawnCount++; assert.deepEqual(args, ['app-server', '--stdio']); assert.equal(options.shell, false); return child; } });
  return { runtime, calls, child, emit, spawnCount: () => spawnCount };
}

test('catalog uses persistent subscription runtime and strips account identity', async () => {
  const f = fixture();
  try {
    const catalog = await f.runtime.catalog(); await f.runtime.catalog();
    assert.deepEqual(catalog.account, { type: 'chatgpt', planType: 'pro' });
    assert.deepEqual(catalog.models[0].reasoningEfforts, ['xhigh']);
    assert.equal(catalog.models[0].id, 'gpt-6.1-sol');
    assert.equal(f.spawnCount(), 1);
  } finally { await f.runtime.close(); }
});

test('DataForSEO reuses the connected app in an ephemeral Full access context without a model turn',async()=>{
 const f=fixture();try{
  const options={cwd:'/tmp/reel-research',model:'gpt-6.1-sol',effort:'xhigh'};
  assert.equal((await f.runtime.researchAccess(options)).status,'verified');
  await f.runtime.researchRequest({method:'POST',path:'/v3/serp/youtube/organic/live/advanced',data:[{keyword:'astronauts'}],noAiMode:true},options);
  assert.equal(f.calls.filter(c=>c.method==='thread/start').length,1);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
  const context=f.calls.find(c=>c.method==='thread/start');assert.equal(context.params.ephemeral,true);assert.equal(context.params.sandbox,'danger-full-access');
  const api=f.calls.find(c=>c.method==='mcpServer/tool/call'&&c.params.tool==='dataforseo.api_request');assert.equal(api.params.server,'codex_apps');assert.equal(api.params.arguments.noAiMode,true);
 }finally{await f.runtime.close();}
});

test('start validates effective Full access, forwards completion and cancels exact turn', async () => {
  const f = fixture(); const events = [];
  try {
    const result = await f.runtime.start({ cwd: '/task', prompt: 'Generate authorized video', model: 'gpt-6.1-sol', effort: 'xhigh', onEvent: async event => {
      if (event.method === 'reel/thread-ready') {
        await Promise.resolve();
        assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
        assert.equal(event.params.threadId, 'thread-1');
      }
      events.push(event);
    } });
    assert.deepEqual(result.permissions, { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
    assert.equal(f.calls.find(call=>call.method==='thread/start').params.modelProvider,'openai');
    assert.equal(result.modelProvider,'openai');
    assert.equal(f.calls.find(call => call.method === 'turn/start').params.serviceTierForTurn, 'default');
    f.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    assert.equal(events.at(-1).params.turn.status, 'completed');
    await f.runtime.cancel(result.threadId, result.turnId);
    assert.deepEqual(f.calls.at(-1).params, { threadId: 'thread-1', turnId: 'turn-1' });
  } finally { await f.runtime.close(); }
});

test('a new GPT Studio thread cannot fall back to the machine gateway before starting a turn',async()=>{
 const f=fixture({wrongProvider:true});try{
  await assert.rejects(f.runtime.start({cwd:'/task',prompt:'Authorized new video',model:'gpt-6.1-sol',effort:'xhigh'}),/readback/);
  assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
  assert.equal(f.calls.find(c=>c.method==='thread/start').params.allowProviderModelFallback,false);
 }finally{await f.runtime.close();}
});
test('managed max execution preserves OpenAI/full/standard and rejects a conflicting route before connection',async()=>{
 const execution={kind:'bb',bbThreadId:'thr_fixture_verifiedcoordinator',nativeThreadId:'11111111-1111-4111-8111-111111111111',host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'max',permissionMode:'full-access',serviceTier:'standard',cwd:'/source-workspace'},bad=fixture({supportedEfforts:['max']});
 try{await assert.rejects(bad.runtime.start({cwd:'/job',prompt:'Authorized current producer',model:'gpt-6.1-sol',effort:'max',execution:{...execution,effort:'medium'}}),/execution route/);await assert.rejects(bad.runtime.researchAccess({cwd:'/job',model:'gpt-6.1-sol',effort:'max',execution:{...execution,serviceTier:'fast'}}),/execution route/);assert.equal(bad.spawnCount(),0);}finally{await bad.runtime.close();}
 const f=fixture({supportedEfforts:['max']});try{const r=await f.runtime.start({cwd:'/job',prompt:'Authorized current producer',model:execution.model,effort:execution.effort,execution});assert.notEqual(r.threadId,execution.nativeThreadId);const thread=f.calls.find(c=>c.method==='thread/start'),turn=f.calls.find(c=>c.method==='turn/start');assert.equal(thread.params.modelProvider,'openai');assert.equal(thread.params.config.model_reasoning_effort,'max');assert.equal(thread.params.sandbox,'danger-full-access');assert.equal(thread.params.approvalPolicy,'never');assert.equal(thread.params.allowProviderModelFallback,false);assert.equal(turn.params.effort,'max');assert.equal(turn.params.serviceTierForTurn,'default');}finally{await f.runtime.close();}
});

test('managed Terra/ultra verifies the actual native route and refuses mixed or unknown pairs before connecting',async()=>{
 const execution={kind:'bb',bbThreadId:'thr_fixture_same_verified_owner',nativeThreadId:'22222222-2222-4222-8222-222222222222',host:'linux',provider:'openai',model:'gpt-6.1-terra',effort:'ultra',permissionMode:'full-access',serviceTier:'standard',cwd:'/source-workspace'};
 const f=fixture({catalogModel:execution.model,supportedEfforts:['ultra']});
 try{
  const result=await f.runtime.start({cwd:'/job',prompt:'Authorized current same-owner producer',model:execution.model,effort:execution.effort,execution});
  assert.equal(result.modelProvider,'openai');assert.notEqual(result.threadId,execution.nativeThreadId);
  const thread=f.calls.find(c=>c.method==='thread/start'),turn=f.calls.find(c=>c.method==='turn/start');
  assert.equal(thread.params.model,'gpt-6.1-terra');assert.equal(thread.params.config.model_reasoning_effort,'ultra');assert.equal(thread.params.allowProviderModelFallback,false);assert.equal(turn.params.model,'gpt-6.1-terra');assert.equal(turn.params.effort,'ultra');assert.equal(turn.params.serviceTierForTurn,'default');
 }finally{await f.runtime.close();}
 for(const [model,effort] of [['gpt-6.1-sol','ultra'],['gpt-6.1-terra','max'],['unknown','ultra']]){
  const bad=fixture({catalogModel:model,supportedEfforts:[effort]});try{await assert.rejects(bad.runtime.start({cwd:'/job',prompt:'Must refuse before launch',model,effort,execution:{...execution,model,effort}}),/execution route/);assert.equal(bad.spawnCount(),0);}finally{await bad.runtime.close();}
 }
});

test('managed Sol/xhigh preserves the standard worker route and Fast metadata cannot launch a worker',async()=>{
 const execution={kind:'bb',bbThreadId:'thr_fixture_same_verified_owner',nativeThreadId:'22222222-2222-4222-8222-222222222222',host:'linux',provider:'openai',model:'gpt-6.1-sol',effort:'xhigh',permissionMode:'full-access',serviceTier:'standard',cwd:'/source-workspace'};
 const f=fixture();try{
  await f.runtime.start({cwd:'/job',prompt:'Authorized existing managed route',model:execution.model,effort:execution.effort,execution});
  assert.equal(f.calls.find(c=>c.method==='turn/start').params.serviceTierForTurn,'default');
  assert.equal(f.calls.find(c=>c.method==='turn/start').params.effort,'xhigh');
 }finally{await f.runtime.close();}
 const fast=fixture();try{
  await assert.rejects(fast.runtime.start({cwd:'/job',prompt:'Must refuse before connection',model:execution.model,effort:execution.effort,execution:{...execution,serviceTier:'fast'}}),/execution route/);
  assert.equal(fast.spawnCount(),0);assert.equal(fast.calls.length,0);
 }finally{await fast.runtime.close();}
});

test('unsupported selection and mismatched permissions never start a model turn', async () => {
  for (const wrongPermissions of [false, true]) {
    const f = fixture({ wrongPermissions });
    try {
      await assert.rejects(f.runtime.start({ cwd: '/task', prompt: 'Video', model: 'gpt-6.1-sol', effort: wrongPermissions ? 'xhigh' : 'ultra' }), /unavailable|readback/);
      assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
    } finally { await f.runtime.close(); }
  }
});

test('reconcile is bounded read-only and watch cannot attach by resuming', async () => {
  const f = fixture();
  try {
    const state = await f.runtime.reconcile('thread-1');
    assert.equal(state.latestTurn.id, 'turn-1');
    assert.equal(state.latestTurn.status, 'completed');
    assert.deepEqual(f.calls.at(-1).params, { threadId: 'thread-1', limit: 1, sortDirection: 'desc', itemsView: 'summary' });
    assert.equal(f.calls.some(call => /thread\/(start|resume)|turn\/start/.test(call.method)), false);
    assert.throws(() => f.runtime.watch('thread-1', () => {}), /not subscribed/);
  } finally { await f.runtime.close(); }
});

test('server request is rejected, protocol errors fail pending requests, timeout does not replay', async () => {
  const f = fixture();
  await f.runtime.catalog();
  f.emit({ id: 900, method: 'item/commandExecution/requestApproval', params: {} });
  assert.equal(f.calls.at(-1).error.code, -32601);
  await f.runtime.close();
  const bad = fixture({ drop: 'model/list' });
  try { await assert.rejects(bad.runtime.catalog(), /timed out/); assert.equal(bad.calls.filter(call => call.method === 'model/list').length, 1); }
  finally { await bad.runtime.close(); }
  const broken = fixture({ drop: 'model/list' });
  const pending = broken.runtime.catalog();
  setTimeout(() => broken.child.stdout.write('not-json\n'), 5);
  await assert.rejects(pending, /Invalid Codex protocol JSON/);
  await broken.runtime.close();
});
