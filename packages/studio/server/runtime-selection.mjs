import {CodexRuntime} from './codex-runtime.mjs';
import {ClaudeRuntime} from './claude-runtime.mjs';

const ENGINES = new Set(['codex', 'claude']);
const engineOf = selection => typeof selection === 'string' ? selection : selection?.engine || selection?.runtimeKind || 'codex';

/** Selects only NEW jobs. Existing native IDs are always routed by their original job. */
export class RuntimeSelection {
  constructor({codexRuntime = new CodexRuntime(), claudeRuntime = new ClaudeRuntime(), getSelection = () => ({engine: 'codex'}), getJob,
    researchAccess, researchRequest, speechAccess, speechRequest} = {}) {
    this.runtimes = {codex: codexRuntime, claude: claudeRuntime};
    this.getSelection = getSelection; this.getJob = getJob; this.bindings = new Map();
    this.helpers = {researchAccess, researchRequest, speechAccess, speechRequest};
    this.runtimeKind = 'selectable'; this.closed = false;
  }

  async selection() {
    if (this.closed) throw new Error('Studio runtime is closed');
    const engine = engineOf(await this.getSelection());
    if (!ENGINES.has(engine)) throw new Error('Selected AI engine is unsupported; no provider fallback is allowed');
    return {engine, runtime: this.runtimes[engine]};
  }

  async catalog() {
    const {engine, runtime} = await this.selection();
    const catalog = await runtime.catalog();
    return {...catalog, engine, runtimeKind: engine, availability: catalog.availability || {installed: true, authenticated: true, available: true}};
  }

  async check() {
    const {engine, runtime} = await this.selection();
    const result = typeof runtime.check === 'function' ? await runtime.check() : await runtime.catalog();
    return {...result, engine, runtimeKind: engine, availability: result.availability || {installed: true, authenticated: true, available: true}};
  }

  bind(threadId, binding) {
    if (typeof threadId !== 'string' || !threadId) throw new Error('The native runtime returned no session identity');
    const previous = this.bindings.get(threadId);
    if (previous && (previous.engine !== binding.engine || previous.cwd !== binding.cwd)) throw new Error('Native session identity is already bound to another engine or job directory');
    this.bindings.set(threadId, {...previous, ...binding});
  }

  async start(options) {
    const {engine, runtime} = await this.selection();
    if (options.engine && options.engine !== engine || options.runtimeKind && options.runtimeKind !== engine) throw new Error('The job engine differs from the selected engine; reconcile it instead of relaunching');
    const onEvent = async event => {
      const threadId = event.params?.threadId;
      if (event.method === 'reel/thread-ready') this.bind(threadId, {engine, cwd: options.cwd});
      await options.onEvent?.({...event, params: {...event.params, engine, runtimeKind: engine}});
    };
    const started = await runtime.start({...options, onEvent});
    this.bind(started.threadId, {engine, cwd: options.cwd});
    return {...started, engine, runtimeKind: engine};
  }

  async original(threadId, options = {}) {
    if (this.closed) throw new Error('Studio runtime is closed');
    let binding = this.bindings.get(threadId);
    if (!binding && this.getJob) {
      const job = await this.getJob(threadId);
      if (job) {
        if (job.threadId && job.threadId !== threadId || job.executorThreadId && job.executorThreadId !== threadId) throw new Error('The saved job does not match the requested native session');
        // Jobs written before engine selection existed are native Codex jobs.
        binding = {engine: job.engine || job.runtimeKind || 'codex', cwd: job.dir || job.cwd, computeTarget: job.computeTarget};
        if (!ENGINES.has(binding.engine)) throw new Error('The original job engine is unsupported');
        this.bind(threadId, binding);
      }
    }
    if (!binding) throw new Error('The original job engine is unknown; recover its saved job identity before reconcile/cancel/resume');
    if (options?.engine && options.engine !== binding.engine) throw new Error('An existing job cannot switch AI engines');
    if (options?.cwd && options.cwd !== binding.cwd) throw new Error('An existing job cannot switch its owned directory');
    return {...binding, runtime: this.runtimes[binding.engine]};
  }

  async reconcile(threadId, options = {}) {
    const original = await this.original(threadId, options);
    const result = await original.runtime.reconcile(threadId, original.engine === 'claude' ? {cwd: original.cwd} : options);
    return {...result, engine: original.engine, runtimeKind: original.engine};
  }

  async cancel(threadId, turnId, options = {}) {
    const original = await this.original(threadId, options);
    return original.runtime.cancel(threadId, turnId, original.engine === 'claude' ? {cwd: original.cwd} : options);
  }

  async watch(threadId, onEvent) {
    const original = await this.original(threadId);
    if (typeof original.runtime.watch !== 'function') throw new Error(`${original.engine} runtime does not support live event attachment; use read-only reconcile`);
    return original.runtime.watch(threadId, onEvent);
  }

  async steer(threadId, options = {}) {
    const original = await this.original(threadId, options);
    if (typeof original.runtime.steer !== 'function') throw new Error(`${original.engine} runtime does not support steering through this adapter`);
    return original.runtime.steer(threadId, {...options, cwd: original.cwd});
  }

  async helper(name, ...args) {
    if (typeof this.helpers[name] === 'function') return this.helpers[name](...args);
    const {engine, runtime} = await this.selection();
    if (engine === 'claude') throw new Error(`${name} requires an independently configured connection in Claude mode; it will not start a hidden Codex subscription session`);
    if (typeof runtime[name] !== 'function') throw new Error(`${name} is unsupported by the configured runtime`);
    return runtime[name](...args);
  }
  researchAccess(...args) { return this.helper('researchAccess', ...args); }
  researchRequest(...args) { return this.helper('researchRequest', ...args); }
  speechAccess(...args) { return this.helper('speechAccess', ...args); }
  speechRequest(...args) { return this.helper('speechRequest', ...args); }

  async close() {
    if (this.closed) return; this.closed = true;
    const results = await Promise.allSettled(Object.values(this.runtimes).map(runtime => runtime.close()));
    this.bindings.clear();
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  }
}
