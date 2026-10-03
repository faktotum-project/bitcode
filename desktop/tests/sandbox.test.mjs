// End-to-end: the bundled worker runs inside bwrap, asks the controller for the
// model and for a write lease, and cannot see the host home or the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createController } from '../core/controller.mjs';
import { probeSandbox, spawnWorker } from '../core/sandbox.mjs';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const sandbox = probeSandbox();
const config = { model: 'ollama/test', providers: { ollama: { api: 'openai', baseURL: 'http://127.0.0.1:11434/v1', defaultModel: 'test' } } };

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
