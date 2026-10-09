import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runAgent, systemPrompt } from '../src/agent.mjs';
import { createEventBus } from '../src/runtime/events.mjs';
import { runSubagent } from '../src/subagents.mjs';
import { runSat } from '../src/sat-runtime.mjs';
import { workspacePath, hash } from './core/primitives.mjs';
import { DESKTOP_CAPABILITIES } from './core/prompt.mjs';

const send = data => process.stdout.write(JSON.stringify(data) + '\n');
const pending = new Map(); const aborter = new AbortController();
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = randomUUID(); pending.set(id, { resolve, reject }); send({ type: 'request', id, method, params });
});
let started = false;
createInterface({ input: process.stdin }).on('line', async line => {
  try {
    const msg = JSON.parse(line);
    if (msg.type === 'response') { const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(msg.error), { code: msg.errorCode, statusCode: msg.statusCode })) : p.resolve(msg.result); }
    if (msg.type === 'cancel') { aborter.abort(); for (const p of pending.values()) p.reject(new Error('Cancelled')); pending.clear(); }
    if (msg.type === 'start' && !started) { started = true; await run(msg); }
  } catch (error) { send({ type: 'failure', message: error.message, code: error.code, statusCode: error.statusCode }); process.exitCode = 1; process.stdin.destroy(); }
});

async function run(input) {
  const root = '/workspace', signal = aborter.signal, bus = createEventBus();
  bus.subscribe(event => send({ type: 'event', event }));
  const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const string = { type: 'string' };
  const gate = async (subject, fn) => {
    const { leaseId } = await rpc('mutation.acquire', subject);
    try { signal.throwIfAborted(); return await fn(); }
    finally { await rpc('mutation.release', { leaseId }); }
  };
  const read = relative => { const file = workspacePath(root, relative); if (statSync(file).size > 1024 * 1024) throw new Error('File exceeds 1 MiB'); return readFileSync(file, 'utf8'); };
  const version = relative => { const p = workspacePath(root, relative); return existsSync(p) ? hash(read(relative)) : null; };
  const tools = [
    { name: 'read_file', mutating: false, description: 'Read a project-relative UTF-8 file.', parameters: schema({ path: string }), run: ({ path: p }) => read(p) },
    { name: 'list_dir', mutating: false, description: 'List a project-relative directory.', parameters: schema({ path: string }), run: ({ path: p }) => readdirSync(workspacePath(root, p), { withFileTypes: true }).slice(0, 500).map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') },
    { name: 'write_file', description: 'Write a complete UTF-8 file in the project.', parameters: schema({ path: string, content: string }), run: args => gate({ tool: 'write_file', args, baseVersion: version(args.path) }, () => { const f = workspacePath(root, args.path, { write: true }); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, args.content); return 'File written.'; }) },
    { name: 'edit_file', description: 'Replace one exact occurrence in a UTF-8 file.', parameters: schema({ path: string, old_text: string, new_text: string }), run: args => {
      const original = read(args.path); if (!args.old_text || original.split(args.old_text).length !== 2) throw new Error('old_text must match exactly once');
      const next = original.replace(args.old_text, () => args.new_text);
      return gate({ tool: 'edit_file', args: { path: args.path, content: next }, baseVersion: hash(original) }, () => { writeFileSync(workspacePath(root, args.path, { write: true }), next); return 'File edited.'; });
    } },
    { name: 'bash', description: 'Run a command in the isolated project; direct network is unavailable. Use network_fetch for an approved destination.', parameters: schema({ command: string }), run: args => gate({ tool: 'bash', args }, () => new Promise((resolve, reject) => {
      const proc = spawn('/bin/bash', ['--noprofile', '--norc', '-c', args.command], { cwd: root, env: { PATH: '/usr/bin:/bin', HOME: '/home/agent', LANG: 'C.UTF-8' }, detached: true });
      let output = ''; const stop = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} };
      const timer = setTimeout(stop, 120_000); signal.addEventListener('abort', stop, { once: true });
      for (const stream of [proc.stdout, proc.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-64000); });
      proc.on('error', reject); proc.on('close', code => { stop(); clearTimeout(timer); signal.removeEventListener('abort', stop); resolve(`${code ? 'ERROR: ' : ''}exit ${code}\n${output}`); });
    })) },
    { name: 'network_fetch', mutating: true, description: 'GET an HTTP(S) URL through the project destination allowlist. No credentials or arbitrary headers.', parameters: schema({ url: string }), run: args => rpc('network.fetch', args) }
  ];
  const context = { bus, runId: input.runId, sessionId: input.sessionId, agentId: input.agent || 'bitcode', cwd: root };
  const target = { spec: input.model, provider: { desktopAgent: input.agent || 'bitcode' }, model: input.model };
  const hooks = { onCheckpoint: messages => send({ type: 'checkpoint', messages }), onUsage: usage => send({ type: 'usage', usage }) };
  const model = request => rpc('model.request', { agent: request.provider.desktopAgent, system: request.system, messages: request.messages, tools: request.tools });
  const system = systemPrompt({ project: { root }, profile: 'code' }) + '\nDesktop mode: remain inside the project. All changes and commands are policy-controlled. Never attempt to approve actions yourself.' + '\n\n' + DESKTOP_CAPABILITIES + (input.systemExtra ? `\n${input.systemExtra}` : '');
  tools.push({ name: 'subagent', serial: true, description: 'Delegate one task to node (research), script (coding), hash (security) or merkle (review).', parameters: schema({ agent: { enum: ['node', 'script', 'hash', 'merkle'] }, prompt: string }), run: args => runSubagent({ ...args, agents: input.agents,
    target: { spec: input.model, model: input.model, provider: { desktopAgent: args.agent } },
    system, tools, parentContext: context, hooks: { onUsage: hooks.onUsage }, callModelImpl: model, signal, limits: input.limits,
    state: sharedState }) });
  const sharedState = { totalToolCalls: 0 };
  try {
    const options = { target, system, messages: input.messages, tools, hooks, context, signal, state: sharedState, limits: input.limits, callModelImpl: model, readOnly: !!input.readOnly };
    const answer = input.agent ? await runSat({ ...options, satId: input.agent, registry: input.sats, persistence: false, guardedTools: true,
      targetForSat: id => ({ ...target, provider: { desktopAgent: id } }) })
      : await runAgent(options);
    if (answer?.startsWith('[stopped:')) send({ type: 'failure', message: answer });
    else send({ type: 'done', answer });
  } catch (e) { send({ type: 'failure', message: e.message, code: e.code, statusCode: e.statusCode }); }
  process.stdin.destroy();
}
