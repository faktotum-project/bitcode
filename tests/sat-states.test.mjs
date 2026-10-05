import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_STATES, visualState, satStateLabel, satStateTable, satEthics, satLang } from '../src/sat-states.mjs';
import { SAT_STATES } from '../src/sat-events.mjs';
import { SAT_IDS } from '../src/sats/policy.mjs';

test('every event state maps to a visual state and every Sat/language has a label for each', () => {
  for (const s of SAT_STATES) assert.ok(VISUAL_STATES.includes(visualState(s)), s);
  for (const lang of ['it', 'en']) for (const id of SAT_IDS) {
    const table = satStateTable(id, lang);
    assert.equal(table.length, VISUAL_STATES.length);
    for (const x of table) assert.ok(x.label && x.plain && x.text.includes(' · '));
  }
});

test('base wording, per-Sat nuance and the plain word', () => {
  assert.equal(satStateLabel('merkle', 'planning', 'it').text, 'raccoglie i rami · pensa');
  assert.equal(satStateLabel('script', 'writing', 'en').text, 'weaving the code · writing');
  assert.equal(satStateLabel('hash', 'error', 'it').label, 'ha trovato qualcosa: guardiamo insieme');
  assert.equal(satStateLabel('node', 'waiting_approval', 'it').text, 'aspetta il tuo sì · attende la tua conferma');
  assert.equal(satStateLabel('node', 'unknown-state', 'it').state, 'thinking');
});

test('ethics lines follow the real manifest permissions only', () => {
  assert.deepEqual(satEthics({ wallet: 'deny', network: 'allow' }, 'it'), ['il portafoglio resta chiuso']);
  assert.deepEqual(satEthics({ wallet: 'deny', network: 'deny' }, 'en'), ['the wallet stays closed', 'working sheltered, offline']);
  assert.deepEqual(satEthics({}, 'it'), []);
});

test('language detection', () => {
  assert.equal(satLang({ LANG: 'it_IT.UTF-8' }), 'it');
  assert.equal(satLang({ BITCODE_LANG: 'en', LANG: 'it_IT.UTF-8' }), 'en');
  assert.equal(satLang({}), 'en');
});
