// Desktop controller: sole owner of projects, sessions, runs, queue, leases,
// approvals and policy. The UI and the tray reach it only through invoke();
// sandboxed workers reach it only through their own request channel and can
// ask for approvals, never resolve them (D0 contracts §3–§9).
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, mkdirSync, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { callModel } from '../../src/providers.mjs';
import { loadConfig, saveConfig, resolveModel, allProviders } from '../../src/config.mjs';
import { localInventory, KNOWN_RUNTIMES, bestLocalModel, runtimeProvider } from '../../src/local-inventory.mjs';
import { createMemoryProbe } from '../../src/local-memory.mjs';
import { isLocalProvider, discoverLocalModels, describeLocalModel, localSetupHint } from '../../src/local-models.mjs';
import { loadCommands, expandCommand } from '../../src/commands.mjs';
import { savePlan, latestPlan } from '../../src/plans.mjs';
import { isReadOnlyCommand, normalizeCommand } from '../../src/permissions.mjs';
import { saveSession, loadSession, sessionsDir, newSessionId } from '../../src/session.mjs';
import { Approvals, Redactor, Semaphore, atomicJSON, fail, hash, loadJSON, workspacePath } from './primitives.mjs';
import { unifiedDiff } from './diff.mjs';
import * as G from './git.mjs';
import { createFinance } from './finance.mjs';
import { loadSats, findSat } from '../../src/sats.mjs';
import { satWorkspace, satHistory, recordSatRun } from '../../src/sat-workspace.mjs';
import { satEvents } from '../../src/sat-events.mjs';

export const MODES = ['manual', 'assisted', 'unattended'];
const SATS = ['node', 'script', 'hash', 'merkle'];
const RETENTION_MS = 30 * 24 * 3600_000;
const DEFAULT_SETTINGS = { v: 1, lang: 'it', theme: 'dark', maxActive: 3, maxLocal: 1, model: null, satModels: {}, localOnly: false };
const DEFAULT_POLICY = { version: 1, commands: [], network: { destinations: [] } };
const TTL = { patch: 900_000, command: 900_000, tool: 900_000, network: 300_000, egress: 300_000, policy: 300_000, integrate: 900_000 };
const HUMAN = /^(ui:\d+|tray)$/;
// Slash commands available in the desktop chat. `run` = handled here, `ui` =
// handled by the renderer (panels, pickers), `cli` = CLI-only for now and
// listed so the catalogue matches the project, never silently dropped.
export const BUILTIN_COMMANDS = [
  { name: 'help', hint: 'show commands', scope: 'run' },
  { name: 'plan', hint: 'investigate a task with read-only tools and save a plan', args: true, scope: 'run' },
  { name: 'build', hint: 'execute the most recently saved plan', scope: 'run' },
  { name: 'model', hint: 'show or switch the model of this chat', args: true, scope: 'run' },
  { name: 'models', hint: 'pick a provider or an installed local model', scope: 'ui' },
  { name: 'status', hint: 'model, mode, Sat, tokens and latest plan', scope: 'run' },
  { name: 'commands', hint: 'list bundled and custom commands', scope: 'run' },
  { name: 'sats', hint: 'list persistent Sats', scope: 'run' },
  { name: 'sat', hint: 'select · info · workspace', args: true, scope: 'run' },
  { name: 'mode', hint: 'manual · assisted · unattended', args: true, scope: 'run' },
  { name: 'approve', hint: 'approve a pending request by id', args: true, scope: 'run' },
  { name: 'deny', hint: 'deny a pending request by id', args: true, scope: 'run' },
  { name: 'pending', hint: 'list pending requests', scope: 'run' },
  { name: 'cancel', hint: 'stop the active run', scope: 'run' },
  { name: 'diff', hint: 'show project changes', scope: 'ui' },
  { name: 'new', hint: 'start a new chat', scope: 'ui' },
  { name: 'reset', hint: 'start a new chat', scope: 'ui' },
  { name: 'export', hint: 'export this chat as Markdown', scope: 'ui' },
  { name: 'tools', hint: 'list tools available to the agent', scope: 'run' },
  { name: 'settings', hint: 'providers, keys and defaults', scope: 'ui' },
  { name: 'setting', hint: 'provider status & active model', scope: 'ui' },
  { name: 'config', hint: 'get · set config values', scope: 'ui' },
  { name: 'login', hint: 'configure a provider API key', scope: 'ui' },
  { name: 'provider', hint: 'add an API key · list providers', scope: 'ui' },
  { name: 'doctor', hint: 'diagnostics', scope: 'ui' },
  { name: 'compact', hint: 'summarize older context', scope: 'cli' },
  { name: 'undo', hint: 'restore the latest agent turn', scope: 'cli' },
  { name: 'profile', hint: 'switch code/bitcoin profile', scope: 'cli' },
  { name: 'skills', hint: 'list local skills', scope: 'cli' },
  { name: 'mcp', hint: 'show MCP connections', scope: 'cli' },
  { name: 'subagent', hint: 'run a custom subagent persona', scope: 'cli' },
  { name: 'session', hint: 'save · load · list · export', scope: 'cli' }
];
// Custom commands in these namespaces drive wallet/node tools, which the
// sandboxed coding worker does not have until the D4 finance service exists.
const FINANCIAL_NAMESPACES = /^(btc|cashu|liquid|ln|wl):/;
const DESKTOP_TOOLS = ['read_file', 'list_dir', 'write_file', 'edit_file', 'bash', 'network_fetch', 'subagent'];
const PLAN_SYSTEM = 'Investigate the task using read-only tools. Return a concrete implementation plan with files, steps and verification. Do not implement changes.';

export const projectIdFor = root => `p_${hash(realpathSync(root)).slice(0, 16)}`;
export const fileVersion = file => {
  if (!existsSync(file)) return null;
  const st = lstatSync(file);
  return st.isSymbolicLink() ? `link:${readlinkSync(file)}` : hash(readFileSync(file));
};
const commandArgv = command => { const c = normalizeCommand(command); return !c || /[|&;<>()`$\\\n\r'"*?~{}[\]]/.test(c) ? null : c.split(' '); };
const matchesPolicy = (policy, argv) => !!argv && policy.commands.some(r =>
  r.argv ? r.argv.length === argv.length && r.argv.every((a, i) => a === argv[i]) : r.argvPrefix?.every((a, i) => a === argv[i]));

export function createController({ home, appDir, agents = [], emit = () => {}, sandbox = { available: false }, spawnWorker,
  callModelImpl = callModel, config: configOverride, inventoryHome, financeFetch, secrets = { get: () => undefined }, now = Date.now } = {}) {
  const dir = path.join(home, 'desktop');
  const sats = loadSats(appDir && existsSync(path.join(appDir, 'sats')) ? { directory: path.join(appDir, 'sats') } : {});
  const files = { settings: path.join(dir, 'settings.json'), projects: path.join(dir, 'projects.json'), sessions: path.join(dir, 'sessions.json'), worktrees: path.join(dir, 'worktrees.json'), log: path.join(dir, 'approvals.jsonl') };
  const settings = { ...DEFAULT_SETTINGS, ...loadJSON(files.settings, {}) };
  const projects = new Map(loadJSON(files.projects, []).filter(p => existsSync(p.root)).map(p => [p.projectId, p]));
  const sessions = new Map(Object.entries(loadJSON(files.sessions, {})));
  const worktrees = new Map(Object.entries(loadJSON(files.worktrees, {})));
  const runs = new Map(), leases = new Map(), projectLocks = new Map(), policies = new Map();
  const queue = new Semaphore(settings.maxActive), local = new Semaphore(settings.maxLocal);
  const redactor = new Redactor();
  const config = () => configOverride || loadConfig();
  const approvals = new Approvals({ redact: v => redactor.value(v), emit: (_, req) => {
    emit('approval', req);
    const r = runs.get(req.runId), satId = r?.executingSat || r?.agentId;
    if (SATS.includes(satId)) emit('sat', { v: 1, type: req.status === 'pending' ? 'approval:required' : 'approval:resolved',
      satId, sessionId: req.sessionId, runId: req.runId, at: new Date(now()).toISOString(), state: req.status === 'pending' ? 'waiting_approval' : 'thinking' });
    if (req.status !== 'pending') log({ id: req.id, sessionId: req.sessionId, runId: req.runId, kind: req.kind, status: req.status });
  } });

  const saveMeta = () => { atomicJSON(files.sessions, Object.fromEntries([...sessions].map(([k, { messages, ...meta }]) => [k, meta]))); atomicJSON(files.projects, [...projects.values()]); atomicJSON(files.worktrees, Object.fromEntries(worktrees)); };
  const log = entry => { mkdirSync(dir, { recursive: true, mode: 0o700 }); appendFileSync(files.log, JSON.stringify({ at: new Date(now()).toISOString(), ...entry }) + '\n', { mode: 0o600 }); };
  const project = id => projects.get(id) || (() => { throw fail('NOT_FOUND', 'Unknown project'); })();
  const session = id => sessions.get(id) || (() => { throw fail('NOT_FOUND', 'Unknown session'); })();
  const run = id => runs.get(id) || (() => { throw fail('NOT_FOUND', 'Unknown run'); })();
  const policyFile = projectId => path.join(dir, 'projects', projectId, 'policy.json');
  const policy = projectId => { if (!policies.has(projectId)) policies.set(projectId, { ...DEFAULT_POLICY, ...loadJSON(policyFile(projectId), DEFAULT_POLICY) }); return policies.get(projectId); };
  const lockFor = root => { if (!projectLocks.has(root)) projectLocks.set(root, new Semaphore(1)); return projectLocks.get(root); };
  const publicRun = r => ({ runId: r.runId, sessionId: r.sessionId, projectId: r.projectId, state: r.state, mode: r.config.mode, model: r.config.model,
    prompt: r.prompt.slice(0, 160), startedAt: r.startedAt, endedAt: r.endedAt || null, usage: r.usage, worktree: r.worktree?.dir || null, error: r.error || null });
  const setState = (r, state, extra = {}) => { Object.assign(r, { state }, extra); if (['success', 'error', 'cancelled', 'interrupted'].includes(state)) { r.endedAt = now(); r.probe?.stop(); } emit('run', publicRun(r)); };
  const sessionEvent = (sessionId, type, data) => emit('session', { sessionId, type, data });

  // ---- model routing (§8): workers never hold provider credentials ----
  const resolveTarget = spec => {
    const t = resolveModel({ cliModel: spec || undefined, config: config() });
    const key = secrets.get(t.providerName); if (key) { t.apiKey = key; redactor.add(key); }
    if (t.apiKey) redactor.add(t.apiKey);
    return { ...t, locality: isLocalProvider(t.provider) ? 'local' : 'cloud' };
  };
  // Default: explicit desktop setting, then the CLI config/env, then the best
  // local model this machine is serving and can hold in memory.
  let autoLocal = null;
  const defaultSpec = () => settings.model || config().model || process.env.BITCODE_MODEL || autoLocal || undefined;
  function pickAutoLocal(inv) { autoLocal = bestLocalModel(inv, config()); }
  const refreshAutoLocal = () => localInventory(config(), { timeoutMs: 1500, home: inventoryHome }).then(pickAutoLocal).catch(() => {});
  const describeModel = spec => { try { const t = resolveTarget(spec); return { spec: t.spec, locality: t.locality }; } catch (e) { return { spec: spec || null, locality: 'unknown', error: e.message }; } };

  async function modelRequest(r, { agent, system, messages, tools }) {
    const spec = SATS.includes(agent) && r.config.satModels[agent] ? r.config.satModels[agent] : r.config.model;
    const target = resolveTarget(spec);
    // Memory of the local model's own process, reported to the UI while the run is active (never for cloud models).
    if (target.locality === 'local' && !r.probe) r.probe = createMemoryProbe({ providerName: target.providerName, baseURL: target.provider.baseURL, model: target.model }, { onValue: memory => emit('metrics', { runId: r.runId, sessionId: r.sessionId, memory }) });
    if (target.locality === 'cloud' && r.config.locality === 'local') {
      if (r.config.localOnly) throw fail('LOCAL_ONLY', 'This session is local-only');
      if (!r.egress.has(target.spec)) {
        const ok = await ask(r, 'egress', { fromLocality: 'local', provider: target.providerName, model: target.spec, agentId: agent, reason: 'delegation sends project context to a cloud provider' });
        if (!ok) throw fail('POLICY_DENIED', 'Cloud delegation denied');
        r.egress.add(target.spec);
      }
    }
    const call = () => callModelImpl({ provider: target.provider, model: target.model, apiKey: target.apiKey, system, messages, tools, signal: r.aborter.signal,
      onDelta: text => sessionEvent(r.sessionId, 'message.delta', { runId: r.runId, agentId: agent, text: redactor.text(text) }) });
    const res = target.locality === 'local' ? await local.use(call, r.aborter.signal) : await call();
    const u = res.usage || {};
    r.usage.inputTokens += Number(u.input_tokens) || 0; r.usage.outputTokens += Number(u.output_tokens) || 0;
    emit('run', publicRun(r));
    return { text: res.text, toolCalls: res.toolCalls || [], usage: res.usage, providerState: res.providerState };
  }

  // ---- approvals & policy decision (§5, §6.2) ----
  function ask(r, kind, subject) {
    const s = sessions.get(r.sessionId);
    approvals.ttl = TTL[kind] || 900_000; // read synchronously by request()
    return approvals.request({ sessionId: r.sessionId, runId: r.runId, kind, signal: r.aborter.signal,
      subject: { ...subject, projectId: r.projectId, project: projects.get(r.projectId)?.name, session: s?.name, mode: r.config.mode } });
  }

  async function acquire(r, { tool, args = {}, baseVersion }) {
    const pol = policy(r.projectId), mode = r.config.mode, root = r.root;
    let needsApproval, kind, subject, needsLease = true;
    if (tool === 'write_file' || tool === 'edit_file') {
      const file = workspacePath(root, args.path, { write: true });
      const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
      if ((before === null ? null : hash(before)) !== (baseVersion ?? null)) throw fail('STALE_VERSION', `${args.path} changed since it was read`);
      kind = 'patch'; needsApproval = mode === 'manual';
      subject = { files: [{ path: args.path, baseVersion: baseVersion ?? null, newVersion: hash(args.content), op: before === null ? 'create' : 'modify' }], unifiedDiff: unifiedDiff(args.path, before, args.content) };
    } else if (tool === 'bash') {
      const argv = commandArgv(args.command), readOnly = isReadOnlyCommand(args.command), inPolicy = matchesPolicy(pol, argv);
      kind = 'command'; needsLease = !readOnly;
      needsApproval = !(readOnly || (inPolicy && mode !== 'manual'));
      subject = { shell: args.command, argv, cwd: '.', sandbox: 'bwrap', network: 'none', policyVersion: pol.version, reason: readOnly ? 'read-only' : inPolicy ? 'manual mode' : 'not covered by project policy' };
    } else throw fail('INVALID_PARAMS', `Unsupported mutation ${tool}`);
    subject.agentId = r.executingSat || r.agentId; subject.model = r.config.satModels[subject.agentId] || r.config.model;
    if (needsApproval) {
      setState(r, 'awaiting_approval');
      const ok = await ask(r, kind, subject);
      setState(r, 'running');
      if (!ok) throw fail('POLICY_DENIED', 'Denied by the user');
      if (kind === 'patch') { const v = fileVersion(workspacePath(root, args.path)); if (v !== (baseVersion ?? null)) throw fail('STALE_VERSION', `${args.path} changed during approval`); }
    }
    sessionEvent(r.sessionId, 'tool.detail', { runId: r.runId, tool, summary: redactor.text(kind === 'command' ? args.command : args.path), auto: !needsApproval });
    const leaseId = randomUUID();
    const release = needsLease ? await lockFor(root).acquire(r.aborter.signal) : () => {};
    leases.set(leaseId, { release, runId: r.runId, root, path: args.path });
    return { leaseId };
  }
  function releaseLease(r, { leaseId }) {
    const l = leases.get(leaseId); if (!l || l.runId !== r.runId) return false;
    leases.delete(leaseId); l.release();
    if (l.path) { const v = fileVersion(path.join(l.root, l.path)); emit('file', { projectId: r.projectId, root: l.root, path: l.path, version: v, by: 'agent' }); }
    return true;
  }

  async function networkFetch(r, { url }) {
    let u; try { u = new URL(url); } catch { throw fail('INVALID_PARAMS', 'Invalid URL'); }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw fail('POLICY_DENIED', 'Only plain http(s) URLs');
    const dest = { scheme: u.protocol.slice(0, -1), host: u.hostname.toLowerCase(), port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
    const pol = policy(r.projectId);
    const allowed = pol.network.destinations.some(d => d.scheme === dest.scheme && d.host === dest.host && d.port === dest.port);
    if (!allowed) {
      setState(r, 'awaiting_approval');
      const ok = await ask(r, 'network', { destination: dest, url: u.href, reason: 'destination not authorised for this project', agentId: r.agentId });
      setState(r, 'running');
      if (!ok) throw fail('POLICY_DENIED', 'Network destination denied');
    }
    const res = await fetch(u, { redirect: 'manual', signal: r.aborter.signal, headers: { 'user-agent': 'bitcode-desktop' } });
    if (res.status >= 300 && res.status < 400) return `HTTP ${res.status} redirect to ${res.headers.get('location')} (not followed; request it explicitly)`;
    const body = (await res.text()).slice(0, 256 * 1024);
    return `HTTP ${res.status}\n${body}`;
  }

  // ---- runs (§8, §9) ----
  async function startRun({ sessionId, prompt, agent, kind = 'chat', readOnly = false, systemExtra = '' }) {
    const s = session(sessionId), p = project(s.projectId);
    agent ??= kind === 'plan' ? undefined : s.satId;
    if ([...runs.values()].some(r => r.sessionId === sessionId && !r.endedAt)) throw fail('BUSY', 'A run is already active in this session');
    if (!sandbox.available) throw fail('SANDBOX_UNAVAILABLE', sandbox.detail || 'bubblewrap is required');
    if (agent && !SATS.includes(agent)) throw fail('INVALID_PARAMS', 'Unknown agent');
    const model = describeModel(s.model || defaultSpec());
    if (model.error) throw fail('PROVIDER_UNAVAILABLE', model.error);
    const satModels = Object.fromEntries(SATS.map(a => [a, s.satModels?.[a] || settings.satModels?.[a] || null]));
    if (settings.localOnly && (model.locality !== 'local' || SATS.some(a => satModels[a] && describeModel(satModels[a]).locality !== 'local'))) throw fail('LOCAL_ONLY', 'Local-only mode rejects cloud models');
    const pol = policy(p.projectId);
    const config = Object.freeze({ mode: s.mode, model: model.spec, locality: model.locality, satModels: Object.freeze(satModels), localOnly: settings.localOnly, policyVersion: pol.version,
      limits: Object.freeze({ maxSteps: 60, maxTotalToolCalls: 200 }) });
    const r = { runId: randomUUID(), sessionId, projectId: p.projectId, root: p.root, agentId: agent || 'bitcode', prompt, config, state: 'queued', startedAt: now(),
      usage: { inputTokens: 0, outputTokens: 0, costMicros: null }, aborter: new AbortController(), egress: new Set(), kind };
    runs.set(r.runId, r);
    s.messages = [...(s.messages || []), { role: 'user', content: prompt }]; s.updatedAt = now(); persistSession(s);
    sessionEvent(sessionId, 'messages', { messages: transcript(s.messages) });
    emit('run', publicRun(r));
    (async () => {
      let release;
      try {
        release = await queue.acquire(r.aborter.signal);
        setState(r, 'starting');
        if (config.mode === 'unattended') {
          const wt = await G.addWorktree(p.root, path.join(dir, 'worktrees', r.runId));
          r.worktree = wt; r.root = wt.dir;
          worktrees.set(r.runId, { runId: r.runId, projectId: p.projectId, sessionId, dir: wt.dir, base: wt.base, createdAt: now() }); saveMeta();
        }
        await new Promise(resolve => {
          r.worker = spawnWorker({ appDir, root: r.root, runId: r.runId,
            onMessage: msg => onWorkerMessage(r, msg),
            onExit: err => { if (!r.endedAt) setState(r, r.aborter.signal.aborted ? 'cancelled' : 'interrupted', { error: err?.message || null }); cleanup(r); resolve(); } });
          setState(r, 'running');
          r.worker.send({ type: 'start', runId: r.runId, sessionId, model: config.model, agent, agents, sats, limits: config.limits, messages: s.messages, readOnly, systemExtra });
        });
      } catch (e) {
        if (!r.endedAt) setState(r, r.aborter.signal.aborted ? 'cancelled' : 'error', { error: e.message });
      } finally { release?.(); cleanup(r); }
    })();
    return publicRun(r);
  }
  function cleanup(r) {
    for (const [id, l] of leases) if (l.runId === r.runId) { leases.delete(id); l.release(); }
  }
  function onWorkerMessage(r, msg) {
    if (msg.type === 'request') {
      const handlers = { 'model.request': p => modelRequest(r, p), 'mutation.acquire': p => acquire(r, p), 'mutation.release': p => releaseLease(r, p), 'network.fetch': p => networkFetch(r, p) };
      const h = handlers[msg.method];
      Promise.resolve().then(() => { if (!h) throw fail('FORBIDDEN', 'Unknown worker method'); return h(msg.params || {}); })
        .then(result => r.worker?.send({ type: 'response', id: msg.id, result }), e => r.worker?.send({ type: 'response', id: msg.id, error: `${e.code ? e.code + ': ' : ''}${e.message}` }));
    } else if (msg.type === 'event' && msg.event?.v === 1) {
      if (msg.event.type === 'run.started') r.executingSat = SATS.includes(msg.event.agentId) ? msg.event.agentId : r.agentId;
      if (msg.event.type === 'run.finished') r.executingSat = r.agentId;
      emit('feed', { ...msg.event, projectId: r.projectId });
      if (SATS.includes(msg.event.agentId)) {
        for (const event of satEvents(msg.event)) emit('sat', { ...event, sessionId: r.sessionId, projectId: r.projectId });
        if (msg.event.type === 'run.started') satWorkspace(msg.event.agentId, { home });
        if (msg.event.type === 'run.finished') recordSatRun(msg.event.agentId,
          { state: msg.event.data?.outcome === 'ok' ? 'success' : msg.event.data?.outcome === 'cancelled' ? 'idle' : 'error' },
          { home, cwd: project(r.projectId).root });
      }
    } else if (msg.type === 'checkpoint' && Array.isArray(msg.messages)) {
      const s = sessions.get(r.sessionId); if (!s) return;
      s.messages = msg.messages; s.updatedAt = now(); persistSession(s);
      sessionEvent(r.sessionId, 'messages', { messages: transcript(s.messages) });
    } else if (msg.type === 'done') {
      if (r.kind === 'plan' && typeof msg.answer === 'string' && msg.answer.trim()) {
        const file = savePlan(project(r.projectId).root, { task: r.prompt, text: msg.answer });
        sessionEvent(r.sessionId, 'plan.saved', { runId: r.runId, file });
      }
      setState(r, 'success'); r.worker?.stop();
    }
    else if (msg.type === 'failure') { setState(r, r.aborter.signal.aborted ? 'cancelled' : 'error', { error: redactor.text(msg.message || 'failed') }); r.worker?.stop(); }
  }
  function cancelRun(runId) {
    const r = run(runId); if (r.endedAt) return publicRun(r);
    r.aborter.abort(); r.worker?.send({ type: 'cancel' });
    setTimeout(() => r.worker?.stop(), 3000).unref?.();
    if (!r.worker) setState(r, 'cancelled');
    return publicRun(r);
  }

  // ---- sessions (§12) ----
  function persistSession(s) {
    const p = projects.get(s.projectId);
    if (p) saveSession(p.root, { id: s.sessionId, model: s.model, network: null, messages: s.messages, name: s.name });
    sessions.set(s.sessionId, s); saveMeta();
  }
  const transcript = messages => messages.map(m => ({ role: m.role, content: redactor.text(String(m.content ?? '')).slice(0, m.role === 'tool' ? 2000 : 200_000), name: m.name, tools: m.toolCalls?.map(t => t.name) }));
  const sessionMeta = s => ({ sessionId: s.sessionId, projectId: s.projectId, name: s.name, mode: s.mode, model: s.model, satModels: s.satModels, satId: s.satId || '', keep: !!s.keep, updatedAt: s.updatedAt,
    expiresAt: s.keep ? null : s.updatedAt + RETENTION_MS, active: [...runs.values()].some(r => r.sessionId === s.sessionId && !r.endedAt) });
  function loadMessages(s) {
    if (!s.messages) { try { s.messages = loadSession(project(s.projectId).root, s.sessionId).messages; } catch { s.messages = []; } }
    return s.messages;
  }
  function prune() {
    for (const s of [...sessions.values()]) {
      if (s.keep || now() - (s.updatedAt || 0) < RETENTION_MS || sessionMeta(s).active) continue;
      const p = projects.get(s.projectId);
      if (p) rmSync(path.join(sessionsDir(p.root), `${s.sessionId}.json`), { force: true });
      sessions.delete(s.sessionId);
    }
    saveMeta();
  }

  // ---- chat control commands (§5.3): parsed only from human-typed text ----
  async function command(origin, { sessionId, text }) {
    const [cmd, arg, name, extra] = text.trim().split(/\s+/);
    if (cmd === '/sats' && !arg) return sats.map(({ id, role }) => ({ id, role }));
    if (cmd === '/sat') {
      if (extra || !arg || (name && !['info', 'workspace'].includes(arg))) throw fail('INVALID_PARAMS', 'Use /sat <name>, /sat info <name>, /sat workspace <name>');
      const selected = findSat(['info', 'workspace'].includes(arg) ? name : arg, sats);
      const s = session(sessionId);
      if (arg === 'info') return { ...selected, ...satWorkspace(selected.id, { home }), history: satHistory(selected.id, { home, cwd: project(s.projectId).root }) };
      if (arg === 'workspace') return { workspace: satWorkspace(selected.id, { home }).workspace };
      if (sessionMeta(s).active) throw fail('BUSY', 'Wait for the active run before selecting a Sat');
      s.satId = selected.id; saveMeta(); return { satId: selected.id, role: selected.role };
    }
    const pending = approvals.list().filter(a => a.sessionId === sessionId);
    const pick = () => {
      if (!arg || arg.length < 6) throw fail('INVALID_PARAMS', 'Give at least 6 characters of the request id');
      const m = pending.filter(a => a.id.startsWith(arg) || a.id.slice(4).startsWith(arg));
      if (m.length !== 1) throw fail(m.length ? 'INVALID_PARAMS' : 'NOT_FOUND', m.length ? 'Ambiguous request id' : 'No pending request with that id');
      return m[0];
    };
    if (cmd === '/approve' || cmd === '/deny') { const a = pick(); return invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId, decision: cmd === '/approve' ? 'approve' : 'deny' }, origin); }
    if (cmd === '/cancel') { const r = [...runs.values()].filter(r => r.sessionId === sessionId && !r.endedAt && (!arg || r.runId.startsWith(arg))); if (r.length !== 1) throw fail('NOT_FOUND', 'No matching active run'); return cancelRun(r[0].runId); }
    if (cmd === '/mode') { const map = { manuale: 'manual', manual: 'manual', assistita: 'assisted', assisted: 'assisted', autonoma: 'unattended', unattended: 'unattended' }; return invoke('mode.set', { sessionId, mode: map[arg] }, origin); }
    if (cmd === '/pending') return pending;
    const s = session(sessionId), root = project(s.projectId).root, rest = text.trim().slice(cmd.length).trim();
    if (cmd === '/help' || cmd === '/commands') return { commands: listCommands(root) };
    if (cmd === '/tools') return { tools: DESKTOP_TOOLS };
    if (cmd === '/model') {
      if (!rest) return { model: describeModel(s.model || defaultSpec()) };
      const m = describeModel(rest); if (m.error) throw fail('PROVIDER_UNAVAILABLE', m.error);
      if (settings.localOnly && m.locality !== 'local') throw fail('LOCAL_ONLY', 'Local-only mode rejects cloud models');
      loadMessages(s); s.model = m.spec; persistSession(s); return { model: m, session: sessionMeta(s) };
    }
    if (cmd === '/status') {
      const usage = [...runs.values()].filter(r => r.sessionId === sessionId).reduce((u, r) => ({ inputTokens: u.inputTokens + r.usage.inputTokens, outputTokens: u.outputTokens + r.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
      const plan = latestPlan(root);
      return { status: { model: describeModel(s.model || defaultSpec()).spec, mode: s.mode, sat: s.satId || null, messages: loadMessages(s).length, usage, plan: plan?.file || null, sandbox: sandbox.available } };
    }
    if (cmd === '/plan') {
      if (!rest) throw fail('INVALID_PARAMS', 'Usage: /plan <task>');
      loadMessages(s); return { run: await startRun({ sessionId, prompt: rest, kind: 'plan', readOnly: true, systemExtra: PLAN_SYSTEM }) };
    }
    if (cmd === '/build') {
      const plan = latestPlan(root); if (!plan) throw fail('NOT_FOUND', 'No saved plan; use /plan <task>');
      loadMessages(s); return { run: await startRun({ sessionId, prompt: `Implement this saved plan, inspect current files first, and verify the changes:\n${plan.text}` }) };
    }
    const builtin = BUILTIN_COMMANDS.find(c => `/${c.name}` === cmd);
    if (builtin?.scope === 'cli') throw fail('CLI_ONLY', `/${builtin.name} is available in the CLI only for now`);
    if (builtin?.scope === 'ui') throw fail('UI_ONLY', `/${builtin.name} is handled by the app window`);
    const custom = loadCommands({ cwd: root, bundledDir: bundledCommandsDir, userDir: path.join(home, 'commands') }).find(c => `/${c.name}` === cmd);
    if (custom) {
      if (FINANCIAL_NAMESPACES.test(custom.name)) throw fail('CLI_ONLY', `/${custom.name} needs the Bitcoin tools, available in the CLI only for now`);
      loadMessages(s); return { run: await startRun({ sessionId, prompt: expandCommand(custom, rest) }) };
    }
    throw fail('UNKNOWN_COMMAND', `Unknown command ${cmd}. Type /help`);
  }

  const bundledCommandsDir = appDir && existsSync(path.join(appDir, 'commands')) ? path.join(appDir, 'commands') : undefined;
  function listCommands(root) {
    const custom = loadCommands({ cwd: root || home, bundledDir: bundledCommandsDir, userDir: path.join(home, 'commands') })
      .map(c => ({ name: c.name, hint: c.description || 'custom command', args: true, scope: FINANCIAL_NAMESPACES.test(c.name) ? 'cli' : 'run', custom: true }));
    return [...BUILTIN_COMMANDS, ...custom];
  }

  // ---- public API (§3) ----
  const finance = createFinance({ home, emit, configImpl: configOverride ? () => configOverride : undefined, saveConfigImpl: configOverride ? () => {} : undefined, fetchImpl: financeFetch });
  const human = [...finance.human, 'models.addLocalProvider', 'approval.resolve', 'mode.set', 'policy.propose', 'settings.set', 'chat.submit', 'worktree.integrate', 'worktree.discard', 'session.delete', 'run.start'];
  const methods = {
    ...finance.methods,
    'app.status': () => ({ sandbox, settings, defaultModel: describeModel(defaultSpec()), runs: [...runs.values()].map(publicRun), pending: approvals.list(), projects: [...projects.values()] }),
    'project.open': ({ path: p }) => {
      const root = realpathSync(p); if (!statSync(root).isDirectory()) throw fail('INVALID_PARAMS', 'Not a directory');
      const projectId = projectIdFor(root); const entry = { projectId, root, name: path.basename(root), openedAt: now() };
      projects.set(projectId, entry); saveMeta(); return entry;
    },
    'project.list': () => [...projects.values()].sort((a, b) => b.openedAt - a.openedAt),
    'project.close': ({ projectId }) => { projects.delete(projectId); saveMeta(); return true; },
    'session.create': ({ projectId, name, mode = 'assisted', model, satId = '' }) => {
      project(projectId); if (!MODES.includes(mode)) throw fail('INVALID_PARAMS', 'Unknown mode');
      if (satId !== '' && !SATS.includes(satId)) throw fail('INVALID_PARAMS', 'Unknown Sat');
      const s = { sessionId: newSessionId(), projectId, name: (name || 'Nuova sessione').slice(0, 80), mode, model: model || null, satModels: {}, keep: false, updatedAt: now(), messages: [] };
      s.satId = satId;
      sessions.set(s.sessionId, s); persistSession(s); return sessionMeta(s);
    },
    'session.list': ({ projectId } = {}) => [...sessions.values()].filter(s => !projectId || s.projectId === projectId).map(sessionMeta).sort((a, b) => b.updatedAt - a.updatedAt),
    'session.open': ({ sessionId }) => { const s = session(sessionId); return { ...sessionMeta(s), messages: transcript(loadMessages(s)), pending: approvals.list().filter(a => a.sessionId === sessionId) }; },
    'session.update': ({ sessionId, name, keep, model, satModels, satId }) => {
      const s = session(sessionId); loadMessages(s);
      if (satId !== undefined) {
        if (satId !== '' && !SATS.includes(satId)) throw fail('INVALID_PARAMS', 'Unknown Sat');
        if (sessionMeta(s).active) throw fail('BUSY', 'Wait for the active run');
        s.satId = satId;
      }
      if (typeof name === 'string') s.name = name.slice(0, 80);
      if (typeof keep === 'boolean') s.keep = keep;
      if (model !== undefined) s.model = model || null;
      if (satModels && typeof satModels === 'object') for (const a of SATS) if (a in satModels) s.satModels = { ...s.satModels, [a]: satModels[a] || null };
      persistSession(s); return sessionMeta(s);
    },
    'session.delete': ({ sessionId }) => {
      const s = session(sessionId); if (sessionMeta(s).active) throw fail('BUSY', 'Session has an active run');
      rmSync(path.join(sessionsDir(project(s.projectId).root), `${sessionId}.json`), { force: true }); sessions.delete(sessionId); saveMeta(); return true;
    },
    'session.export': ({ sessionId }) => { const s = session(sessionId); return transcript(loadMessages(s)).filter(m => m.role !== 'tool').map(m => `## ${m.role}\n\n${m.content}`).join('\n\n'); },
    'mode.set': ({ sessionId, mode }) => {
      const s = session(sessionId); if (!MODES.includes(mode)) throw fail('INVALID_PARAMS', 'Unknown mode');
      if (mode === 'unattended' && !sandbox.available) throw fail('SANDBOX_UNAVAILABLE');
      loadMessages(s); s.mode = mode; persistSession(s); return sessionMeta(s);
    },
    'chat.submit': async ({ sessionId, text, agent }, origin) => {
      if (typeof text !== 'string' || !text.trim()) throw fail('INVALID_PARAMS', 'Empty message');
      if (text.trim().startsWith('/')) return { command: true, result: await command(origin, { sessionId, text }) };
      loadMessages(session(sessionId)); return { command: false, run: await startRun({ sessionId, prompt: text, agent }) };
    },
    'run.list': () => [...runs.values()].map(publicRun).sort((a, b) => b.startedAt - a.startedAt),
    'run.cancel': ({ runId }) => cancelRun(runId),
    'approval.list': ({ sessionId } = {}) => approvals.list().filter(a => !sessionId || a.sessionId === sessionId),
    'approval.resolve': ({ requestId, digest, sessionId, decision }, origin) => {
      const ok = approvals.resolve({ id: requestId, digest, sessionId, decision });
      log({ id: requestId, sessionId, decision, origin }); return ok;
    },
    'policy.get': ({ projectId }) => policy(projectId),
    'policy.propose': async ({ projectId, add }) => {
      const p = project(projectId), current = policy(projectId), next = structuredClone(current);
      if (add?.command) { const argv = commandArgv(add.command); if (!argv) throw fail('INVALID_PARAMS', 'Only plain argv commands can enter a policy'); next.commands.push({ argv }); }
      else if (add?.destination) { const d = add.destination; if (!['http', 'https'].includes(d.scheme) || typeof d.host !== 'string' || !Number.isInteger(d.port)) throw fail('INVALID_PARAMS'); next.network.destinations.push({ scheme: d.scheme, host: d.host.toLowerCase(), port: d.port }); }
      else throw fail('INVALID_PARAMS', 'Nothing to add');
      next.version = current.version + 1; next.updatedAt = new Date(now()).toISOString();
      atomicJSON(policyFile(p.projectId), next); policies.set(p.projectId, next); log({ kind: 'policy', projectId, version: next.version });
      return next;
    },
    'settings.get': () => settings,
    'settings.set': ({ key, value }) => {
      const checks = { lang: v => ['it', 'en'].includes(v), theme: v => ['light', 'dark', 'system'].includes(v), maxActive: v => Number.isInteger(v) && v >= 1 && v <= 8,
        maxLocal: v => Number.isInteger(v) && v >= 1 && v <= 4, model: v => v === null || typeof v === 'string', localOnly: v => typeof v === 'boolean',
        satModels: v => v && typeof v === 'object' && Object.keys(v).every(k => SATS.includes(k)) };
      if (!checks[key]?.(value)) throw fail('INVALID_PARAMS', `Invalid setting ${key}`);
      settings[key] = value; atomicJSON(files.settings, settings);
      if (key === 'maxActive') { queue.limit = value; queue.pump(); }
      if (key === 'maxLocal') { local.limit = value; local.pump(); }
      return settings;
    },
    'models.list': () => Object.entries(allProviders(config())).map(([name, p]) => ({ name, defaultModel: p.defaultModel || null, locality: isLocalProvider(p) ? 'local' : 'cloud',
      hasKey: !!(secrets.get(name) || (p.keyEnv && process.env[p.keyEnv]) || p.apiKey) || isLocalProvider(p) })),
    'model.describe': ({ spec }) => describeModel(spec),
    'commands.list': ({ projectId } = {}) => listCommands(projectId ? project(projectId).root : null),
    'models.available': async () => {
      const cfg = config(), providers = allProviders(cfg);
      const cloud = Object.entries(providers).filter(([, p]) => !isLocalProvider(p)).map(([name, p]) => ({ provider: name, spec: p.defaultModel ? `${name}/${p.defaultModel}` : null, model: p.defaultModel || null,
        hasKey: !!(secrets.get(name) || (p.keyEnv && process.env[p.keyEnv]) || p.apiKey) }));
      const inv = await localInventory(cfg, { timeoutMs: 1500, home: inventoryHome }); pickAutoLocal(inv);
      const local = inv.servers.map(sv => ({ provider: sv.name, label: sv.label, baseURL: sv.baseURL, configured: sv.configured, running: sv.running,
        hint: sv.models.length ? null : localSetupHint(sv.name, sv.running),
        models: sv.models.map(m => ({ spec: m.spec, model: m.id, detail: describeLocalModel(m), size: m.size || 0, fit: m.fit })) }));
      return { local, idle: inv.idle, machine: inv.machine, cloud, current: describeModel(defaultSpec()).spec, auto: !settings.model && !config().model && !process.env.BITCODE_MODEL, localOnly: settings.localOnly };
    },
    'models.addLocalProvider': ({ name, baseURL }) => {
      const known = KNOWN_RUNTIMES.find(r => r.name === name && r.baseURL === baseURL);
      if (!known) throw fail('INVALID_PARAMS', 'Unknown local runtime');
      const entry = runtimeProvider(name);
      if (configOverride) { configOverride.providers = { ...configOverride.providers, [name]: entry }; return entry; }
      const cfg = loadConfig(); cfg.providers = { ...(cfg.providers || {}), [name]: entry }; saveConfig(cfg); return entry;
    },
    'fs.tree': ({ projectId, path: rel = '.' }) => {
      const root = project(projectId).root, abs = workspacePath(root, rel);
      return readdirSync(abs, { withFileTypes: true }).filter(e => e.name !== '.git').slice(0, 2000)
        .map(e => ({ name: e.name, path: path.posix.join(rel === '.' ? '' : rel, e.name), dir: e.isDirectory() }))
        .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
    },
    'buffer.open': ({ projectId, path: rel }) => {
      const file = workspacePath(project(projectId).root, rel); const st = statSync(file);
      if (st.size > 4 * 1024 * 1024) throw fail('INVALID_PARAMS', 'File exceeds 4 MiB');
      const buf = readFileSync(file); if (buf.subarray(0, 8000).includes(0)) throw fail('INVALID_PARAMS', 'Binary file');
      return { text: buf.toString('utf8'), version: hash(buf) };
    },
    'buffer.save': async ({ projectId, path: rel, text, baseVersion }) => {
      const root = project(projectId).root, file = workspacePath(root, rel, { write: true });
      const lock = lockFor(root); if (lock.active >= lock.limit) throw fail('LEASE_HELD', 'An agent holds the project lease');
      return lock.use(() => {
        const current = fileVersion(file); if (current !== (baseVersion ?? null)) throw fail('STALE_VERSION', 'File changed on disk');
        writeFileSync(file, text); const version = hash(text); emit('file', { projectId, root, path: rel, version, by: 'user' }); return { version };
      });
    },
    'git.status': ({ projectId }) => G.status(project(projectId).root),
    'git.diff': ({ projectId, path: p, staged }) => G.diff(project(projectId).root, { path: p, staged }),
    'git.stage': ({ projectId, paths }) => G.stage(project(projectId).root, paths),
    'git.unstage': ({ projectId, paths }) => G.unstage(project(projectId).root, paths),
    'git.commit': ({ projectId, message }) => { if (!message?.trim()) throw fail('INVALID_PARAMS', 'Empty commit message'); const root = project(projectId).root; return lockFor(root).use(() => G.commit(root, message)); },
    'worktree.list': () => [...worktrees.values()],
    'worktree.diff': ({ runId }) => { const w = worktrees.get(runId); if (!w) throw fail('NOT_FOUND'); return G.worktreePatch(w.dir); },
    'worktree.integrate': async ({ runId }) => {
      const w = worktrees.get(runId); if (!w) throw fail('NOT_FOUND'); if (runs.get(runId) && !runs.get(runId).endedAt) throw fail('BUSY', 'Run still active');
      const root = project(w.projectId).root;
      await lockFor(root).use(() => G.integrateWorktree(root, w.dir));
      await G.removeWorktree(root, w.dir); worktrees.delete(runId); saveMeta(); log({ kind: 'integrate', runId }); return true;
    },
    'worktree.discard': async ({ runId }) => {
      const w = worktrees.get(runId); if (!w) throw fail('NOT_FOUND'); if (runs.get(runId) && !runs.get(runId).endedAt) throw fail('BUSY', 'Run still active');
      await G.removeWorktree(project(w.projectId).root, w.dir).catch(() => rmSync(w.dir, { recursive: true, force: true }));
      worktrees.delete(runId); saveMeta(); return true;
    }
  };

  async function invoke(method, params = {}, origin) {
    const fn = methods[method];
    if (!fn) throw fail('NOT_FOUND', `Unknown method ${method}`);
    if (human.includes(method) && !HUMAN.test(origin || '')) throw fail('FORBIDDEN_ORIGIN');
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw fail('INVALID_PARAMS');
    if (JSON.stringify(params).length > (method === 'buffer.save' ? 16 : 1) * 1024 * 1024) throw fail('INVALID_PARAMS', 'Payload too large');
    return fn(params, origin);
  }

  prune();
  if (!configOverride) refreshAutoLocal();
  const timer = setInterval(prune, 3600_000); timer.unref?.();
  return {
    invoke, redactor,
    activeRuns: () => [...runs.values()].filter(r => !r.endedAt).map(publicRun),
    pending: () => approvals.list(),
    shutdown() { clearInterval(timer); approvals.close(); for (const r of runs.values()) if (!r.endedAt) { r.aborter.abort(); r.worker?.stop(); setState(r, 'interrupted', { error: 'app_exit' }); } }
  };
}
