import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftMonth, monthTitle, tintAlpha, isStrongTint, cellLabel, entriesForDay, formatDayLong, monthOfDay, entryCounts } from '../js/lib/lookback.js';
import { buildCalendar } from '../js/lib/moodlogic.js';

test('previous and next month cross year boundaries', () => {
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 11, -1), { year: 2026, month: 10 });
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2026, month: 12 });
});

test('walking back through a leap February gives it 29 days, and a normal one 28', () => {
  const feb2028 = shiftMonth(2028, 3, -1);
  assert.deepEqual(feb2028, { year: 2028, month: 2 });
  const days = (y, m) => buildCalendar(y, m, {}).flat().filter((c) => c.day).length;
  assert.equal(days(feb2028.year, feb2028.month), 29);
  const feb2027 = shiftMonth(2027, 3, -1);
  assert.equal(days(feb2027.year, feb2027.month), 28);
  assert.deepEqual(shiftMonth(2028, 2, -1), { year: 2028, month: 1 });
});

test('month title reads "November 2026"', () => {
  assert.equal(monthTitle(2026, 11), 'November 2026');
  assert.equal(monthTitle(2028, 2), 'February 2028');
});

test('tint grows with mood and stays within 0.16 to 1', () => {
  let prev = 0;
  for (let n = 1; n <= 10; n++) {
    const a = tintAlpha(n);
    assert.ok(a > prev, `score ${n}`);
    assert.ok(a >= 0.16 && a <= 1);
    prev = a;
  }
  assert.equal(tintAlpha(1), 0.16);
});

test('strong tint (on-accent text) only from 8 up', () => {
  assert.equal(isStrongTint(7), false);
  assert.equal(isStrongTint(8), true);
});

test('cell labels say the day and the mood word; a missing mood says so', () => {
  assert.equal(cellLabel('2026-11-05', 7), '5 November, mostly bright');
  assert.equal(cellLabel('2026-11-06', null), '6 November, no mood');
  assert.equal(cellLabel('2026-11-05', 7, true), '5 November, mostly bright, today');
});

test('long day name and month of a day key', () => {
  assert.equal(formatDayLong('2026-11-05'), 'Thursday, 5 November 2026');
  assert.deepEqual(monthOfDay('2026-02-14'), { year: 2026, month: 2 });
});

test('entries are filtered by day', () => {
  const es = [{ id: 'a', day: '2026-11-05' }, { id: 'b', day: '2026-11-04' }, { id: 'c', day: '2026-11-05' }];
  assert.deepEqual(entriesForDay(es, '2026-11-05').map((e) => e.id), ['a', 'c']);
  assert.deepEqual(entriesForDay(es, '2026-11-01'), []);
  assert.deepEqual(entriesForDay(undefined, '2026-11-01'), []);
});

test('cell labels count entries, and entry-only days say no mood', () => {
  assert.equal(cellLabel('2026-11-05', null, false, 2), '5 November, no mood, 2 entries');
  assert.equal(cellLabel('2026-11-05', null, false, 1), '5 November, no mood, 1 entry');
  assert.equal(cellLabel('2026-11-05', 7, true, 1), '5 November, mostly bright, 1 entry, today');
  assert.equal(cellLabel('2026-11-05', null, false, 0), '5 November, no mood');
});

test('entries are counted per day', () => {
  const m = entryCounts([{ day: 'a' }, { day: 'b' }, { day: 'a' }]);
  assert.equal(m.get('a'), 2);
  assert.equal(m.get('b'), 1);
  assert.equal(m.get('c'), undefined);
});
