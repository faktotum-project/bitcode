import test from 'node:test';
import assert from 'node:assert/strict';
import { runError, buildFixPrompt } from '../core/run-errors.mjs';

test('diagnostics preserve native codes and HTTP status and classify uncoded failures', () => {
  assert.deepEqual(runError(Object.assign(new Error('rate limited'), { code: 'RATE_LIMIT', statusCode: 429 })),
    { error: 'rate limited', errorCode: 'RATE_LIMIT', errorStatus: 429 });
  assert.equal(runError(new Error('endpoint -> HTTP 401: unauthorized')).errorCode, 'HTTP_401');
  assert.equal(runError(new Error('network error: ECONNREFUSED')).errorCode, 'ECONNREFUSED');
  assert.equal(runError(new Error('[stopped: model output/context limit reached; response is incomplete]')).errorCode, 'MODEL_LIMIT');
  assert.equal(runError(new Error('unexpected response')).errorCode, 'UNCLASSIFIED_ERROR');
  assert.equal(runError(new Error('worker quit'), 'WORKER_EXIT').errorCode, 'WORKER_EXIT');
});

test('fix prompt uses the full original task and failing model, includes focused guidance and redacts secrets', () => {
  const task = 'A'.repeat(170) + 'full task tail';
  const text = buildFixPrompt({
    run: { runId: 'run', sessionId: 'session', state: 'error', root: '/worktree', projectId: 'project',
      config: { model: 'root/model', mode: 'assisted' }, errorModel: 'child/model', errorCode: 'ECONNREFUSED',
      error: 'connection refused; private-key', errorEndpoint: 'http://localhost:11435/v1', prompt: task },
    project: { name: 'Project', root: '/project' }, redact: s => s.replaceAll('private-key', '[redacted]'),
  });
  assert.ok(text.includes(task));
  assert.match(text, /Modello: child\/model/);
  assert.match(text, /Percorso progetto: \/project/);
  assert.match(text, /Workspace di esecuzione: \/worktree/);
  assert.match(text, /raggiungibilità del server/);
  assert.doesNotMatch(text, /private-key/);
});
