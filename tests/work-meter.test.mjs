import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkMeter, datums, workText, closingText, actionText, fmtElapsed, fmtCount, fmtBytes, PHRASE_MS, DATUM_MS, phrasesFor } from '../src/work-meter.mjs';
import { readLocalMemory, isLocalBase, createMemoryProbe } from '../src/local-memory.mjs';

test('formatting is compact and localized', () => {
  assert.equal(fmtElapsed(12400), '12s'); assert.equal(fmtElapsed(64000), '1m 04s');
  assert.equal(fmtCount(842), '842'); assert.equal(fmtCount(1234, 'it'), '1,2k'); assert.equal(fmtCount(1234, 'en'), '1.2k'); assert.equal(fmtCount(15600), '16k');
  assert.equal(fmtBytes(17 * 1024 ** 3), '17 GB'); assert.equal(fmtBytes(4.1 * 1024 ** 3, 'it'), '4,1 GB'); assert.equal(fmtBytes(600 * 1024 ** 2), '600 MB');
});

test('meter estimates while streaming and settles on exact usage', () => {
  let clock = 0; const m = createWorkMeter({ now: () => clock });
  m.onDelta('x'.repeat(400)); clock = 2000; m.onDelta('y'.repeat(400));
  let s = m.snapshot(); assert.equal(s.outTokens, 200); assert.equal(s.speed, 100);
  m.onUsage({ input_tokens: 900, output_tokens: 180 });
  s = m.snapshot(); assert.equal(s.outTokens, 180); assert.equal(s.inTokens, 900);
  m.onUsage({ prompt_tokens: 100, completion_tokens: 20 }); assert.equal(m.snapshot().outTokens, 200);
});

test('one datum at a time, rotating every 3.5 s; phrases every 7 s; actions stay fixed', () => {
  const snap = { elapsed: 12000, inTokens: 3100, outTokens: 1234, speed: 38, action: null, memory: { bytes: 17 * 1024 ** 3, vram: 17 * 1024 ** 3 } };
  assert.deepEqual(datums(snap, 'it'), ['12s', '↑ 3,1k ↓ 1,2k token', '38 tok/s', '17 GB GPU']);
  const at = ms => workText({ id: 'hash', snap, ms, lang: 'it' });
  assert.equal(at(0).datum, '12s'); assert.equal(at(DATUM_MS).datum, '↑ 3,1k ↓ 1,2k token'); assert.equal(at(3 * DATUM_MS).datum, '17 GB GPU'); assert.equal(at(4 * DATUM_MS).datum, '12s');
  assert.notEqual(at(0).phrase, at(PHRASE_MS).phrase); assert.equal(at(0).phrase, at(PHRASE_MS - 1).phrase);
  assert.ok(phrasesFor('hash', 'it').includes(at(0).phrase));
  assert.equal(workText({ id: 'hash', snap: { ...snap, action: 'legge src/a.js' }, ms: 9000, lang: 'it' }).datum, 'legge src/a.js · 12s');
  assert.deepEqual(datums({ elapsed: 800, inTokens: 0, outTokens: 0 }, 'it'), ['0s']); // nothing is invented
});

test('closing line and action wording', () => {
  assert.equal(closingText({ outcome: 'ok', snap: { elapsed: 14000, inTokens: 3100, outTokens: 1234, speed: 38, memory: { bytes: 4.1 * 1024 ** 3, vram: 0 } }, lang: 'it' }), 'Fatto · 14s · ↑ 3,1k ↓ 1,2k token · 38 tok/s · 4,1 GB RAM');
  assert.equal(closingText({ outcome: 'error', snap: { elapsed: 3000, inTokens: 0, outTokens: 0 }, lang: 'en' }), 'Pausing to breathe · 3s');
  assert.equal(closingText({ outcome: 'cancelled', snap: { elapsed: 3000, inTokens: 0, outTokens: 0 }, lang: 'it' }), 'Interrotto · 3s');
  assert.equal(actionText({ tool: 'read_file', summary: 'read_file · src/webhooks.js' }, 'it'), 'legge src/webhooks.js');
  assert.equal(actionText({ tool: 'bash', summary: 'Esecuzione comando' }, 'en'), 'running a command');
});

test('local memory: Ollama reports exactly, other runtimes by process, cloud never', async () => {
  assert.equal(isLocalBase('http://127.0.0.1:11434/v1'), true); assert.equal(isLocalBase('https://api.openai.com/v1'), false);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3-coder:30b', size: 20 * 1024 ** 3, size_vram: 18 * 1024 ** 3 }, { name: 'other:1b', size: 1024 ** 3, size_vram: 0 }] }) });
  assert.deepEqual(await readLocalMemory({ providerName: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen3-coder:30b', fetchImpl }), { bytes: 20 * 1024 ** 3, vram: 18 * 1024 ** 3, source: 'ollama' });
  const execImpl = (cmd, args, opts, cb) => cb(null, '  4194304 llama-server\n   100 bash\n');
  assert.deepEqual(await readLocalMemory({ providerName: 'llamacpp', baseURL: 'http://127.0.0.1:8080/v1', model: 'x', fetchImpl: async () => { throw new Error('no'); }, execImpl }), { bytes: 4194304 * 1024, vram: 0, source: 'process' });
  assert.equal(await readLocalMemory({ providerName: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'x', fetchImpl }), null);
  const probe = createMemoryProbe({ baseURL: 'https://api.anthropic.com' }); assert.equal(probe.get(), null); probe.stop();
});
