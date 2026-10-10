import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { setup, sessionIn, until, tick, config } from './helpers.mjs';
import { hash } from '../core/primitives.mjs';

const pendingOf = events => events.filter(([ch, a]) => ch === 'approval' && a.status === 'pending').map(([, a]) => a);

test('model errors survive RPC and worker failure with copyable, redacted diagnostics', async () => {
  const { c, root, workers } = setup({ callModelImpl: async () => {
    throw Object.assign(new Error('endpoint rejected sk-cloud-secret'), { statusCode: 401 });
  } });
  try {
    const { s } = await sessionIn(c, root);
    await c.invoke('session.update', { sessionId: s.sessionId, model: 'cloud/big' });
    const prompt = 'A'.repeat(170) + ' original request tail';
    const { run } = await c.invoke('chat.submit', { sessionId: s.sessionId, text: prompt }, 'ui:1');
    await until(() => workers.length);
    await assert.rejects(c.invoke('run.diagnostics', { runId: run.runId }), { code: 'INVALID_PARAMS' });
    const response = await workers[0].request('model.request', { agent: 'bitcode', messages: [], tools: [] });
    assert.equal(response.errorCode, 'HTTP_401'); assert.equal(response.statusCode, 401);
    assert.doesNotMatch(response.error, /sk-cloud-secret/);
    // A legacy worker may send only text; use the host's structured model error.
    workers[0].onMessage({ type: 'failure', message: 'model request failed' });
    const listed = (await c.invoke('run.list')).find(r => r.runId === run.runId);
    assert.equal(listed.state, 'error'); assert.equal(listed.errorCode, 'HTTP_401'); assert.equal(listed.errorStatus, 401);
    const details = await c.invoke('run.diagnostics', { runId: run.runId });
    assert.ok(details.fixPrompt.includes(prompt)); assert.ok(details.fixPrompt.includes(root));
    assert.match(details.fixPrompt, /Verifica configurazione delle credenziali/);
    assert.doesNotMatch(JSON.stringify(details), /sk-cloud-secret/);
    assert.match(details.fixPrompt, /Modello: cloud\/big/);
  } finally { c.shutdown(); }
});

test('worker exits and non-provider failures expose their diagnostic codes', async () => {
  const { c, root, workers } = setup();
  try {
    const { s } = await sessionIn(c, root);
    const first = (await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'first' }, 'ui:1')).run;
    await until(() => workers.length);
    workers[0].onExit(Object.assign(new Error('sandbox exited'), { code: 'WORKER_EXIT' }));
    assert.equal((await c.invoke('run.diagnostics', { runId: first.runId })).errorCode, 'WORKER_EXIT');
    const second = (await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'second' }, 'ui:1')).run;
    await until(() => workers.length === 2);
    workers[1].onMessage({ type: 'failure', message: 'permission denied', code: 'EACCES' });
    assert.equal((await c.invoke('run.diagnostics', { runId: second.runId })).errorCode, 'EACCES');
  } finally { c.shutdown(); }
});

test('Sat commands share registry, persist selection and expose project-scoped identity', async () => {
  const { c, root, workers } = setup();
  try {
    const { s } = await sessionIn(c, root);
    const command = text => c.invoke('chat.submit', { sessionId: s.sessionId, text }, 'ui:1');
    assert.deepEqual((await command('/sats')).result.map(s => s.id), ['node', 'script', 'hash', 'merkle']);
    assert.equal((await command('/sat merkle')).result.satId, 'merkle');
    assert.equal((await c.invoke('session.open', { sessionId: s.sessionId })).satId, 'merkle');
    const info = (await command('/sat info merkle')).result;
    assert.equal(info.permissions.wallet, 'deny'); assert.deepEqual(info.history, []);
    assert.equal((await command('/sat workspace merkle')).result.workspace, info.workspace);
    await assert.rejects(command('/sat ../../escape'));
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: 'implement' }, 'ui:1');
    await until(() => workers.length);
    assert.equal(workers[0].sent[0].agent, 'merkle');
    assert.equal(workers[0].sent[0].sats.length, 4);
    await assert.rejects(command('/sat hash'), { code: 'BUSY' });
  } finally { c.shutdown(); }
});

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

test('slash commands: catalogue, /model, /plan read-only with saved plan, /build, CLI-only and unknown', async () => {
  const { c, home, root, workers } = setup();
  const previous = process.env.BITCODE_HOME; process.env.BITCODE_HOME = home;
  try {
    const { s, p } = await sessionIn(c, root);
    const list = await c.invoke('commands.list', { projectId: p.projectId });
    for (const name of ['help', 'plan', 'build', 'model', 'models', 'status', 'repo:review']) assert.ok(list.some(x => x.name === name), name);
    assert.equal(list.find(x => x.name === 'btc:fees').scope, 'cli');
    const help = await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/help' }, 'ui:1');
    assert.ok(help.result.commands.length >= list.length - 1);
    await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: '/model nope/x' }, 'ui:1'), { code: 'PROVIDER_UNAVAILABLE' });
    const switched = await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/model ollama/qwen3:8b' }, 'ui:1');
    assert.equal(switched.result.session.model, 'ollama/qwen3:8b');
    await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: '/btc:fees' }, 'ui:1'), { code: 'CLI_ONLY' });
    await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: '/compact' }, 'ui:1'), { code: 'CLI_ONLY' });
    await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: '/nonexistent' }, 'ui:1'), { code: 'UNKNOWN_COMMAND' });
    await assert.rejects(c.invoke('chat.submit', { sessionId: s.sessionId, text: '/build' }, 'ui:1'), { code: 'NOT_FOUND' });
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/plan add a fee test' }, 'ui:1');
    await until(() => workers.length === 1);
    const start = workers[0].sent.find(m => m.type === 'start');
    assert.equal(start.readOnly, true); assert.match(start.systemExtra, /Do not implement/); assert.equal(start.model, 'ollama/qwen3:8b');
    workers[0].onMessage({ type: 'done', answer: '1. edit fees.mjs\n2. run tests' });
    const status = await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/status' }, 'ui:1');
    assert.ok(status.result.status.plan);
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/build' }, 'ui:1');
    await until(() => workers.length === 2);
    const build = workers[1].sent.find(m => m.type === 'start');
    assert.equal(build.readOnly, false); assert.match(build.messages.at(-1).content, /edit fees\.mjs/);
    workers[1].onMessage({ type: 'done' });
    await c.invoke('chat.submit', { sessionId: s.sessionId, text: '/repo:review the fee module' }, 'ui:1');
    await until(() => workers.length === 3);
    assert.match(workers[2].sent.find(m => m.type === 'start').messages.at(-1).content, /the fee module/);
  } finally { if (previous === undefined) delete process.env.BITCODE_HOME; else process.env.BITCODE_HOME = previous; c.shutdown(); }
});

test('unattended mode is refused up front, with a precise reason, until the project has a repository and a first commit', async () => {
  const { c, root } = setup();
  const p = await c.invoke('project.open', { path: root });
  await assert.rejects(() => c.invoke('session.create', { projectId: p.projectId, mode: 'unattended' }, 'ui:1'), e => e.code === 'WORKTREE_NO_REPO');
  const s = await c.invoke('session.create', { projectId: p.projectId, mode: 'assisted' }, 'ui:1');
  await assert.rejects(() => c.invoke('mode.set', { sessionId: s.sessionId, mode: 'unattended' }, 'ui:1'), e => e.code === 'WORKTREE_NO_REPO');
  assert.deepEqual(await c.invoke('git.status', { projectId: p.projectId }), { repo: false, branch: null, files: [], hasCommits: false });
  assert.equal((await c.invoke('git.init', { projectId: p.projectId }, 'ui:1')).repo, true);
  await assert.rejects(() => c.invoke('mode.set', { sessionId: s.sessionId, mode: 'unattended' }, 'ui:1'), e => e.code === 'WORKTREE_NO_COMMIT');
  assert.equal((await c.invoke('git.status', { projectId: p.projectId })).hasCommits, false);
  const git = args => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
  writeFileSync(path.join(root, 'a.txt'), 'a'); git(['add', '.']); git(['commit', '-qm', 'first']);
  assert.equal((await c.invoke('mode.set', { sessionId: s.sessionId, mode: 'unattended' }, 'ui:1')).mode, 'unattended');
  await assert.rejects(() => c.invoke('git.init', { projectId: p.projectId }, 'ui:1'), /Already a Git repository/);
  await assert.rejects(() => c.invoke('git.init', { projectId: p.projectId }, 'worker:1'), e => e.code === 'FORBIDDEN_ORIGIN');
});
