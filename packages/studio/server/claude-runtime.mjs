import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, realpath, rename, stat, unlink} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

const RECEIPT = '.reel-claude-runtime.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['completed', 'failed', 'interrupted']);
const MODELS = [
  {id: 'sonnet', displayName: 'Claude Sonnet (official CLI alias)', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'high'},
  {id: 'opus', displayName: 'Claude Opus (official CLI alias)', reasoningEfforts: ['low', 'medium', 'high', 'max'], defaultReasoningEffort: 'high'},
];
const API_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'];
const PROVIDER_ENV = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const permissions = () => ({approvalPolicy: 'never', sandbox: {type: 'dangerFullAccess'}, nativePermissionMode: 'bypassPermissions'});
const now = () => new Date().toISOString();

/** Own-account subscription adapter for the unmodified official Claude Code CLI.
 * No OAuth tokens, credential files, API clients, implicit resumes or provider fallback.
 */
export class ClaudeRuntime {
  constructor({spawnImpl = spawn, binary = process.env.CLAUDE_BIN || 'claude', env = process.env, timeoutMs = 30000, killTimeoutMs = 2000} = {}) {
    this.spawnImpl = spawnImpl; this.binary = binary; this.env = env;
    this.timeoutMs = timeoutMs; this.killTimeoutMs = killTimeoutMs;
    this.jobs = new Map(); this.closed = false;
  }

  subscriptionEnvironment() {
    if (API_ENV.some(key => this.env[key]) || PROVIDER_ENV.some(key => this.env[key] && !['0', 'false'].includes(this.env[key]))) {
      throw new Error('Claude subscription mode cannot use API keys, injected OAuth tokens, custom endpoints or third-party providers. Use the official Claude Code sign-in on this host.');
    }
    return {...this.env};
  }

  async command(args) {
    if (this.closed) throw new Error('Claude runtime is closed');
    const env = this.subscriptionEnvironment();
    return new Promise((resolve, reject) => {
      let child, output = '', settled = false;
      const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { child?.kill(); done(new Error('Claude CLI readiness check timed out')); }, this.timeoutMs);
      try { child = this.spawnImpl(this.binary, args, {env, shell: false, stdio: ['ignore', 'pipe', 'pipe']}); }
      catch { done(new Error('Could not start the official Claude Code CLI')); return; }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 128 * 1024) { child.kill(); done(new Error('Claude CLI readiness output exceeded limit')); } });
      child.stdout.on('error', () => done(new Error('Claude CLI readiness output failed')));
      child.stderr.on('data', () => {}); child.stderr.on('error', () => {});
      child.on('error', () => done(new Error('Could not start the official Claude Code CLI')));
      // auth status exits 1 when signed out; its JSON remains useful readiness evidence.
      child.on('close', code => done(null, {code, output}));
    });
  }

  async catalog() {
    const [help, version, status] = await Promise.all([this.command(['--help']), this.command(['--version']), this.command(['--setting-sources', '', 'auth', 'status', '--json'])]);
    if (help.code !== 0 || version.code !== 0 || !/Claude Code/.test(help.output) || !/Claude Code/.test(version.output)) throw new Error('The installed executable did not identify itself as official Claude Code');
    for (const flag of ['--print', '--output-format', '--verbose', '--effort', '--model', '--session-id', '--resume', '--permission-mode', '--setting-sources']) {
      if (!help.output.includes(flag)) throw new Error(`The installed Claude CLI lacks required capability ${flag}`);
    }
    if (!help.output.includes('stream-json') || !help.output.includes('bypassPermissions')) throw new Error('The installed Claude CLI lacks the required streaming or permission mode');
    let auth;
    try { auth = JSON.parse(status.output); } catch { throw new Error('Claude auth status returned invalid JSON'); }
    const authenticated = status.code === 0 && auth.loggedIn === true && auth.authMethod === 'claude.ai' && auth.apiProvider === 'firstParty';
    const account = {type: 'claude-subscription', loggedIn: auth.loggedIn === true, authMethod: typeof auth.authMethod === 'string' ? auth.authMethod : 'unknown', apiProvider: typeof auth.apiProvider === 'string' ? auth.apiProvider : 'unknown', ...(typeof auth.subscriptionType === 'string' ? {subscriptionType: auth.subscriptionType} : {})};
    return {engine: 'claude', runtimeKind: 'claude', models: authenticated ? MODELS.map(model => ({...model, reasoningEfforts: [...model.reasoningEfforts], availability: 'unverified-until-run'})) : [], account,
      availability: {installed: true, authenticated, available: authenticated, reason: authenticated ? null : 'Sign in to the official Claude Code CLI with your own Claude subscription on this host.'},
      version: version.output.trim().slice(0, 100), catalogSource: 'official-cli-aliases', modelAvailability: 'unverified-until-run', verifiedAt: now()};
  }

  async check() { return this.catalog(); }

  async directory(cwd) {
    if (typeof cwd !== 'string' || !isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('An existing absolute owned job directory is required');
    return realpath(cwd);
  }

  async save(job) {
    // Each CLI process has one serialized writer; atomic replacement never stores prompts/output/tokens.
    job.receipt.updatedAt = now();
    const receipt = {...job.receipt};
    const temporary = `${job.file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, job.file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }

  async load(threadId, cwd) {
    if (!UUID.test(threadId || '')) throw new Error('A native Claude session UUID is required');
    const existing = this.jobs.get(threadId);
    if (existing) return existing;
    if (!cwd) throw new Error('Claude reconciliation needs the original owned job directory; it never resumes a session to inspect it');
    const directory = await this.directory(cwd), file = join(directory, RECEIPT);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let receipt;
    try { if ((await handle.stat()).size > 32768) throw new Error('Claude receipt exceeded limit'); receipt = JSON.parse(await handle.readFile('utf8')); }
    finally { await handle.close(); }
    if (receipt.schema !== 'reel-claude-job/v1' || receipt.engine !== 'claude' || receipt.threadId !== threadId || receipt.cwd !== directory || !UUID.test(receipt.turnId || '')) throw new Error('Claude job receipt does not match the original session and directory');
    const job = {file, receipt, chain: Promise.resolve(), child: null};
    this.jobs.set(threadId, job);
    return job;
  }

  validate(options) {
    if (this.closed) throw new Error('Claude runtime is closed');
    if (options.execution) throw new Error('This admitted managed execution route cannot be changed to Claude');
    if (typeof options.prompt !== 'string' || !options.prompt.trim()) throw new Error('A nonempty prompt is required');
    const selected = MODELS.find(model => model.id === options.model);
    if (!selected || !selected.reasoningEfforts.includes(options.effort)) throw new Error('Selected Claude model alias or reasoning effort is unavailable');
  }

  async start(options) {
    this.validate(options);
    const catalog = await this.catalog();
    if (!catalog.availability.available) throw new Error(catalog.availability.reason);
    const cwd = await this.directory(options.cwd), file = join(cwd, RECEIPT);
    const receipt = {schema: 'reel-claude-job/v1', engine: 'claude', runtimeKind: 'claude', cwd, threadId: randomUUID(), nativeSessionId: null, turnId: randomUUID(), model: options.model, effort: options.effort, status: 'starting', effect: 'not_delivered', startedAt: now(), permissions: permissions()};
    // Reservation is durable before spawning; a second start in this job directory is forbidden.
    let handle;
    try { handle = await open(file, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Claude job already has an execution receipt; reconcile the original job before any explicit resume'); throw error; }
    try { await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); } finally { await handle.close(); }
    const job = {file, receipt, chain: Promise.resolve(), child: null, onEvent: options.onEvent};
    this.jobs.set(receipt.threadId, job);
    return this.launch(job, options.prompt, false);
  }

  async launch(job, prompt, resume) {
    const r = job.receipt;
    // Await application persistence of engine and session identity before the effect boundary.
    await job.onEvent?.({method: 'reel/thread-ready', params: {threadId: r.threadId, turnId: r.turnId, nativeSessionId: r.threadId, engine: 'claude', runtimeKind: 'claude', model: r.model, modelProvider: 'anthropic', effort: r.effort, cwd: r.cwd, permissions: permissions()}});
    r.effect = 'possibly_delivered'; await this.save(job);
    // Ignore project/user settings for this invocation: they can inject API-key helpers,
    // endpoints, paid-provider env or hooks. Official subscription sign-in is independent.
    const args = ['--setting-sources', '', '--print', '--output-format', 'stream-json', '--verbose', '--model', r.model, '--effort', r.effort, '--permission-mode', 'bypassPermissions', ...(resume ? ['--resume', r.threadId] : ['--session-id', r.threadId])];
    let child;
    try { child = this.spawnImpl(this.binary, args, {cwd: r.cwd, env: this.subscriptionEnvironment(), shell: false, stdio: ['pipe', 'pipe', 'pipe']}); }
    catch { r.status = 'failed'; r.effect = 'not_delivered'; await this.save(job); throw Object.assign(new Error('Could not start official Claude Code; the reserved job was not delivered'), {threadId: r.threadId}); }
    job.child = child; job.buffer = ''; job.resultSeen = false; job.cancelRequested = false; job.protocolFailure = false; job.initialized = false;
    let resolveStart, rejectStart, startSettled = false;
    const started = new Promise((resolve, reject) => { resolveStart = value => { if (!startSettled) { startSettled = true; clearTimeout(timer); resolve(value); } }; rejectStart = error => { if (!startSettled) { startSettled = true; clearTimeout(timer); reject(Object.assign(error, {threadId: r.threadId})); } }; });
    const timer = setTimeout(() => { job.protocolFailure = true; this.enqueue(job, async () => { r.status = 'uncertain'; await this.save(job); await job.onEvent?.({method: 'error', params: {threadId: r.threadId, transportLost: true, error: {message: 'Claude initialization timed out; reconcile the original job before retrying'}}}); }); rejectStart(new Error('Claude initialization timed out; reconcile the original job before retrying')); child.kill(); }, this.timeoutMs);
    const fail = message => {
      if (job.protocolFailure || job.resultSeen) return;
      job.protocolFailure = true; child.kill();
      this.enqueue(job, async () => { r.status = 'uncertain'; await this.save(job); await job.onEvent?.({method: 'error', params: {threadId: r.threadId, transportLost: true, error: {message}}}); rejectStart(new Error(message)); });
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      job.buffer += chunk;
      if (job.buffer.length > 8 * 1024 * 1024) return fail('Claude protocol frame exceeded limit; reconcile before retrying');
      for (;;) {
        const end = job.buffer.indexOf('\n'); if (end < 0) break;
        const line = job.buffer.slice(0, end); job.buffer = job.buffer.slice(end + 1); if (!line.trim()) continue;
        let event; try { event = JSON.parse(line); } catch { fail('Invalid Claude protocol JSON; reconcile before retrying'); break; }
        this.enqueue(job, async () => {
          if (job.protocolFailure || job.resultSeen) return;
          if (event.session_id && event.session_id !== r.threadId) return fail('Claude returned a different native session; reconcile before retrying');
          if (event.type === 'system' && event.subtype === 'init') {
            if (event.session_id !== r.threadId || event.permissionMode !== 'bypassPermissions' || typeof event.model !== 'string' || !new RegExp(`(^|-)${r.model}(-|$)`).test(event.model)) return fail('Claude effective session, model family or permission readback did not match; reconcile before retrying');
            job.initialized = true;
            r.nativeSessionId = event.session_id; r.nativeModel = event.model; r.status = 'running'; r.effect = 'delivered_unverified'; await this.save(job);
            resolveStart(this.started(job));
          } else if (event.type === 'assistant') {
            for (const content of event.message?.content || []) if (content.type === 'tool_use') await job.onEvent?.({method: 'item/started', params: {threadId: r.threadId, item: {id: content.id, type: content.name === 'Bash' ? 'commandExecution' : 'mcpToolCall'}}});
          } else if (event.type === 'result') {
            if (!job.initialized) return fail('Claude completed without a verified initialization receipt; reconcile before retrying');
            job.resultSeen = true;
            r.status = event.subtype === 'success' && event.is_error !== true ? 'completed' : 'failed';
            r.nativeTurnId = typeof event.uuid === 'string' ? event.uuid : null; r.completedAt = now(); r.effect = 'independently_verified';
            await this.save(job);
            await job.onEvent?.({method: 'turn/completed', params: {threadId: r.threadId, engine: 'claude', nativeSessionId: r.nativeSessionId, nativeTurnId: r.nativeTurnId, nativeModel: r.nativeModel, turn: {id: r.turnId, status: r.status, ...(r.status === 'failed' ? {error: {message: 'Claude execution failed; inspect the original CLI session'}} : {})}}});
          }
        }, fail);
      }
    });
    child.stdout.on('error', () => fail('Claude protocol output failed; reconcile before retrying'));
    child.stdin.on('error', () => fail('Claude protocol input failed; reconcile before retrying'));
    child.stderr.on('data', () => {}); child.stderr.on('error', () => {});
    child.on('error', () => fail('Could not start Claude Code; reconcile the reserved job before retrying'));
    child.on('close', (code, signal) => {
      job.child = null;
      this.enqueue(job, async () => {
        if (job.resultSeen || job.protocolFailure) return;
        if (job.cancelRequested && (signal || code !== 0)) {
          r.status = 'interrupted'; r.completedAt = now(); r.effect = 'delivered_unverified'; await this.save(job);
          await job.onEvent?.({method: 'turn/completed', params: {threadId: r.threadId, turn: {id: r.turnId, status: 'interrupted'}}});
          rejectStart(new Error('Claude job was interrupted before initialization'));
        } else {
          r.status = 'uncertain'; await this.save(job);
          await job.onEvent?.({method: 'error', params: {threadId: r.threadId, transportLost: true, error: {message: 'Claude exited without a final result; reconcile before retrying'}}});
          rejectStart(new Error('Claude exited without a final result; reconcile before retrying'));
        }
      }, fail);
    });
    child.stdin.end(prompt);
    return started;
  }

  enqueue(job, action, fail) {
    job.chain = job.chain.then(action).catch(error => { if (fail) fail('Claude event persistence failed; reconcile before retrying'); else job.lastError = error; });
    return job.chain;
  }

  started(job) {
    const r = job.receipt;
    return {threadId: r.threadId, turnId: r.turnId, engine: 'claude', runtimeKind: 'claude', nativeSessionId: r.nativeSessionId, nativeModel: r.nativeModel, modelProvider: 'anthropic', permissions: permissions()};
  }

  async cancel(threadId, turnId, options = {}) {
    const job = await this.load(threadId, options?.cwd);
    if (job.receipt.turnId !== turnId) throw new Error('Claude cancellation must target the exact original turn');
    if (!job.child) throw new Error('The original Claude process is not attached; reconcile it without starting another process');
    job.cancelRequested = true;
    if (!job.child.kill('SIGINT')) throw new Error('Could not signal the original Claude process');
    return {threadId, turnId, status: 'cancel_requested', engine: 'claude'};
  }

  async reconcile(threadId, options = {}) {
    const job = await this.load(threadId, options?.cwd); await job.chain;
    const r = job.receipt, attached = Boolean(job.child);
    const status = TERMINAL.has(r.status) ? r.status : attached ? r.status : 'uncertain';
    return {threadId, engine: 'claude', runtimeKind: 'claude', nativeSessionId: r.nativeSessionId, nativeTurnId: r.nativeTurnId || null, model: r.model, nativeModel: r.nativeModel || null, modelProvider: 'anthropic', effort: r.effort, status: {type: status}, latestTurn: {id: r.turnId, status, startedAt: r.startedAt, completedAt: r.completedAt || null, error: status === 'failed' ? {message: 'Claude execution failed'} : null}, effect: r.effect, readOnly: true, evidence: 'owned-local-cli-receipt', attached, verifiedAt: now()};
  }

  watch(threadId, onEvent) {
    const job = this.jobs.get(threadId);
    if (!job?.child) throw new Error('Claude session is not attached; use read-only reconcile');
    if (typeof onEvent !== 'function') throw new Error('Event callback is required');
    job.onEvent = onEvent;
  }

  async steer(threadId, options = {}) {
    const job = await this.load(threadId, options.cwd); await job.chain;
    if (job.child || job.resuming || !TERMINAL.has(job.receipt.status)) throw new Error('Claude cannot steer an active or uncertain print-mode session; reconcile/cancel the exact job first');
    this.validate({...options, model: options.model || job.receipt.model, effort: options.effort || job.receipt.effort});
    if (options.model && options.model !== job.receipt.model || options.effort && options.effort !== job.receipt.effort) throw new Error('An existing Claude session retains its original model and effort');
    job.resuming = true;
    try {
      const catalog = await this.catalog(); if (!catalog.availability.available) throw new Error(catalog.availability.reason);
      job.receipt.previousTurnId = job.receipt.turnId; job.receipt.turnId = randomUUID(); job.receipt.status = 'starting'; job.receipt.effect = 'not_delivered'; delete job.receipt.completedAt; delete job.receipt.nativeTurnId;
      job.onEvent = options.onEvent || job.onEvent; await this.save(job);
      return await this.launch(job, options.prompt, true);
    } finally { job.resuming = false; }
  }

  async close() {
    if (this.closed) return; this.closed = true;
    await Promise.all([...this.jobs.values()].map(async job => {
      if (!job.child) return;
      // Server shutdown is transport loss, never proof that the model turn completed.
      job.protocolFailure = true; await job.chain;
      if (!TERMINAL.has(job.receipt.status)) job.receipt.status = 'uncertain';
      await this.save(job);
      const child = job.child; let timer;
      await new Promise(resolve => { child.once('close', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, this.killTimeoutMs); });
    }));
  }
}
