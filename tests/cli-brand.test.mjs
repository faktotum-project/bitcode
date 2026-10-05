import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCaps } from '../src/term-caps.mjs';
import { pulse, satGlyph, headerLine, WORDMARK } from '../src/cli-brand.mjs';
import { createLiveLine } from '../src/cli-live.mjs';
import { loadSats } from '../src/sats.mjs';

const tty = { isTTY: true, columns: 100, write() { return true; } };
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

test('capability levels degrade safely', () => {
  const env = { LANG: 'it_IT.UTF-8', COLORTERM: 'truecolor', TERM: 'xterm-256color' };
  assert.equal(detectCaps({ env, stdout: tty, stderr: tty }).level, 'full');
  assert.equal(detectCaps({ env: { ...env, NO_COLOR: '1' }, stdout: tty, stderr: tty }).level, 'text');
  assert.equal(detectCaps({ env: { ...env, CI: 'true' }, stdout: tty, stderr: tty }).level, 'reduced');
  assert.equal(detectCaps({ env: { ...env, BITCODE_REDUCE_MOTION: '1' }, stdout: tty, stderr: tty }).level, 'reduced');
  assert.equal(detectCaps({ env: { ...env, COLORTERM: '' }, stdout: tty, stderr: tty }).level, 'reduced');
  assert.equal(detectCaps({ env: { ...env, TERM: 'linux' }, stdout: tty, stderr: tty }).level, 'text');
  assert.equal(detectCaps({ env: { ...env, LANG: 'C' }, stdout: tty, stderr: tty }).level, 'text');
  assert.equal(detectCaps({ env, stdout: { isTTY: false }, stderr: tty }).level, 'text'); // piped output
  assert.equal(detectCaps({ env: { ...env, BITCODE_UI: 'full' }, stdout: { isTTY: false }, stderr: tty }).level, 'text'); // never animate into a pipe
  assert.equal(detectCaps({ env: { ...env, BITCODE_UI: 'text' }, stdout: tty, stderr: tty }).level, 'text');
});

test('header is one line: orange b, model, and the network named once', () => {
  const colored = headerLine('ollama/m:26b', 'signet', { color: true });
  assert.equal(strip(colored), 'bitcode  agent · ollama/m:26b · signet');
  assert.equal(strip(colored).split('signet').length - 1, 1);
  assert.equal(headerLine('m', 'signet', { color: false }), 'bitcode  agent · m · signet');
  for (let n = 1; n < WORDMARK.length; n++) assert.equal(strip(headerLine('m', 'signet', { color: true }, n)), WORDMARK.slice(0, n)); // typing frames stay on one line
  assert.equal(headerLine('m', null, { color: false }), 'bitcode  agent · m');
});

test('pulse stays in range and waiting breathes deeper than rest', () => {
  for (const s of ['idle', 'thinking', 'reading', 'running', 'drafting', 'waiting', 'happy', 'concerned', 'planning']) {
    for (let ms = 0; ms < 8000; ms += 97) { const k = pulse(s, ms); assert.ok(k >= 0 && k <= 1.0001, `${s} ${k}`); }
  }
  const range = s => { const v = Array.from({ length: 200 }, (_, i) => pulse(s, i * 40)); return Math.max(...v) - Math.min(...v); };
  assert.ok(range('waiting') > range('idle'));
  assert.equal(strip(satGlyph('hash', 'idle', 0, { level: 'full' })), '⬢');
  assert.equal(satGlyph('hash', 'idle', 0, { level: 'text' }), '*');
});

function fakeStreams() {
  const log = [];
  const mk = name => ({ isTTY: true, columns: 90, write(c) { log.push([name, String(c)]); return true; } });
  return { stdout: mk('out'), stderr: mk('err'), log };
}
const FULL = { level: 'full', tty: true, color: true };
const noMemory = { get: () => null, stop() {} };

test('live line shows a phrase and one datum, never interleaves, and closes with a fixed line', () => {
  const { stdout, stderr, log } = fakeStreams();
  let clock = 1000;
  const live = createLiveLine({ caps: FULL, registry: loadSats(), lang: 'it', subject: { satId: 'script' }, stdout, stderr, now: () => clock, interval: 0, memoryProbe: noMemory });
  live.onEvent({ type: 'model.started', agentId: 'script', data: {} });
  assert.equal(log.length, 0, 'not drawn before the quiet period');
  clock += 400; live.tick();
  assert.match(strip(log.at(-1)[1]), /Script · (Intreccia il codice|Dà forma|Lavora con calma|Cura ogni riga)…\s+0s/);
  const drawn = log.length;
  stdout.write('streamed text');
  assert.match(log[drawn][1], /\r\x1b\[2K/); assert.equal(log[drawn + 1][1], 'streamed text');
  clock += 1000; live.tick();
  assert.equal(log.length, drawn + 2, 'mid-line output: do not draw');
  stdout.write(' more\n'); live.hooks.onUsage({ input_tokens: 3100, output_tokens: 1234 }); clock += 4000; live.tick();
  const line = strip(log.at(-1)[1]);
  assert.match(line, /(↑ 3,1k ↓ 1,2k token|5s)/);
  live.onEvent({ type: 'tool.started', agentId: 'script', data: { tool: 'read_file', summary: 'read_file · src/webhooks.js' } });
  clock += 500; live.tick();
  assert.match(strip(log.at(-1)[1]), /legge src\/webhooks\.js · 5s/);
  live.onEvent({ type: 'approval.requested', agentId: 'script', data: {} });
  clock += 500; live.tick();
  assert.match(strip(log.at(-1)[1]), /Script · Aspetta il tuo sì$/);
  live.stop('ok');
  assert.match(strip(log.at(-1)[1]), /^■ Script · Fatto · 6s · ↑ 3,1k ↓ 1,2k token\n$/);
  stdout.write('after'); assert.equal(log.at(-1)[1], 'after');
});

test('local memory joins the rotation and the closing line', () => {
  const { stdout, stderr, log } = fakeStreams();
  let clock = 0;
  const live = createLiveLine({ caps: FULL, registry: loadSats(), lang: 'en', subject: {}, stdout, stderr, now: () => clock, interval: 0, memoryProbe: { get: () => ({ bytes: 17 * 1024 ** 3, vram: 17 * 1024 ** 3 }), stop() {} } });
  live.hooks.onUsage({ output_tokens: 500 }); clock = 3500 * 2 + 100; live.tick();
  assert.match(strip(log.at(-1)[1]), /● .+…\s+17 GB GPU/);
  live.stop('ok');
  assert.match(strip(log.at(-1)[1]), /Done · 7s · ↓ 500 tokens · 17 GB GPU/);
});

test('reduced and text levels never animate or touch the streams; they only close on a terminal', () => {
  for (const [caps, expectLine] of [[{ level: 'reduced', tty: true, color: true }, true], [{ level: 'text', tty: false, color: false }, false]]) {
    const { stdout, stderr, log } = fakeStreams();
    const before = stdout.write;
    const live = createLiveLine({ caps, registry: loadSats(), subject: { satId: 'node' }, stdout, stderr, interval: 0, memoryProbe: noMemory });
    live.onEvent({ type: 'model.started', agentId: 'node', data: {} });
    assert.equal(stdout.write, before); assert.equal(log.length, 0);
    live.stop('error');
    assert.equal(log.length, expectLine ? 1 : 0);
    if (expectLine) assert.match(strip(log[0][1]), /Node · Si ferma e respira · 0s/);
  }
});

import { diffLine, box, reviewCard, financeBox, welcomeSats } from '../src/cli-brand.mjs';
const full = { level: 'full', color: true }, text = { level: 'text', color: false };

test('diff gutter, boxes and cards keep their facts and fall back to plain text', () => {
  assert.equal(diffLine('+added', text), '+added');
  assert.equal(strip(diffLine('+added', full)), '▎+added');
  assert.equal(strip(diffLine('-gone', full)), '▎-gone');
  assert.equal(strip(diffLine('+++ b/x', full)), '+++ b/x');
  const lines = box('Titolo', ['uno', 'due più lungo'], full).split('\n').map(l => strip(l));
  assert.equal(new Set(lines.map(l => [...l].length)).size, 1, 'all box rows have the same width');
  const p = { network: 'signet', wallet: 'w.json', to: 'tb1qxyz', amountSats: 20000, feeSats: 1128, feeRate: 8, expiresAt: '2026-10-05T11:00:00Z', id: 'prop_1' };
  const card = strip(reviewCard(p, full, 'it'));
  for (const fact of ['tb1qxyz', '20.000', '1128', 'prop_1', 'signet', 'Niente viene firmato finché non confermi']) assert.ok(card.includes(fact), fact);
  assert.ok(strip(reviewCard(p, full, 'en')).includes('Nothing is signed until you confirm'));
  assert.match(strip(financeBox({ policy: { maxPaymentSats: 50000, dailyLimitSats: 200000, maxFeeSats: 2000, minReserveSats: 100000 }, proposals: [] }, full, 'it')), /Massimo per pagamento\s+50\.000 sat/);
  assert.match(strip(financeBox({ policy: null, proposals: [] }, full, 'en')), /No policy yet/);
  assert.match(strip(welcomeSats(loadSats())), /Node.*Script.*Hash.*Merkle/);
});
