import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_STATES, visualState, essentialState, satStateLabel, satStateTable, satEthics, satLang } from '../src/sat-states.mjs';
import { SAT_STATES } from '../src/sat-events.mjs';
import { SAT_IDS } from '../src/sats/policy.mjs';

test('every event state maps to a visual state and to one of four essential states', () => {
  for (const s of SAT_STATES) assert.ok(VISUAL_STATES.includes(visualState(s)), s);
  const seen = new Set(SAT_STATES.map(essentialState));
  assert.deepEqual([...seen].sort(), ['done', 'idle', 'problem', 'waiting', 'working']);
});

test('a resting Sat has no label; the others carry one short wording in both languages', () => {
  for (const lang of ['it', 'en']) for (const id of SAT_IDS) {
    assert.equal(satStateLabel(id, 'idle', lang).label, '');
    for (const s of ['thinking', 'waiting_approval', 'success', 'error']) assert.ok(satStateLabel(id, s, lang).label.length > 0);
    assert.ok(satStateTable(id, lang).length >= 3);
  }
  assert.equal(satStateLabel('node', 'waiting_approval', 'it').label, 'aspetta il tuo sì');
  assert.equal(satStateLabel('script', 'writing', 'it').label, 'intreccia il codice');
  assert.equal(satStateLabel('hash', 'success', 'en').label, 'done');
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
