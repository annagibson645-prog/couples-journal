import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey } from '../js/lib/days.js';

test('dayKey uses the local day, not UTC', () => {
  assert.equal(dayKey(new Date(2026, 10, 5, 23, 30)), '2026-11-05');
  assert.equal(dayKey(new Date(2026, 10, 5, 0, 5)), '2026-11-05');
});

test('dayKey zero-pads month and day', () => {
  assert.equal(dayKey(new Date(2027, 0, 3)), '2027-01-03');
});
