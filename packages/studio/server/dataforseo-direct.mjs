// Credentials and transport live here; ResearchService owns all paid-operation
// admission, receipts, cache, cost limits and uncertain-effect reconciliation.
const BASE = 'https://api.dataforseo.com';
const POST_PATHS = new Set([
  '/v3/keywords_data/google_trends/explore/live',
  '/v3/serp/youtube/organic/live/advanced',
]);
const ACCESS_PATH = '/v3/appendix/user_data';
const MAX_RESPONSE = 4 * 1024 * 1024;

function failure(code, { status, method, taskIds = [] } = {}) {
  const error = new Error(`DataForSEO ${code}${status ? ` (${status})` : ''}; ${method === 'POST' ? 'reconcile the saved research receipt before retrying' : 'check the saved connection'}`);
  error.code = `dataforseo_${code}`;
  if (status) error.status = status;
  error.taskIds = taskIds;
  error.effect = method === 'POST' ? 'possibly_delivered' : 'not_delivered';
  return error;
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) throw new Error('oversized');
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE) { await reader.cancel(); throw new Error('oversized'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function taskIds(body, secrets = []) {
  return (Array.isArray(body?.tasks) ? body.tasks : []).slice(0, 10)
    .map(task => task?.id).filter(id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id) && !secrets.some(secret => id.includes(secret)));
}
function sanitize(value, secrets) {
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), value);
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:password|authorization|login|token|api_key|key)$/i.test(key)).map(([key, item]) => [key, sanitize(item, secrets)]));
}

export function createDataForSeoDirect({ getCredentials, fetchImpl = fetch } = {}) {
  if (typeof getCredentials !== 'function') throw new TypeError('getCredentials is required');
  async function request({ method = 'POST', path, data } = {}, options = {}) {
    if (!(method === 'POST' && POST_PATHS.has(path) || method === 'GET' && path === ACCESS_PATH)) throw new TypeError('Unsupported DataForSEO endpoint or method');
    let body;
    if (method === 'POST') {
      if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object' || Array.isArray(data[0])) throw new TypeError('Exactly one DataForSEO research task is required');
      body = JSON.stringify(data);
      if (Buffer.byteLength(body) > 32 * 1024) throw new TypeError('DataForSEO research request is too large');
    } else if (data !== undefined) throw new TypeError('DataForSEO access check cannot carry task data');
    let credentials;
    try { credentials = await getCredentials('dataforseo'); } catch { throw failure('not_configured'); }
    if (typeof credentials?.login !== 'string' || !credentials.login.trim() || /[:\r\n]/.test(credentials.login) || typeof credentials?.password !== 'string' || !credentials.password || /[\r\n]/.test(credentials.password)) throw failure('not_configured');
    let response;
    try {
      response = await fetchImpl(`${BASE}${path}`, {
        method, redirect: 'error', signal: options.signal || AbortSignal.timeout(30000),
        headers: { Authorization: `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body === undefined ? {} : { body }),
      });
    } catch { throw failure('transport_failed', { method }); }
    let result;
    try { result = await boundedJson(response); }
    catch { throw failure('invalid_response', { method, status: response.status }); }
    const secrets = [credentials.password, credentials.login, Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64')];
    const ids = taskIds(result, secrets);
    if (!response.ok) throw failure('http_failed', { method, status: response.status, taskIds: ids });
    if (result?.status_code !== 20000 || !Array.isArray(result.tasks)) throw failure('provider_failed', { method, taskIds: ids });
    // Provider messages can echo credentials or arbitrary upstream details.
    // Keep the documented receipt/data fields needed by the owning service.
    return { status_code: result.status_code, cost: result.cost, tasks: result.tasks.map(task => ({
      id: ids.includes(task?.id) ? task.id : null,
      status_code: task?.status_code, cost: task?.cost, data: sanitize(task?.data, secrets), result: sanitize(task?.result, secrets),
    })) };
  }
  return {
    request,
    async checkAccess(options = {}) {
      const result = await request({ method: 'GET', path: ACCESS_PATH }, options);
      if (result.tasks.length !== 1 || result.tasks[0].status_code !== 20000) throw failure('access_denied');
      return { status: 'verified', provider: 'DataForSEO', route: 'direct', configured: true };
    },
  };
}
