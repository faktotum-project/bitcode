import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createController } from '../core/controller.mjs';
import { hash } from '../core/primitives.mjs';

const config = { model: 'ollama/test', providers: { ollama: { api: 'openai', baseURL: 'http://127.0.0.1:11434/v1', defaultModel: 'test' }, cloud: { api: 'openai', baseURL: 'https://api.example.com/v1', apiKey: 'sk-cloud-secret', defaultModel: 'big' } } };
const tick = () => new Promise(r => setImmediate(r));
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

function setup({ sandbox = { available: true }, callModelImpl } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'bitcode-home-'));
  const root = mkdtempSync(path.join(tmpdir(), 'bitcode-proj-'));
  const events = [], workers = [];
  const spawnWorker = ({ onMessage, onExit, root: wroot }) => {
    const w = { sent: [], root: wroot, onMessage, onExit, pending: new Map(), stopped: false,
      send(msg) { this.sent.push(msg); if (msg.type === 'response') this.pending.get(msg.id)?.(msg); },
      stop() { if (!this.stopped) { this.stopped = true; onExit(null); } },
      request(method, params) { const id = Math.random().toString(36).slice(2); return new Promise(res => { this.pending.set(id, res); onMessage({ type: 'request', id, method, params }); }); } };
    workers.push(w); return w;
  };
  const c = createController({ home, appDir: '/nonexistent', sandbox, spawnWorker, config, emit: (ch, p) => events.push([ch, p]), callModelImpl });
  return { c, home, root, events, workers };
}
async function sessionIn(c, root, mode = 'assisted') {
  const p = await c.invoke('project.open', { path: root });
  return { p, s: await c.invoke('session.create', { projectId: p.projectId, mode }, 'ui:1') };
}
const pendingOf = events => events.filter(([ch, a]) => ch === 'approval' && a.status === 'pending').map(([, a]) => a);

test('approvals: human origin, session binding, digest, single use', async () => {
  const { c, root, events, workers } = setup();
  const { s } = await sessionIn(c, root, 'manual');
  await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'create a file' }, 'ui:1');
  await until(() => workers.length);
  const lease = workers[0].request('mutation.acquire', { tool: 'write_file', args: { path: 'a.txt', content: 'hi\n' }, baseVersion: null });
  await until(() => pendingOf(events).length);
  const a = pendingOf(events)[0];
  assert.equal(a.kind, 'patch'); assert.match(a.subject.unifiedDiff, /\+hi/);
  await assert.rejects(c.invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision: 'approve' }, 'worker'), { code: 'FORBIDDEN_ORIGIN' });
  await assert.rejects(c.invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: 'other', decision: 'approve' }, 'ui:1'), { code: 'APPROVAL_WRONG_SESSION' });
  await assert.rejects(c.invoke('approval.resolve', { requestId: a.id, digest: '0'.repeat(64), sessionId: a.sessionId, decision: 'approve' }, 'ui:1'), { code: 'APPROVAL_DIGEST_MISMATCH' });
  const both = await Promise.allSettled([1, 2].map(() => c.invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision: 'approve' }, 'ui:1')));
  assert.deepEqual(both.map(x => x.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(both.find(x => x.status === 'rejected').reason.code, 'APPROVAL_CONSUMED');
  const res = await lease; assert.ok(res.result.leaseId);
  c.shutdown();
});

test('policy decisions: assisted auto-writes, read-only commands auto, others wait; stale writes rejected', async () => {
  const { c, root, events, workers } = setup();
  writeFileSync(path.join(root, 'f.txt'), 'one\n');
  const { s, p } = await sessionIn(c, root, 'assisted');
  await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'go' }, 'ui:1');
  await until(() => workers.length); const w = workers[0];
  const write = await w.request('mutation.acquire', { tool: 'edit_file', args: { path: 'f.txt', content: 'two\n' }, baseVersion: hash('one\n') });
  assert.ok(write.result.leaseId); await w.request('mutation.release', { leaseId: write.result.leaseId });
  const stale = await w.request('mutation.acquire', { tool: 'write_file', args: { path: 'f.txt', content: 'x' }, baseVersion: hash('old') });
  assert.match(stale.error, /STALE_VERSION/);
  const ro = await w.request('mutation.acquire', { tool: 'bash', args: { command: 'git status' } });
  assert.ok(ro.result.leaseId); await w.request('mutation.release', { leaseId: ro.result.leaseId });
  const cmd = w.request('mutation.acquire', { tool: 'bash', args: { command: 'npm test' } });
  await until(() => pendingOf(events).some(a => a.kind === 'command'));
  // "/approve" typed by the human resolves through the same backend method.
  const a = pendingOf(events).find(x => x.kind === 'command');
  await c.invoke('chat.submit', { sessionId: s.sessionId, text: `/approve ${a.id.slice(4, 14)}` }, 'ui:1');
  assert.ok((await cmd).result.leaseId);
  await w.request('mutation.release', { leaseId: (await cmd).result.leaseId });
  await c.invoke('policy.propose', { projectId: p.projectId, add: { command: 'npm test' } }, 'ui:1');
  assert.ok((await w.request('mutation.acquire', { tool: 'bash', args: { command: 'npm test' } })).result.leaseId, 'policy command is automatic in assisted mode');
  await assert.rejects(c.invoke('policy.propose', { projectId: p.projectId, add: { command: 'rm -rf / ; ls' } }, 'ui:1'), { code: 'INVALID_PARAMS' });
  c.shutdown();
});

test('queue honours maxActive and local inference is serialised across sessions', async () => {
  let inFlight = 0, peak = 0;
  const callModelImpl = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 30)); inFlight--; return { text: 'ok', toolCalls: [], usage: { input_tokens: 3, output_tokens: 2 } }; };
  const { c, root, workers } = setup({ callModelImpl });
  await c.invoke('settings.set', { key: 'maxActive', value: 2 }, 'ui:1');
  const sessions = [];
  for (let i = 0; i < 3; i++) sessions.push((await sessionIn(c, root)).s);
  const runs = [];
  for (const s of sessions) runs.push((await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'hi' }, 'ui:1')).run);
  await until(() => workers.length === 2); await tick();
  assert.equal(workers.length, 2, 'third run stays queued');
  assert.equal((await c.invoke('run.list')).filter(r => r.state === 'queued').length, 1);
  const results = await Promise.all(workers.map(w => w.request('model.request', { agent: 'bitcode', system: 's', messages: [], tools: [] })));
  assert.equal(peak, 1, 'one local inference at a time');
  assert.equal(results[0].result.text, 'ok');
  workers[0].onMessage({ type: 'done', answer: 'ok' });
  await until(() => workers.length === 3);
  const listed = await c.invoke('run.list');
  assert.equal(listed.find(r => r.runId === runs[0].runId).usage.inputTokens, 3);
  c.shutdown();
});

test('local session needs egress approval before a cloud Sat; local-only rejects it', async () => {
  const seen = [];
  const { c, root, events, workers } = setup({ callModelImpl: async req => { seen.push(req.model); return { text: 'x', toolCalls: [] }; } });
  await c.invoke('settings.set', { key: 'satModels', value: { node: 'cloud/big' } }, 'ui:1');
  const { s } = await sessionIn(c, root);
  await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'hi' }, 'ui:1');
  await until(() => workers.length);
  const req = workers[0].request('model.request', { agent: 'node', system: 's', messages: [], tools: [] });
  await until(() => pendingOf(events).some(a => a.kind === 'egress'));
  assert.deepEqual(seen, [], 'no cloud call before consent');
  const a = pendingOf(events).find(x => x.kind === 'egress');
  await c.invoke('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision: 'deny' }, 'ui:1');
  assert.match((await req).error, /POLICY_DENIED/);
  assert.equal(JSON.stringify(events).includes('sk-cloud-secret'), false, 'API key never reaches events');
  workers[0].onMessage({ type: 'done' });
  await c.invoke('settings.set', { key: 'localOnly', value: true }, 'ui:1');
  await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: 'again' }, 'ui:1'), { code: 'LOCAL_ONLY' });
  c.shutdown();
});

test('fail closed without sandbox; user buffers never overwrite newer disk content', async () => {
  const { c, root } = setup({ sandbox: { available: false, detail: 'no bwrap' } });
  const { s, p } = await sessionIn(c, root);
  await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: 'hi' }, 'ui:1'), { code: 'SANDBOX_UNAVAILABLE' });
  writeFileSync(path.join(root, 'b.txt'), 'v1');
  const { version } = await c.invoke('buffer.open', { projectId: p.projectId, path: 'b.txt' });
  writeFileSync(path.join(root, 'b.txt'), 'v2 by agent');
  await assert.rejects(c.invoke('buffer.save', { projectId: p.projectId, path: 'b.txt', text: 'mine', baseVersion: version }), { code: 'STALE_VERSION' });
  assert.equal(readFileSync(path.join(root, 'b.txt'), 'utf8'), 'v2 by agent');
  await assert.rejects(c.invoke('buffer.open', { projectId: p.projectId, path: '../etc/passwd' }), { code: 'PATH_DENIED' });
  await assert.rejects(c.invoke('buffer.save', { projectId: p.projectId, path: '.git/config', text: 'x', baseVersion: null }), { code: 'PATH_DENIED' });
  c.shutdown();
});

test('unattended runs work in a separate worktree, integrated only on request', async () => {
  const { c, root, workers } = setup();
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q'); writeFileSync(path.join(root, 'x.txt'), 'base\n'); g('add', '.'); g('commit', '-qm', 'init');
  writeFileSync(path.join(root, 'x.txt'), 'my uncommitted edit\n');
  const { s } = await sessionIn(c, root, 'unattended');
  const { run } = await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'work' }, 'ui:1');
  await until(() => workers.length);
  assert.notEqual(workers[0].root, root);
  writeFileSync(path.join(workers[0].root, 'new.txt'), 'from agent\n');
  workers[0].onMessage({ type: 'done' });
  assert.equal(existsSync(path.join(root, 'new.txt')), false, 'nothing lands before integration');
  assert.match(await c.invoke('worktree.diff', { runId: run.runId }), /from agent/);
  await c.invoke('worktree.integrate', { runId: run.runId }, 'ui:1');
  assert.equal(readFileSync(path.join(root, 'new.txt'), 'utf8'), 'from agent\n');
  assert.equal(readFileSync(path.join(root, 'x.txt'), 'utf8'), 'my uncommitted edit\n', 'manual edits preserved');
  c.shutdown();
});
