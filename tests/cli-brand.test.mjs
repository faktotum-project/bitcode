import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCaps } from '../src/term-caps.mjs';
import { logoRows, LOGO_PIECES, LOGO_WIDTH, pulse, satGlyph, headerRows } from '../src/cli-brand.mjs';
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

test('pixel b assembles piece by piece and keeps a fixed width', () => {
  const widths = new Set(), filled = [];
  for (let n = 0; n <= LOGO_PIECES; n++) {
    const rows = logoRows(n, { color: false });
    assert.equal(rows.length, 3);
    rows.forEach(r => widths.add(r.length));
    filled.push(rows.join('').replace(/ /g, '').length);
  }
  assert.deepEqual([...widths], [LOGO_WIDTH]);
  assert.equal(filled[0], 0);
  assert.ok(filled.every((n, i) => i === 0 || n >= filled[i - 1]));
  assert.equal(logoRows(LOGO_PIECES, { color: false }).join('\n'), '██▀▀██  \n██▀▀  ██\n▀▀▀▀    ');
});

test('pulse stays in range and waiting breathes deeper than rest', () => {
  for (const s of ['idle', 'thinking', 'reading', 'running', 'drafting', 'waiting', 'happy', 'concerned', 'planning']) {
    for (let ms = 0; ms < 8000; ms += 97) { const k = pulse(s, ms); assert.ok(k >= 0 && k <= 1.0001, `${s} ${k}`); }
  }
  const range = s => { const v = Array.from({ length: 200 }, (_, i) => pulse(s, i * 40)); return Math.max(...v) - Math.min(...v); };
  assert.ok(range('waiting') > range('idle'));
  assert.equal(strip(satGlyph('hash', 'idle', 0, { level: 'full' })), '⬢');
  assert.equal(satGlyph('hash', 'idle', 0, { level: 'text' }), '*');
  assert.equal(strip(headerRows('m/x', 'signet', { color: false }).join('')).includes('bitcode'), true);
});

function fakeStreams() {
  const log = [];
  const mk = name => ({ isTTY: true, columns: 90, write(c) { log.push([name, String(c)]); return true; } });
  return { stdout: mk('out'), stderr: mk('err'), log };
}

test('live line never interleaves: erased before foreign output, redrawn only when quiet at line start', () => {
  const { stdout, stderr, log } = fakeStreams();
  let clock = 1000;
  const live = createLiveLine({ caps: { level: 'full', tty: true, color: true }, registry: loadSats(), lang: 'it', stdout, stderr, now: () => clock, interval: 0 });
  live.onSatEvent({ type: 'sat:state', satId: 'script', state: 'writing' });
  assert.equal(log.length, 0, 'not drawn before the quiet period');
  clock += 400; live.tick();
  assert.match(log.at(-1)[1], /Script/); assert.match(strip(log.at(-1)[1]), /intreccia il codice · scrive/);
  const drawn = log.length;
  stdout.write('streamed text'); // foreign write: line is erased first
  assert.match(log[drawn][1], /\r\x1b\[2K/); assert.equal(log[drawn + 1][1], 'streamed text');
  clock += 1000; live.tick();
  assert.equal(log.length, drawn + 2, 'mid-line output: do not draw');
  stdout.write(' more\n'); clock += 1000; live.tick();
  assert.match(strip(log.at(-1)[1]), /Script/);
  live.onSatEvent({ type: 'sat:state', satId: 'script', state: 'success' });
  live.stop();
  assert.match(strip(log.at(-1)[1]), /Script · in equilibrio/);
  assert.ok(log.at(-1)[1].endsWith('\n'));
  stdout.write('after'); assert.equal(log.at(-1)[1], 'after'); // writes restored, nothing extra
});

test('static levels print one line per change and never touch the streams', () => {
  const { stdout, stderr, log } = fakeStreams();
  const before = stdout.write;
  const live = createLiveLine({ caps: { level: 'text', tty: false, color: false }, registry: loadSats(), stdout, stderr });
  live.onSatEvent({ type: 'sat:state', satId: 'node', state: 'reading' });
  live.stop();
  assert.equal(log.length, 0);
  assert.equal(stdout.write, before);
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
  assert.match(strip(welcomeSats(loadSats(), full, 'it')), /Node.*Script.*Hash.*Merkle/);
});
