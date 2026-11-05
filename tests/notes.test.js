// Pure helpers for the Notes screen. Dates are built with local constructors and
// TZ is pinned, so the results do not depend on the machine's time zone.
process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_MAX, formatNoteTime, countLabel, checkNote, isOwn, authorOf, oldestFirst } from '../js/lib/notes.js';

const at = (y, m, d, h, min) => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 10, 5, 12, 0); // 5 November 2026, midday

test('time reads Today, Yesterday, then a short date, always with a 24-hour time', () => {
  assert.equal(formatNoteTime(at(2026, 10, 5, 8, 40), NOW), 'Today, 8:40');
  assert.equal(formatNoteTime(at(2026, 10, 5, 0, 5), NOW), 'Today, 0:05');
  assert.equal(formatNoteTime(at(2026, 10, 4, 21, 2), NOW), 'Yesterday, 21:02');
  assert.equal(formatNoteTime(at(2026, 10, 3, 21, 2), NOW), '3 Nov, 21:02');
  assert.equal(formatNoteTime(at(2025, 11, 25, 9, 0), NOW), '25 Dec 2025, 9:00');
});

test('days are local calendar days: 23:30 last night is Yesterday, 00:10 this morning is Today', () => {
  const justAfterMidnight = at(2026, 10, 5, 0, 20);
  assert.equal(formatNoteTime(at(2026, 10, 4, 23, 30), justAfterMidnight), 'Yesterday, 23:30');
  assert.equal(formatNoteTime(at(2026, 10, 5, 0, 10), justAfterMidnight), 'Today, 0:10');
});

test('Yesterday still works across a month edge and the autumn clock change', () => {
  assert.equal(formatNoteTime(at(2026, 9, 31, 20, 0), at(2026, 10, 1, 9, 0)), 'Yesterday, 20:00');
  // US clocks go back on 1 November 2026: that day is 25 hours long.
  assert.equal(formatNoteTime(at(2026, 10, 1, 22, 0), at(2026, 10, 2, 7, 0)), 'Yesterday, 22:00');
  assert.equal(formatNoteTime(at(2026, 9, 31, 22, 0), at(2026, 10, 2, 7, 0)), '31 Oct, 22:00');
});

test('a bad time does not throw', () => {
  assert.equal(formatNoteTime(undefined, NOW), '');
  assert.equal(formatNoteTime(NaN, NOW), '');
});

test('the count shows only when under 100 characters are left', () => {
  assert.equal(NOTE_MAX, 2000);
  assert.equal(countLabel('a'.repeat(1899)), '');
  assert.equal(countLabel('a'.repeat(1900)), '');
  assert.equal(countLabel('a'.repeat(1901)), '99 left');
  assert.equal(countLabel('a'.repeat(1999)), '1 left');
  assert.equal(countLabel('a'.repeat(2000)), '0 left');
  assert.equal(countLabel('a'.repeat(2003)), '3 over');
});

test('checkNote rejects empty and whitespace-only, and anything over 2,000 once trimmed', () => {
  assert.deepEqual(checkNote(''), { ok: false, reason: 'empty' });
  assert.deepEqual(checkNote('  \n\t  '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkNote(undefined), { ok: false, reason: 'empty' });
  assert.deepEqual(checkNote('a'.repeat(2000)), { ok: true });
  assert.deepEqual(checkNote('a'.repeat(2001)), { ok: false, reason: 'long' });
  assert.deepEqual(checkNote('  ' + 'a'.repeat(2000) + '  '), { ok: true });
  assert.deepEqual(checkNote('hello\n\nthere'), { ok: true });
});

test('own notes are the ones whose author is the signed-in door', () => {
  assert.equal(isOwn({ authorDoor: 'hers' }, 'hers'), true);
  assert.equal(isOwn({ authorDoor: 'his' }, 'hers'), false);
  assert.equal(isOwn({ authorDoor: 'his' }, 'his'), true);
  assert.equal(isOwn({ authorDoor: 'hers' }, null), false);
  assert.equal(isOwn({ authorDoor: undefined }, undefined), false);
});

test('authorOf only trusts hers or his', () => {
  assert.equal(authorOf({ authorDoor: 'hers' }), 'hers');
  assert.equal(authorOf({ authorDoor: 'his' }), 'his');
  assert.equal(authorOf({ authorDoor: 'notes' }), null);
  assert.equal(authorOf({}), null);
});

test('oldestFirst puts the newest at the bottom without changing the input', () => {
  const input = [{ id: 'c', createdAt: 3 }, { id: 'b', createdAt: 2 }, { id: 'a', createdAt: 1 }];
  assert.deepEqual(oldestFirst(input).map((n) => n.id), ['a', 'b', 'c']);
  assert.deepEqual(input.map((n) => n.id), ['c', 'b', 'a']);
  assert.deepEqual(oldestFirst([]), []);
});

import { buildSeed } from '../js/data/sample-seed.js';
test('sample notes are never dated in the future, whatever time of day the sample is created', () => {
  for (const hour of [0, 6, 12, 23]) {
    const today = new Date(2026, 10, 5, hour, 30);
    for (const n of buildSeed(today).notes) assert.ok(n.createdAt < today.getTime(), `hour ${hour}`);
  }
});
