import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidScore, moodSeries, buildCalendar } from '../js/lib/moodlogic.js';

test('isValidScore accepts integers 1-10 only', () => {
  for (let n = 1; n <= 10; n++) assert.equal(isValidScore(n), true);
  for (const bad of [0, 11, 5.5, '5', null, undefined, NaN, -1]) {
    assert.equal(isValidScore(bad), false, String(bad));
  }
});

test('moodSeries gives one point per day, null for gaps, inclusive', () => {
  const moods = [{ day: '2026-11-01', score: 4 }, { day: '2026-11-03', score: 8 }];
  assert.deepEqual(moodSeries(moods, '2026-11-01', '2026-11-04'), [
    { day: '2026-11-01', score: 4 },
    { day: '2026-11-02', score: null },
    { day: '2026-11-03', score: 8 },
    { day: '2026-11-04', score: null },
  ]);
});

test('moodSeries crosses month and year ends and accepts a day-keyed map', () => {
  const series = moodSeries({ '2026-12-31': { score: 6 }, '2027-01-01': 7 }, '2026-12-30', '2027-01-02');
  assert.deepEqual(series.map((p) => p.day), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(series.map((p) => p.score), [null, 6, 7, null]);
});

test('moodSeries treats invalid scores as gaps and from > to as empty', () => {
  assert.deepEqual(moodSeries([{ day: '2026-11-01', score: 99 }], '2026-11-01', '2026-11-01'),
    [{ day: '2026-11-01', score: null }]);
  assert.deepEqual(moodSeries([], '2026-11-05', '2026-11-01'), []);
});

test('buildCalendar Nov 2026: Monday-first, 30 real days, padded', () => {
  const weeks = buildCalendar(2026, 11, [{ day: '2026-11-05', score: 7 }]);
  assert.ok(weeks.every((w) => w.length === 7));
  // 1 Nov 2026 is a Sunday: six leading blanks in week one.
  assert.deepEqual(weeks[0].slice(0, 6).map((c) => c.day), Array(6).fill(null));
  assert.equal(weeks[0][6].day, '2026-11-01');
  const real = weeks.flat().filter((c) => c.day !== null);
  assert.equal(real.length, 30);
  assert.equal(real.find((c) => c.day === '2026-11-05').score, 7);
  assert.equal(real.find((c) => c.day === '2026-11-06').score, null);
  assert.equal(weeks.length, 6);
});

test('buildCalendar Feb 2028 has 29 days; Feb 2027 has 28', () => {
  assert.equal(buildCalendar(2028, 2, []).flat().filter((c) => c.day).length, 29);
  assert.equal(buildCalendar(2027, 2, []).flat().filter((c) => c.day).length, 28);
});

test('buildCalendar month starting Monday has no leading padding', () => {
  // 1 Feb 2027 is a Monday.
  assert.equal(buildCalendar(2027, 2, [])[0][0].day, '2027-02-01');
});
