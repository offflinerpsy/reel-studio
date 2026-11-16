import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataForSeoDirect } from '../server/dataforseo-direct.mjs';
import { researchPlan, sanitizeReceipt } from '../server/research.mjs';

const credentials = { login: 'own@example.test', password: 'secret-password' };
const getCredentials = async service => { assert.equal(service, 'dataforseo'); return credentials; };
const plan = researchPlan({ keywords: ['solar wind'], locationCode: 2840, languageCode: 'en', timeRange: 'past_30_days' });
const response = (data = {}, status = 200) => new Response(JSON.stringify({ status_code: 20000, tasks: [{ id: 'task-123', status_code: 20000, cost: 0, data, result: [] }] }), { status });

test('direct adapter uses only official existing endpoints and own Basic auth, independent of Codex grants', async () => {
  const calls = [];
  const adapter = createDataForSeoDirect({ getCredentials, fetchImpl: async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64')}`);
    if (init.method === 'GET') return response();
    const data = JSON.parse(init.body); assert.equal(data.length, 1); return response(data[0]);
  } });
  assert.deepEqual(await adapter.checkAccess({ threadId: 'claude-has-no-codex-grant' }), { status: 'verified', provider: 'DataForSEO', route: 'direct', configured: true });
  for (const operation of plan.operations) {
    const raw = await adapter.request({ method: 'POST', path: operation.path, data: operation.data }, { threadId: 'claude' });
    assert.equal(sanitizeReceipt(raw, operation, plan.spec).taskId, 'task-123'); assert.equal(JSON.stringify(raw).includes('secret-password'), false);
  }
  assert.deepEqual(calls, ['https://api.dataforseo.com/v3/appendix/user_data', ...plan.operations.map(op => `https://api.dataforseo.com${op.path}`)]);
});

test('exact allowlist rejects guessed paths, origins, query strings, methods and bulk tasks before any fetch', async () => {
  let calls = 0; const adapter = createDataForSeoDirect({ getCredentials, fetchImpl: async () => { calls++; return response(); } });
  for (const request of [
    { method: 'POST', path: '/v3/serp/google/organic/live/advanced', data: [{}] },
    { method: 'POST', path: `${plan.operations[0].path}?x=1`, data: [{}] },
    { method: 'POST', path: `https://evil.example${plan.operations[0].path}`, data: [{}] },
    { method: 'GET', path: plan.operations[0].path },
    { method: 'POST', path: plan.operations[0].path, data: [{}, {}] },
    { method: 'GET', path: '/v3/appendix/user_data', data: [{}] },
  ]) await assert.rejects(adapter.request(request));
  assert.equal(calls, 0);
});

test('uncertain paid POST is never retried and errors retain only sanitized provider task IDs', async () => {
  let calls = 0; const request = { method: 'POST', path: plan.operations[0].path, data: plan.operations[0].data };
  const adapter = createDataForSeoDirect({ getCredentials, fetchImpl: async () => { calls++; throw new Error(`transport ${credentials.password}`); } });
  await assert.rejects(adapter.request(request), error => error.effect === 'possibly_delivered' && error.code === 'dataforseo_transport_failed' && !error.message.includes(credentials.password)); assert.equal(calls, 1);
  const rejected = createDataForSeoDirect({ getCredentials, fetchImpl: async () => new Response(JSON.stringify({ status_code: 40100, status_message: credentials.password, tasks: [{ id: 'safe-id', status_message: credentials.password }, { id: credentials.login }, { id: credentials.password }] }), { status: 401 }) });
  await assert.rejects(rejected.request(request), error => { assert.deepEqual(error.taskIds, ['safe-id']); assert.equal(error.effect, 'possibly_delivered'); assert.equal(JSON.stringify(error).includes(credentials.password), false); return true; });
});

test('provider echo fields cannot return connection secrets in research results', async () => {
  const adapter = createDataForSeoDirect({ getCredentials, fetchImpl: async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ id: 'safe-id', status_code: 20000, cost: 0, data: { password: credentials.password, keyword: 'topic' }, result: [{ items: [{ title: `Echo ${credentials.password}`, login: credentials.login }] }] }] })) });
  const raw = await adapter.request({ method: 'POST', path: plan.operations[0].path, data: plan.operations[0].data });
  assert.equal(JSON.stringify(raw).includes(credentials.password), false); assert.equal(JSON.stringify(raw).includes(credentials.login), false); assert.equal(raw.tasks[0].data.keyword, 'topic');
});

test('invalid JSON, oversized responses and unavailable own credentials fail with bounded sanitized errors', async () => {
  const request = { method: 'POST', path: plan.operations[0].path, data: plan.operations[0].data };
  for (const badResponse of [() => new Response('secret-password'), () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }), () => new Response(JSON.stringify({ status_code: 50000, status_message: credentials.password }))]) {
    const adapter = createDataForSeoDirect({ getCredentials, fetchImpl: async () => badResponse() });
    await assert.rejects(adapter.request(request), error => !error.message.includes(credentials.password) && error.effect === 'possibly_delivered');
  }
  let calls = 0; const missing = createDataForSeoDirect({ getCredentials: async () => null, fetchImpl: async () => { calls++; } });
  await assert.rejects(missing.request(request), /not_configured/); assert.equal(calls, 0);
});

test('an empty or ambiguous access response cannot verify an account connection', async () => {
  for (const tasks of [[], [{status_code: 20000}, {status_code: 20000}], [null]]) {
    const adapter = createDataForSeoDirect({getCredentials, fetchImpl: async () => new Response(JSON.stringify({status_code: 20000, tasks}))});
    await assert.rejects(adapter.checkAccess(), error => error.code === 'dataforseo_access_denied' && error.effect === 'not_delivered');
  }
});
