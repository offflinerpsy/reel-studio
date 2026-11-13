import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {supportedManagedPair} from './owner-authority.mjs';

function defaultBinary() {
  const installed = join(homedir(), '.local', 'bin', 'codex');
  return process.env.CODEX_BIN || (existsSync(installed) ? installed : 'codex');
}
// GPT work uses the same existing ChatGPT account through its native provider.
// A machine-wide Responses proxy need not implement the native image endpoint.
// This applies only to newly created Studio contexts, never existing chats.
const nativeProvider=model=>/^gpt-\d/.test(model)?'openai':undefined;
function executionRoute(execution,model,effort){
 if(execution&&(execution.provider!=='openai'||!supportedManagedPair(execution)||execution.permissionMode!=='full-access'||execution.serviceTier!=='standard'||execution.model!==model||execution.effort!==effort))throw new Error('The verified managed execution route does not match this native request.');
}

/** Version-specific local Codex app-server adapter. Never reads auth files. */
export class CodexRuntime {
  constructor({ spawnImpl = spawn, binary = defaultBinary(), timeoutMs = 30000 } = {}) {
    this.spawnImpl = spawnImpl;
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.listeners = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.closed = false;
  }

  async connect() {
    if (this.closed) throw new Error('Codex runtime is closed');
    if (this.connecting) return this.connecting;
    this.connecting = this.initialize();
    return this.connecting;
  }

  async initialize() {
    this.child = this.spawnImpl(this.binary, ['app-server', '--stdio'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.consume(chunk));
    this.child.stdout.on('error', () => this.fail(new Error('Codex protocol output failed')));
    this.child.stdout.on('end', () => this.fail(new Error('Codex protocol stream ended')));
    this.child.stdin.on('error', () => this.fail(new Error('Codex protocol input failed')));
    // Drain stderr without retaining or forwarding possible sensitive diagnostics.
    this.child.stderr.on('data', () => {});
    this.child.stderr.on('error', () => {});
    this.child.on('error', () => this.fail(new Error('Could not start Codex app-server')));
    this.child.on('exit', () => this.fail(new Error('Codex app-server exited')));
    await this.request('initialize', {
      clientInfo: { name: 'reel-studio', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.send({ method: 'initialized' });
  }

  send(message) {
    if (this.closed || this.failure) throw this.failure || new Error('Codex runtime is closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = this.timeoutMs) {
    if (this.failure || this.closed) return Promise.reject(this.failure || new Error('Codex runtime is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out; reconcile before retrying`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) return this.fail(new Error('Codex protocol frame exceeded limit'));
    for (;;) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) return;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { this.fail(new Error('Invalid Codex protocol JSON')); return; }
      if (message.method && message.id !== undefined) {
        // No implicit approval, dynamic-tool execution, or elicitation handling.
        try { this.send({ id: message.id, error: { code: -32601, message: 'Client requests are not supported by Reel Studio' } }); }
        catch { /* failure already recorded */ }
        continue;
      }
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (!waiter) continue;
        clearTimeout(waiter.timer);
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`Codex ${waiter.method} rejected (${message.error.code ?? 'unknown'})`));
        else waiter.resolve(message.result);
        continue;
      }
      if (message.method) {
        const threadId = message.params?.threadId || message.params?.thread?.id;
        const callbacks = threadId ? [this.listeners.get(threadId)] : [...this.listeners.values()];
        for (const callback of callbacks) {
          try { callback?.(message); } catch { /* UI callbacks cannot break protocol parsing */ }
        }
      }
    }
  }

  fail(error) {
    if (this.failure || this.closed) return;
    this.failure = error;
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
    for (const callback of this.listeners.values()) {
      try { callback({ method: 'error', params: { error: { message: error.message }, transportLost: true } }); } catch {}
    }
    this.child?.kill();
  }

  async catalog() {
    await this.connect();
    const accountResult = await this.request('account/read', { refreshToken: false });
    const account = accountResult?.account;
    if (account?.type !== 'chatgpt') throw new Error('ChatGPT subscription authentication is required');
    const models = [];
    let cursor;
    const seen = new Set();
    do {
      const result = await this.request('model/list', { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data)) throw new Error('Invalid Codex model catalog');
      for (const model of result.data) {
        if (model.hidden) continue;
        models.push({ id: model.model, displayName: model.displayName, reasoningEfforts: (model.supportedReasoningEfforts || []).map(option => option.reasoningEffort), defaultReasoningEffort: model.defaultReasoningEffort });
      }
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Codex model catalog pagination repeated');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return { models, account: { type: account.type, planType: account.planType }, verifiedAt: new Date().toISOString() };
  }

  async researchContext({ cwd, model, effort, execution }) {
    executionRoute(execution,model,effort);
    await this.connect();
    const key = JSON.stringify({ cwd, model, effort });
    if (this.researchKey === key && this.researchThread) return this.researchThread;
    const modelProvider=nativeProvider(model);
    const result = await this.request('thread/start', {
      model, ...(modelProvider?{modelProvider}:{}), cwd, approvalPolicy: 'never', sandbox: 'danger-full-access',
      ephemeral: true, allowProviderModelFallback: false,
      config: { model_reasoning_effort: effort },
    });
    if (!result.thread?.id || result.model !== model || result.cwd !== cwd ||
        result.reasoningEffort !== effort || result.approvalPolicy !== 'never' ||
        result.sandbox?.type !== 'dangerFullAccess' || modelProvider&&result.modelProvider!==modelProvider) {
      throw new Error('Research tool context did not preserve the selected model and Full access');
    }
    const inventory = await this.request('mcpServerStatus/list', {
      serverName: 'codex_apps', threadId: result.thread.id,
      detail: 'toolsAndAuthOnly', limit: 10,
    });
    const provider = inventory.data?.find(s => s.name === 'codex_apps');
    if (!provider?.tools?.['dataforseo.api_request']) {
      throw new Error('Connect the DataForSEO app in Codex before researching publication copy');
    }
    this.researchKey = key;
    this.researchThread = result.thread.id;
    return this.researchThread;
  }

  async researchAccess(options) {
    const threadId = await this.researchContext(options);
    const result = await this.request('mcpServer/tool/call', {
      threadId, server: 'codex_apps', tool: 'dataforseo.docs_search',
      arguments: { url: 'serp/youtube/organic/live/advanced', needCodeExample: false },
    });
    if (result.isError || !result.content?.some(c => c.type === 'text' && c.text.includes('YouTube Organic'))) {
      throw new Error('DataForSEO did not confirm access; no paid requests were sent');
    }
    return { status: 'verified', route: 'connected_codex_app', verifiedAt: new Date().toISOString() };
  }

  async researchRequest(arguments_, options) {
    const threadId = await this.researchContext(options);
    // Uses the existing app grant; no credentials are read, copied or retained.
    return this.request('mcpServer/tool/call', {
      threadId, server: 'codex_apps', tool: 'dataforseo.api_request', arguments: arguments_,
    }, 90000);
  }

  async start({ cwd, prompt, model, effort, onEvent, execution }) {
    executionRoute(execution,model,effort);
    if (typeof cwd !== 'string' || !cwd.startsWith('/') || typeof prompt !== 'string' || !prompt.trim()) throw new Error('Absolute cwd and nonempty prompt are required');
    const catalog = await this.catalog();
    const selected = catalog.models.find(entry => entry.id === model);
    if (!selected || !selected.reasoningEfforts.includes(effort)) throw new Error('Selected Codex model or reasoning effort is unavailable');
    const modelProvider=nativeProvider(model);
    const result = await this.request('thread/start', {
      model, ...(modelProvider?{modelProvider}:{}), cwd, approvalPolicy: 'never', sandbox: 'danger-full-access',
      allowProviderModelFallback: false, config: { model_reasoning_effort: effort },
    });
    const threadId = result?.thread?.id;
    if (!threadId || execution&&threadId===execution.nativeThreadId || result.model !== model || result.cwd !== cwd || result.reasoningEffort !== effort || result.approvalPolicy !== 'never' || result.sandbox?.type !== 'dangerFullAccess' || modelProvider&&result.modelProvider!==modelProvider) {
      const error = new Error('Codex effective model, effort, workspace, or Full access readback did not match; no turn started');
      if (typeof threadId === 'string') error.threadId = threadId;
      throw error;
    }
    this.listeners.set(threadId, onEvent);
    // Await persistence before any possibly delivered model turn.
    await onEvent?.({ method: 'reel/thread-ready', params: { threadId, model, modelProvider:result.modelProvider, effort, cwd, permissions: { approvalPolicy: result.approvalPolicy, sandbox: result.sandbox } } });
    const started = await this.request('turn/start', {
      threadId, model, effort, approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' },
      serviceTierForTurn: 'default', input: [{ type: 'text', text: prompt, text_elements: [] }],
    });
    const turnId = started?.turn?.id;
    if (!turnId) throw new Error('Codex turn start returned no ID; reconcile thread before retrying');
    return { threadId, turnId, modelProvider:result.modelProvider, permissions: { approvalPolicy: result.approvalPolicy, sandbox: result.sandbox } };
  }

  async cancel(threadId, turnId) {
    await this.connect();
    if (!threadId || !turnId) throw new Error('Thread and turn IDs are required to cancel');
    return this.request('turn/interrupt', { threadId, turnId });
  }

  async reconcile(threadId) {
    await this.connect();
    if (typeof threadId !== 'string' || !threadId) throw new Error('Thread ID is required to reconcile');
    const read = await this.request('thread/read', { threadId, includeTurns: false });
    if (read?.thread?.id !== threadId) throw new Error('Codex reconciliation returned a different thread');
    const page = await this.request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' });
    if (!Array.isArray(page?.data)) throw new Error('Invalid Codex turn reconciliation response');
    const thread = read.thread;
    const turn = page.data[0];
    return {
      threadId, status: thread.status, model: thread.model, modelProvider:thread.modelProvider, effort: thread.reasoningEffort,
      latestTurn: turn ? { id: turn.id, status: turn.status, error: turn.error ? { message: 'Codex turn failed or was interrupted' } : null, startedAt: turn.startedAt, completedAt: turn.completedAt } : null,
      verifiedAt: new Date().toISOString(),
    };
  }

  watch(threadId, onEvent) {
    // Only threads started on this connection are subscribed by app-server.
    // No independent subscribe RPC exists in this CLI version. Never resume to attach.
    if (!this.listeners.has(threadId)) throw new Error('Thread is not subscribed on this runtime; use read-only reconcile');
    if (typeof onEvent !== 'function') throw new Error('Event callback is required');
    this.listeners.set(threadId, onEvent);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Codex runtime closed')); }
    this.pending.clear();
    this.listeners.clear();
    if (!this.child || this.child.exitCode != null) return;
    const exited = new Promise(resolve => this.child.once('exit', resolve));
    this.child.kill();
    let timer;
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 2000); })]);
    clearTimeout(timer);
  }
}
