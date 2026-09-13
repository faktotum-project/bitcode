import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFee } from './fee.mjs';
test('fractional fees round up to the next satoshi', () => {
  assert.equal(estimateFee(141, 1.1), 156);
});
test('whole-satoshi fees stay unchanged', () => {
  assert.equal(estimateFee(140, 2), 280);
});
