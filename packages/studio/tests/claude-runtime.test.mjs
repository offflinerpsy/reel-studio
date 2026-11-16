import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeRuntime} from '../server/claude-runtime.mjs';

const HELP = 'Claude Code --print --output-format stream-json --verbose --effort low medium high max --model sonnet opus --session-id --resume --permission-mode bypassPermissions --setting-sources';
async function fixture({auth = {loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro', email: 'private@example.invalid'}, init = true, env = {}, help = HELP} = {}) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'reel-claude-test-')));
  const calls = [], processes = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
    let prompt = '';
    child.stdin = new Writable({write(chunk, _encoding, done) { prompt += chunk; done(); }, final(done) {
      if (init) queueMicrotask(() => child.emitJSON({type: 'system', subtype: 'init', session_id: args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1], model: args[args.indexOf('--model') + 1] === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6', permissionMode: 'bypassPermissions'}));
      done();
    }});
    child.emitJSON = event => child.stdout.write(`${JSON.stringify(event)}\n`);
    child.kill = signal => { child.kills.push(signal); child.exitCode = 130; queueMicrotask(() => child.emit('close', 130, signal)); return true; }; child.kills = [];
    calls.push({binary, args, options, child, prompt: () => prompt});
    if (!args.includes('--print')) queueMicrotask(() => {
      const output = args[0] === '--help' ? help : args[0] === '--version' ? '2.1.104 (Claude Code)' : JSON.stringify(auth);
      child.stdout.end(output); child.exitCode = args.includes('auth') && !auth.loggedIn ? 1 : 0; child.emit('close', child.exitCode);
    }); else processes.push(child);
    return child;
  };
  const runtime = new ClaudeRuntime({spawnImpl, env, timeoutMs: 100, killTimeoutMs: 10, binary: 'official-claude-fixture'});
  return {runtime, spawnImpl, cwd, calls, processes, run: () => calls.filter(call => call.args.includes('--print')), async cleanup() { await runtime.close(); await rm(cwd, {recursive: true, force: true}); }};
}

test('catalog/check use official read-only commands and redact account identity without paid inference', async () => {
  const f = await fixture();
  try {
    const catalog = await f.runtime.check();
    assert.equal(catalog.availability.available, true);
    assert.equal(catalog.account.subscriptionType, 'pro');
    assert.equal(JSON.stringify(catalog).includes('private@example'), false);
    assert.equal(catalog.modelAvailability, 'unverified-until-run');
    assert.deepEqual(catalog.models.map(model => model.id), ['sonnet', 'opus']);
    assert.equal(f.run().length, 0);
    assert.deepEqual(f.calls.map(call => call.args), [['--help'], ['--version'], ['--setting-sources', '', 'auth', 'status', '--json']]);
    assert.equal(f.calls.every(call => call.options.shell === false), true);
  } finally { await f.cleanup(); }
});

test('signed-out, API-account and injected API environments cannot spend or fall back', async () => {
  for (const auth of [{loggedIn: false, authMethod: 'none', apiProvider: 'firstParty'}, {loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty'}, {loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock'}]) {
    const f = await fixture({auth}); try {
      const catalog = await f.runtime.catalog(); assert.equal(catalog.availability.available, false); assert.deepEqual(catalog.models, []);
      await assert.rejects(f.runtime.start({cwd: f.cwd, prompt: 'Authorized film', model: 'sonnet', effort: 'high'}), /own Claude subscription/);
      assert.equal(f.run().length, 0);
    } finally { await f.cleanup(); }
  }
  const f = await fixture({env: {ANTHROPIC_API_KEY: 'fixture-key'}});
  try { await assert.rejects(f.runtime.check(), /cannot use API keys/); assert.equal(f.calls.length, 0); }
  finally { await f.cleanup(); }
});

test('streaming success preserves native session/model/result IDs and persists before inference', async () => {
  const f = await fixture(); const events = [];
  try {
    const started = await f.runtime.start({cwd: f.cwd, prompt: 'Private production prompt', model: 'sonnet', effort: 'high', onEvent: async event => {
      if (event.method === 'reel/thread-ready') {
        assert.equal(f.run().length, 0);
        const disk = JSON.parse(await readFile(join(f.cwd, '.reel-claude-runtime.json'), 'utf8'));
        assert.equal(disk.threadId, event.params.threadId); assert.equal(disk.engine, 'claude'); assert.equal(disk.effect, 'not_delivered');
      }
      events.push(event);
    }});
    assert.equal(started.engine, 'claude'); assert.equal(started.nativeSessionId, started.threadId); assert.equal(started.nativeModel, 'claude-sonnet-4-6');
    assert.equal(started.permissions.nativePermissionMode, 'bypassPermissions');
    const call = f.run()[0]; assert.equal(call.options.cwd, f.cwd); assert.equal(call.prompt(), 'Private production prompt');
    assert.equal(call.args.includes('--bare'), false); assert.equal(call.args.includes('--fallback-model'), false); assert.equal(call.args.includes('Private production prompt'), false);
    const child = f.processes[0];
    child.emitJSON({type: 'assistant', session_id: started.threadId, message: {content: [{type: 'tool_use', id: 'tool1', name: 'Bash', input: {command: 'private-input'}}]}});
    child.emitJSON({type: 'result', session_id: started.threadId, subtype: 'success', is_error: false, uuid: 'native-result-id', result: 'private-output'});
    const read = await f.runtime.reconcile(started.threadId);
    assert.equal(read.latestTurn.status, 'completed'); assert.equal(read.nativeTurnId, 'native-result-id'); assert.equal(read.readOnly, true);
    assert.equal(events.find(event => event.method === 'item/started').params.item.type, 'commandExecution');
    assert.equal(events.at(-1).params.turn.status, 'completed');
    const disk = await readFile(join(f.cwd, '.reel-claude-runtime.json'), 'utf8');
    assert.equal(disk.includes('Private production prompt'), false); assert.equal(disk.includes('private-output'), false); assert.equal(disk.includes('private-input'), false);
    await assert.rejects(f.runtime.start({cwd: f.cwd, prompt: 'Duplicate', model: 'sonnet', effort: 'high'}), /already has an execution receipt/);
    assert.equal(f.run().length, 1);
  } finally { await f.cleanup(); }
});

test('CLI result failure is a failed turn without forwarding potentially sensitive diagnostics', async () => {
  const f = await fixture(); const events = [];
  try {
    const started = await f.runtime.start({cwd: f.cwd, prompt: 'Authorized film', model: 'opus', effort: 'max', onEvent: event => events.push(event)});
    f.processes[0].emitJSON({type: 'result', session_id: started.threadId, subtype: 'error_during_execution', is_error: true, uuid: 'error-result', errors: ['secret-path-and-token']});
    const read = await f.runtime.reconcile(started.threadId);
    assert.equal(read.latestTurn.status, 'failed'); assert.equal(JSON.stringify(events).includes('secret-path-and-token'), false);
  } finally { await f.cleanup(); }
});

test('cancellation signals only the exact attached turn and explicit resume keeps native session identity', async () => {
  const f = await fixture();
  try {
    const original = await f.runtime.start({cwd: f.cwd, prompt: 'Authorized film', model: 'sonnet', effort: 'high'});
    await assert.rejects(f.runtime.cancel(original.threadId, 'different-turn'), /exact original turn/);
    await assert.rejects(f.runtime.steer(original.threadId, {prompt: 'Append'}), /active or uncertain/);
    await f.runtime.cancel(original.threadId, original.turnId);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.runtime.reconcile(original.threadId)).latestTurn.status, 'interrupted'); assert.deepEqual(f.processes[0].kills, ['SIGINT']);
    const resumed = await f.runtime.steer(original.threadId, {prompt: 'Continue the interrupted film'});
    assert.equal(resumed.threadId, original.threadId); assert.notEqual(resumed.turnId, original.turnId);
    assert.equal(f.run()[1].args.includes('--resume'), true); assert.equal(f.run()[1].args.includes('--session-id'), false);
    f.processes[1].emitJSON({type: 'result', session_id: original.threadId, subtype: 'success', uuid: 'resumed-result'});
    assert.equal((await f.runtime.reconcile(original.threadId)).latestTurn.status, 'completed');
  } finally { await f.cleanup(); }
});

test('read-only reconciliation after restart uses the owned receipt and never resumes a process', async () => {
  const f = await fixture();
  try {
    const started = await f.runtime.start({cwd: f.cwd, prompt: 'Authorized film', model: 'sonnet', effort: 'medium'});
    await f.runtime.close();
    let spawns = 0;
    const reopened = new ClaudeRuntime({spawnImpl: () => { spawns++; throw new Error('must not spawn'); }, env: {}});
    try {
      const read = await reopened.reconcile(started.threadId, {cwd: f.cwd});
      assert.equal(read.latestTurn.status, 'uncertain'); assert.equal(read.attached, false); assert.equal(spawns, 0);
      await assert.rejects(reopened.steer(started.threadId, {cwd: f.cwd, prompt: 'Unsafe replay'}), /active or uncertain/);
      await assert.rejects(reopened.cancel(started.threadId, started.turnId), /not attached/); assert.equal(spawns, 0);
    } finally { await reopened.close(); }
  } finally { await f.cleanup(); }
});

test('session/model/permission mismatch and malformed output preserve uncertainty without retry', async () => {
  for (const wrong of ['session', 'model', 'permissions', 'json']) {
    const f = await fixture({init: false}); const events = [];
    try {
      const pending = f.runtime.start({cwd: f.cwd, prompt: 'Authorized film', model: 'sonnet', effort: 'high', onEvent: event => events.push(event)});
      while (!f.processes.length) await new Promise(resolve => setImmediate(resolve));
      const call = f.run()[0], session = call.args[call.args.indexOf('--session-id') + 1];
      if (wrong === 'json') f.processes[0].stdout.write('not-json\n');
      else f.processes[0].emitJSON({type: 'system', subtype: 'init', session_id: wrong === 'session' ? 'another-session' : session, model: wrong === 'model' ? 'claude-opus-4-6' : 'claude-sonnet-4-6', permissionMode: wrong === 'permissions' ? 'default' : 'bypassPermissions'});
      await assert.rejects(pending, /reconcile/);
      const read = await f.runtime.reconcile(session); assert.equal(read.latestTurn.status, 'uncertain'); assert.equal(f.run().length, 1);
      assert.equal(events.some(event => event.method === 'error' && event.params.transportLost), true);
    } finally { await f.cleanup(); }
  }
});

test('unsupported aliases/effort and admitted Codex routes fail before CLI launch', async () => {
  const f = await fixture();
  try {
    for (const options of [{model: 'gpt-6.1-sol', effort: 'high'}, {model: 'sonnet', effort: 'max'}, {model: 'opus', effort: 'ultra'}, {model: 'sonnet', effort: 'high', execution: {provider: 'openai'}}]) {
      await assert.rejects(f.runtime.start({cwd: f.cwd, prompt: 'Authorized film', ...options}), /unavailable|cannot be changed/);
    }
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});


test('concurrent explicit resumes after restart share one loaded job and cannot replay the same native session', async () => {
  const f = await fixture();
  try {
    const started = await f.runtime.start({cwd: f.cwd, prompt: 'First turn', model: 'sonnet', effort: 'high'});
    f.processes[0].emitJSON({type: 'result', session_id: started.threadId, subtype: 'success', uuid: 'completed-first'});
    await f.runtime.reconcile(started.threadId);
    f.processes[0].emit('close', 0);
    await f.runtime.close();
    const restarted = new ClaudeRuntime({spawnImpl: f.spawnImpl, env: {}, timeoutMs: 100, killTimeoutMs: 10});
    try {
      const outcomes = await Promise.allSettled([1, 2].map(() => restarted.steer(started.threadId, {cwd: f.cwd, prompt: 'One explicit continuation'})));
      assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
      assert.equal(f.run().length, 2);
      assert.match(outcomes.find(value => value.status === 'rejected').reason.message, /active or uncertain/);
    } finally { await restarted.close(); }
  } finally { await f.cleanup(); }
});

test('independent adapters cannot concurrently resume or reuse a stale terminal receipt', async () => {
  const f = await fixture();
  const reopened = Array.from({length: 2}, () => new ClaudeRuntime({spawnImpl: f.spawnImpl, env: {}, timeoutMs: 100, killTimeoutMs: 10}));
  try {
    const started = await f.runtime.start({cwd: f.cwd, prompt: 'Original turn', model: 'sonnet', effort: 'high'});
    f.processes[0].emitJSON({type: 'result', session_id: started.threadId, subtype: 'success'});
    await f.runtime.reconcile(started.threadId); f.processes[0].emit('close', 0); await f.runtime.close();
    await Promise.all(reopened.map(runtime => runtime.reconcile(started.threadId, {cwd: f.cwd})));
    const outcomes = await Promise.allSettled(reopened.map(runtime => runtime.steer(started.threadId, {cwd: f.cwd, prompt: 'Continue once'})));
    assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(f.run().length, 2);
    const winner = outcomes.findIndex(value => value.status === 'fulfilled'), loser = 1 - winner;
    f.processes[1].emitJSON({type: 'result', session_id: started.threadId, subtype: 'success'});
    await reopened[winner].reconcile(started.threadId); f.processes[1].emit('close', 0);
    await assert.rejects(reopened[loser].steer(started.threadId, {cwd: f.cwd, prompt: 'Stale replay'}), /receipt changed|active or uncertain/);
    const fresh = await reopened[loser].reconcile(started.threadId);
    assert.equal(fresh.latestTurn.id, outcomes[winner].value.turnId);
    assert.equal(f.run().length, 2);
  } finally { await Promise.all(reopened.map(runtime => runtime.close())); await f.cleanup(); }
});

for (const boundary of ['catalog', 'thread-ready', 'effect-save', 'resume-thread-ready']) {
  test(`closing while ${boundary} is awaiting prevents any later Claude process`, async () => {
    const f = await fixture(); let release, entered;
    const gate = new Promise(resolve => {release = resolve;}), atBoundary = new Promise(resolve => {entered = resolve;});
    try {
      let original;
      if (boundary === 'resume-thread-ready') {
        original = await f.runtime.start({cwd: f.cwd, prompt: 'Original turn', model: 'sonnet', effort: 'high'});
        f.processes[0].emitJSON({type: 'result', session_id: original.threadId, subtype: 'success'});
        await f.runtime.reconcile(original.threadId); f.processes[0].emit('close', 0);
      }
      if (boundary === 'catalog') {
        const catalog = f.runtime.catalog.bind(f.runtime);
        f.runtime.catalog = async () => {const value = await catalog(); entered(); await gate; return value;};
      } else if (boundary === 'effect-save') {
        const save = f.runtime.save.bind(f.runtime);
        f.runtime.save = async job => {await save(job); if (job.receipt.effect === 'possibly_delivered') {entered(); await gate;}};
      }
      const options = {cwd: f.cwd, prompt: 'Authorized next turn', model: 'sonnet', effort: 'high', onEvent: async event => {
        if (boundary.endsWith('thread-ready') && event.method === 'reel/thread-ready') {entered(); await gate;}
      }};
      const pending = original ? f.runtime.steer(original.threadId, options) : f.runtime.start(options);
      const outcome = pending.then(value => ({value}), error => ({error}));
      await atBoundary; await f.runtime.close(); release();
      const completed = await outcome;
      assert.match(completed.error?.message || '', /closed/);
      assert.equal(f.run().length, original ? 1 : 0);
      const receipt = JSON.parse(await readFile(join(f.cwd, '.reel-claude-runtime.json'), 'utf8'));
      assert.equal(receipt.effect, 'not_delivered'); assert.equal(receipt.status, 'failed');
    } finally {release(); await f.cleanup();}
  });
}
