import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickPath, dotPath, moonPath } from '../js/lib/sigil.js';

const count = (s, re) => (s.match(re) || []).length;

test('tickPath(60,false) has 48 segments', () => {
  assert.equal(count(tickPath(60, false), /M/g), 48);
});

test('tickPath(60,true) has 12 segments', () => {
  assert.equal(count(tickPath(60, true), /M/g), 12);
});

test('short and long ticks differ in length', () => {
  assert.notEqual(tickPath(60, false), tickPath(60, true));
});

test('dotPath(16) has 16 points', () => {
  assert.equal(count(dotPath(16), /M/g), 16);
});

test('moonPath(0) encloses no area (new moon)', () => {
  const d = moonPath(0);
  assert.equal(count(d, /A/g), 0);
  assert.ok(!/L/.test(d.replace(/^M[\d. ]+/, '').replace(/Z$/, '')));
});

test('moonPath(1) is a full circle', () => {
  const d = moonPath(1);
  assert.equal(count(d, /A/g), 2);
  assert.match(d, /A17 17 0 1 1/);
});

test('moonPath(0.5) is a half moon, straight terminator', () => {
  const d = moonPath(0.5);
  assert.match(d, /A0.00 17/);
});

test('moonPath crescent and gibbous use different terminator sweep', () => {
  assert.notEqual(moonPath(0.25).split('A')[2], moonPath(0.75).split('A')[2]);
});
