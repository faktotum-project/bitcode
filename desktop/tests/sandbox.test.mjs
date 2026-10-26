// End-to-end: the bundled worker runs inside bwrap, asks the controller for the
// model and for a write lease, and cannot see the host home or the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createController } from '../core/controller.mjs';
import { probeSandbox, spawnWorker } from '../core/sandbox.mjs';
import { satHistory } from '../../src/sat-workspace.mjs';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const sandbox = probeSandbox();
const config = { model: 'ollama/test', providers: { ollama: { api: 'openai', baseURL: 'http://127.0.0.1:11434/v1', defaultModel: 'test' } } };

test('Merkle delegates to Script in the desktop sandbox with human approval and host-only history', { skip: !sandbox.available || !existsSync(path.join(dist, 'worker.mjs')), timeout: 30000 }, async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bitcode-sat-home-')), root = mkdtempSync(path.join(tmpdir(), 'bitcode-sat-proj-'));
  const events = []; let step = 0;
  const c = createController({ home, appDir: dist, sandbox, config, emit: (ch, p) => events.push([ch, p]),
    spawnWorker: opts => spawnWorker({ ...opts, runtime: process.execPath }),
    callModelImpl: async ({ tools }) => {
      const turns = [
        () => { assert.ok(tools.some(t => t.name === 'sat_delegate')); return { toolCalls: [{ id: 'd1', name: 'sat_delegate', args: { agent: 'script', prompt: 'write hello' } }] }; },
        () => { assert.ok(!tools.some(t => t.name === 'sat_delegate')); return { toolCalls: [{ id: 'w1', name: 'write_file', args: { path: 'sat.txt', content: 'Sat Runtime\n' } }] }; },
        () => ({ text: 'written' }), () => ({ text: 'verified by Script' }),
      ];
      return turns[step++]();
    } });
  try {
    const p = await c.invoke('project.open', { path: root });
    const s = await c.invoke('session.create', { projectId: p.projectId, mode: 'manual' }, 'ui:1');
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/sat merkle' }, 'ui:1');
    const { run } = await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'implement' }, 'ui:1');
    const until = async fn => { const end = Date.now() + 15000; while (!fn()) { if (Date.now() > end) throw new Error(JSON.stringify(events.slice(-5))); await new Promise(r => setTimeout(r, 10)); } };
    await until(() => events.some(([ch, a]) => ch === 'approval' && a.status === 'pending'));
    const a = events.find(([ch, a]) => ch === 'approval' && a.status === 'pending')[1];
    assert.equal(a.subject.agentId, 'script'); assert.equal(existsSync(path.join(root, 'sat.txt')), false);
    await c.invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: s.sessionId, decision: 'approve' }, 'ui:1');
    await until(() => events.some(([ch, r]) => ch === 'run' && r.runId === run.runId && r.endedAt));
    assert.equal(events.filter(([ch, r]) => ch === 'run' && r.runId === run.runId).at(-1)[1].state, 'success');
    assert.equal(readFileSync(path.join(root, 'sat.txt'), 'utf8'), 'Sat Runtime\n');
    assert.equal(satHistory('script', { home, cwd: root }).length, 1);
    assert.equal(satHistory('merkle', { home, cwd: root }).length, 1);
    assert.ok(events.some(([ch, e]) => ch === 'sat' && e.type === 'delegation:start'));
    assert.ok(events.some(([ch, e]) => ch === 'sat' && e.state === 'waiting_approval'));
  } finally { c.shutdown(); }
});

test('sandboxed worker writes through the controller and is isolated', { skip: !sandbox.available || !existsSync(path.join(dist, 'worker.mjs')) ? 'needs bwrap and npm run build' : false, timeout: 30000 }, async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bitcode-home-')), root = mkdtempSync(path.join(tmpdir(), 'bitcode-proj-'));
  let step = 0; const toolOutputs = [];
  const callModelImpl = async ({ messages }) => {
    for (const m of messages) if (m.role === 'tool') toolOutputs.push(m.content);
    step++;
    if (step === 1) return { text: '', toolCalls: [
      { id: 'c1', name: 'write_file', args: { path: 'hello.txt', content: 'from the sandbox\n' } },
      { id: 'c2', name: 'bash', args: { command: `ls ${homedir()} ; cat /etc/hostname ; getent hosts example.com || echo NO_NET` } }] };
    return { text: 'done', toolCalls: [] };
  };
  const events = [];
  const c = createController({ home, appDir: dist, sandbox, config, callModelImpl, emit: (ch, p) => events.push([ch, p]),
    spawnWorker: opts => spawnWorker({ ...opts, runtime: process.execPath }) });
  const p = await c.invoke('project.open', { path: root });
  const s = await c.invoke('session.create', { projectId: p.projectId, mode: 'assisted' }, 'ui:1');
  const { run } = await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'write hello' }, 'ui:1');
  // The bash command contains shell syntax: it must wait for a human decision.
  const until = async fn => { const end = Date.now() + 20000; while (!fn()) { if (Date.now() > end) throw new Error('timeout ' + JSON.stringify(events.slice(-5))); await new Promise(r => setTimeout(r, 20)); } };
  await until(() => events.some(([ch, a]) => ch === 'approval' && a.status === 'pending'));
  const a = events.find(([ch, x]) => ch === 'approval' && x.status === 'pending')[1];
  assert.equal(a.kind, 'command');
  await c.invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision: 'approve' }, 'ui:1');
  await until(() => events.some(([ch, r]) => ch === 'run' && r.runId === run.runId && r.endedAt));
  const final = events.filter(([ch, r]) => ch === 'run' && r.runId === run.runId).at(-1)[1];
  assert.equal(final.state, 'success', final.error);
  assert.equal(readFileSync(path.join(root, 'hello.txt'), 'utf8'), 'from the sandbox\n');
  const out = toolOutputs.join('\n');
  assert.match(out, /NO_NET/);
  assert.match(out, /No such file|cannot access/, 'host home is not mounted');
  assert.ok(events.some(([ch, e]) => ch === 'feed' && e.type === 'run.started'));
  c.shutdown();
});

test('sandboxed worker uses the CLI file tools: edits[], grep and glob, never listing denied paths', { skip: !sandbox.available || !existsSync(path.join(dist, 'worker.mjs')) ? 'needs bwrap and npm run build' : false, timeout: 30000 }, async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bitcode-home-')), root = mkdtempSync(path.join(tmpdir(), 'bitcode-proj-'));
  mkdirSync(path.join(root, '.ssh')); writeFileSync(path.join(root, '.ssh', 'id'), 'needle secret\n');
  writeFileSync(path.join(root, 'a.js'), 'const needle = 1;\nconst other = 2;\n');
  let step = 0, schema = null; const toolOutputs = [];
  const callModelImpl = async ({ messages, tools }) => {
    for (const m of messages) if (m.role === 'tool') toolOutputs.push(m.content);
    schema ??= tools.find(t => t.name === 'edit_file')?.parameters;
    if (++step === 1) return { text: '', toolCalls: [
      { id: 'g1', name: 'grep', args: { pattern: 'needle' } },
      { id: 'g2', name: 'glob', args: { pattern: '**/*' } },
      { id: 'e1', name: 'edit_file', args: { path: 'a.js', edits: [{ old_string: 'needle = 1', new_string: 'needle = 10' }, { old_string: 'other = 2', new_string: 'other = 20' }] } }] };
    return { text: 'done', toolCalls: [] };
  };
  const events = [];
  const c = createController({ home, appDir: dist, sandbox, config, callModelImpl, emit: (ch, p) => events.push([ch, p]),
    spawnWorker: opts => spawnWorker({ ...opts, runtime: process.execPath }) });
  const p = await c.invoke('project.open', { path: root });
  const s = await c.invoke('session.create', { projectId: p.projectId, mode: 'assisted' }, 'ui:1');
  const { run } = await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'edit' }, 'ui:1');
  const end = Date.now() + 20000;
  while (!events.some(([ch, r]) => ch === 'run' && r.runId === run.runId && r.endedAt)) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); }
  const final = events.filter(([ch, r]) => ch === 'run' && r.runId === run.runId).at(-1)[1];
  assert.equal(final.state, 'success', final.error);
  assert.ok(schema?.properties?.edits, 'edit_file exposes the CLI edits[] schema');
  assert.equal(readFileSync(path.join(root, 'a.js'), 'utf8'), 'const needle = 10;\nconst other = 20;\n');
  const out = toolOutputs.join('\n');
  assert.match(out, /a\.js:1:const needle = 1;/);
  assert.doesNotMatch(out, /\.ssh/);
  c.shutdown();
});
