import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, chartPoints, chartPaths, chartY, chartAriaLabel, chartListItems, nearestPoint } from '../js/lib/chart.js';

const s = (...scores) => scores.map((score, i) => ({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, score }));
const count = (str, ch) => str.split(ch).length - 1;

test('score 10 sits at the top gridline and score 1 at the bottom', () => {
  assert.equal(chartY(10), 20);
  assert.equal(chartY(1), 170);
  assert.ok(chartY(5) > 95 && chartY(5) < 110);
});

test('points spread evenly from the left edge to the right edge; gaps are null', () => {
  const geo = chartGeometry(700);
  const pts = chartPoints(s(3, null, 9), geo);
  assert.equal(pts[0].x, geo.left);
  assert.equal(pts[1], null);
  assert.equal(pts[2].x, geo.right);
});

test('an unbroken run is one connected line with an area under it', () => {
  const { line, area, dots } = chartPaths(s(3, 5, 7));
  assert.equal(count(line, 'M'), 1);
  assert.equal(count(line, 'L'), 2);
  assert.equal(count(area, 'Z'), 1);
  assert.equal(count(dots, 'M'), 3);
});

test('a gap breaks the line: no segment crosses the missing day', () => {
  const geo = chartGeometry(700);
  const { line, area, dots } = chartPaths(s(3, 5, null, 7, 8), geo);
  assert.equal(count(line, 'M'), 2);
  assert.equal(count(area, 'Z'), 2);
  assert.equal(count(dots, 'M'), 4);
  const gapX = chartPoints(s(3, 5, null, 7, 8), geo)[2];
  assert.equal(gapX, null);
  // the first run ends at day 2's x and the second starts at day 4's: no L joins them
  const runs = line.split('M').filter(Boolean);
  assert.equal(runs[0].split('L').length, 2);
  assert.equal(runs[1].split('L').length, 2);
});

test('a single isolated day is a dot only: no line, no area', () => {
  const { line, area, dots } = chartPaths(s(null, 6, null));
  assert.equal(line, '');
  assert.equal(area, '');
  assert.equal(count(dots, 'M'), 1);
  assert.match(dots, /l0 0$/);
});

test('an all-empty series draws nothing', () => {
  assert.deepEqual(chartPaths(s(null, null, null)), { line: '', area: '', dots: '' });
});

test('a one-day series is centred and does not divide by zero', () => {
  const [p] = chartPoints(s(5), chartGeometry(700));
  assert.ok(Number.isFinite(p.x));
});

test('the chart narrows to fit a phone', () => {
  const geo = chartGeometry(343);
  assert.equal(geo.width, 343);
  assert.ok(geo.right < 343 && geo.right > geo.left);
});

test('aria label states the most recent mood, or that there is none', () => {
  assert.equal(chartAriaLabel(s(4, 6, 7)), 'Mood line chart for the last 30 days; most recent mood 7 of 10');
  assert.equal(chartAriaLabel(s(4, 6, null)), 'Mood line chart for the last 30 days; most recent mood 6 of 10, on 2 November');
  assert.equal(chartAriaLabel(s(null, null)), 'Mood line chart for the last 30 days; no moods recorded yet');
});

test('screen-reader list names each day with a mood, oldest first', () => {
  assert.deepEqual(chartListItems(s(7, null, 1)), ['1 November: 7 of 10, mostly bright', '3 November: 1 of 10, very heavy']);
  assert.deepEqual(chartListItems(s(null)), []);
});

test('nearestPoint picks the closest day sideways, skips gaps, and respects the maximum distance', () => {
  const geo = chartGeometry(343);
  const pts = chartPoints(s(3, 5, null, 7, 8), geo);
  assert.equal(nearestPoint(pts, pts[0].x + 1, 14).day, '2026-11-01');
  // between day 2 and day 4 (day 3 is a gap): the nearer one wins
  const mid = (pts[1].x + pts[3].x) / 2;
  assert.equal(nearestPoint(pts, mid - 2, 400).day, '2026-11-02');
  assert.equal(nearestPoint(pts, mid + 2, 400).day, '2026-11-04');
  assert.equal(nearestPoint(pts, geo.right + 200, 14), null);
  assert.equal(nearestPoint([null, null], 10, 14), null);
});

test('crowded phone-width dots: a tap on one dot opens that dot, not its neighbour', () => {
  const geo = chartGeometry(343);
  const series = Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, score: 5 }));
  const pts = chartPoints(series, geo);
  for (const i of [0, 7, 15, 29]) assert.equal(nearestPoint(pts, pts[i].x + 3, 14).day, `d${i}`);
});

test('an unavailable chart is labelled so, never "no moods recorded"', () => {
  assert.equal(chartAriaLabel(s(null, null), { unavailable: true }), 'Mood chart unavailable');
});
