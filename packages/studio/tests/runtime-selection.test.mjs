import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeSelection} from '../server/runtime-selection.mjs';

function fixture({getJob, helpers = {}} = {}) {
  let selected = {engine: 'codex'};
  const calls = [];
  const adapter = engine => ({
    async catalog() { calls.push([engine, 'catalog']); return {models: [{id: `${engine}-model`}], account: {type: `${engine}-subscription`}}; },
    async start(options) { calls.push([engine, 'start', options]); const threadId = `${engine}-session`; await options.onEvent?.({method: 'reel/thread-ready', params: {threadId, cwd: options.cwd}}); return {threadId, turnId: `${engine}-turn`}; },
    async reconcile(...args) { calls.push([engine, 'reconcile', ...args]); return {threadId: args[0], latestTurn: {status: 'completed'}}; },
    async cancel(...args) { calls.push([engine, 'cancel', ...args]); return {status: 'cancel_requested'}; },
    watch(...args) { calls.push([engine, 'watch', ...args]); },
    async researchAccess() { calls.push([engine, 'researchAccess']); return {route: 'codex-app'}; },
    async close() { calls.push([engine, 'close']); },
  });
  const codexRuntime = adapter('codex'), claudeRuntime = adapter('claude');
  claudeRuntime.steer = async (...args) => { calls.push(['claude', 'steer', ...args]); return {threadId: args[0]}; };
  const runtime = new RuntimeSelection({codexRuntime, claudeRuntime, getSelection: () => selected, getJob, ...helpers});
  return {runtime, calls, select: engine => { selected = {engine}; }};
}

test('new jobs follow selected engine; active jobs retain original engine through changes', async () => {
  const f = fixture(); const events = [];
  try {
    assert.equal((await f.runtime.catalog()).engine, 'codex');
    const codex = await f.runtime.start({cwd: '/jobs/codex', prompt: 'first', onEvent: event => events.push(event)});
    f.select('claude'); assert.equal((await f.runtime.check()).engine, 'claude');
    const claude = await f.runtime.start({cwd: '/jobs/claude', prompt: 'second', onEvent: event => events.push(event)});
    assert.equal(codex.engine, 'codex'); assert.equal(claude.engine, 'claude'); assert.equal(events[1].params.runtimeKind, 'claude');
    await f.runtime.reconcile(codex.threadId); await f.runtime.cancel(codex.threadId, codex.turnId); await f.runtime.watch(codex.threadId, () => {});
    f.select('codex'); await f.runtime.reconcile(claude.threadId); await f.runtime.cancel(claude.threadId, claude.turnId); await f.runtime.steer(claude.threadId, {prompt: 'continue'});
    assert.equal(f.calls.some(call => call[0] === 'claude' && call[1] === 'reconcile' && call[2] === codex.threadId), false);
    assert.equal(f.calls.some(call => call[0] === 'codex' && call[1] === 'cancel' && call[2] === claude.threadId), false);
    assert.deepEqual(f.calls.find(call => call[0] === 'claude' && call[1] === 'reconcile')[3], {cwd: '/jobs/claude'});
    assert.equal(f.calls.find(call => call[1] === 'steer')[3].cwd, '/jobs/claude');
  } finally { await f.runtime.close(); }
});

test('saved original engine restores routing after restart, including legacy Codex jobs', async () => {
  const jobs = {'persisted-claude': {engine: 'claude', dir: '/jobs/claude', threadId: 'persisted-claude'}, 'old-codex': {dir: '/jobs/codex', threadId: 'old-codex'}};
  const f = fixture({getJob: id => jobs[id]});
  try {
    f.select('claude'); assert.equal((await f.runtime.reconcile('old-codex')).engine, 'codex');
    f.select('codex'); assert.equal((await f.runtime.reconcile('persisted-claude')).engine, 'claude');
    await assert.rejects(f.runtime.reconcile('unknown'), /original job engine is unknown/);
    await assert.rejects(f.runtime.cancel('persisted-claude', 'turn', {engine: 'codex'}), /cannot switch AI engines/);
    await assert.rejects(f.runtime.steer('persisted-claude', {prompt: 'change cwd', cwd: '/different'}), /cannot switch its owned directory/);
  } finally { await f.runtime.close(); }
});

test('unsupported selection and conflicting job identity never trigger provider fallback', async () => {
  const f = fixture({getJob: () => ({engine: 'claude', threadId: 'different-id', dir: '/jobs/c'})});
  try {
    f.select('unimplemented-api'); await assert.rejects(f.runtime.catalog(), /unsupported/); await assert.rejects(f.runtime.start({cwd: '/job'}), /unsupported/);
    assert.equal(f.calls.length, 0);
    f.select('claude'); await assert.rejects(f.runtime.start({cwd: '/job', engine: 'codex'}), /differs from the selected/);
    await assert.rejects(f.runtime.reconcile('saved-session'), /does not match/);
    assert.equal(f.calls.length, 0);
  } finally { await f.runtime.close(); }
});

test('Claude optional helpers use explicit independent adapters or return useful unsupported errors', async () => {
  const f = fixture();
  try {
    f.select('claude'); await assert.rejects(f.runtime.researchAccess({}), /independently configured/); await assert.rejects(f.runtime.researchRequest({}, {}), /hidden Codex/); await assert.rejects(f.runtime.speechRequest({}), /independently configured/);
    assert.equal(f.calls.length, 0);
    f.select('codex'); assert.equal((await f.runtime.researchAccess({})).route, 'codex-app');
    await assert.rejects(f.runtime.steer('unknown', {prompt: 'continue'}), /original job engine is unknown/);
    const codex = await f.runtime.start({cwd: '/job'}); await assert.rejects(f.runtime.steer(codex.threadId, {prompt: 'continue'}), /does not support steering/);
  } finally { await f.runtime.close(); }
  const independentCalls = [];
  const g = fixture({helpers: {researchAccess: async options => { independentCalls.push(options); return {route: 'independent-dataforseo'}; }}});
  try { g.select('claude'); assert.equal((await g.runtime.researchAccess({bounded: true})).route, 'independent-dataforseo'); assert.deepEqual(independentCalls, [{bounded: true}]); assert.equal(g.calls.length, 0); }
  finally { await g.runtime.close(); }
});

test('close releases both engine adapters exactly once', async () => {
  const f = fixture(); await f.runtime.close(); await f.runtime.close();
  assert.deepEqual(f.calls, [['codex', 'close'], ['claude', 'close']]);
  await assert.rejects(f.runtime.catalog(), /closed/);
});
