import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookback } from '../js/screens/lookback.js';
import { makeLookbackDom } from './helpers/fake-dom.js';

const NOW = () => new Date(2026, 10, 5, 10, 0);
const at = (d, h = 9) => new Date(2026, 10, d, h, 0).getTime();
const entry = (id, d, text) => ({ id, day: `2026-11-${String(d).padStart(2, '0')}`, text, createdAt: at(d) });

function setup({ moods = {}, entries = [], data = {}, now = NOW } = {}) {
  const doc = makeLookbackDom();
  const shown = [];
  const railCalls = [];
  const nav = [];
  const api = {
    getMoods: async () => moods,
    listEntries: async () => entries,
    ...data,
  };
  const lookback = createLookback({
    data: api, document: doc, now,
    showScreen: (...a) => shown.push(a),
    rail: { show: (...a) => railCalls.push(a) },
    onNavigate: (k) => nav.push(k),
  });
  const $ = (id) => doc.byId[id];
  const cells = () => $('lb-grid').children;
  const dayCell = (n) => cells().find((c) => c.dataset && c.dataset.day === `2026-11-${String(n).padStart(2, '0')}`);
  return { doc, lookback, $, cells, dayCell, shown, railCalls, nav };
}
const MOODS = { '2026-11-05': { score: 7, note: 'Steady day.' }, '2026-11-03': { score: 4 }, '2026-11-02': { score: 9, note: 'Clear head.' } };

test('show draws the November 2026 calendar, Monday first, with the right cells enabled', async () => {
  const { lookback, $, cells, dayCell, shown, railCalls } = setup({ moods: MOODS });
  await lookback.show('hers');
  assert.deepEqual(shown[0], ['lookback', 'hers']);
  assert.equal(railCalls[0][0], 'hers');
  assert.equal($('lb-month').textContent, 'November 2026');
  assert.equal(cells().length, 42); // 6 blanks before Sunday 1 Nov, 30 days, padded to 6 weeks
  assert.equal(cells().filter((c) => c.tag === 'button').length, 30);
  assert.equal(dayCell(5).disabled, false);
  assert.equal(dayCell(5).getAttribute('aria-label'), '5 November, mostly bright, today');
  assert.equal(dayCell(2).getAttribute('aria-label'), '2 November, glowing');
  assert.equal(dayCell(4).disabled, true);
  assert.equal(dayCell(4).getAttribute('aria-label'), '4 November, no mood');
});

test("today's mood is chosen to begin with and its note shown", async () => {
  const { lookback, $, dayCell } = setup({ moods: MOODS });
  await lookback.show('hers');
  assert.equal($('lb-day-name').textContent, 'Thursday, 5 November 2026');
  assert.equal($('lb-day-word').textContent, 'Mostly bright.');
  assert.equal($('lb-day-note').textContent, 'Steady day.');
  assert.equal(dayCell(5).getAttribute('aria-pressed'), 'true');
});

test("choosing a day shows its mood word, note and only that day's entries", async () => {
  const entries = [entry('a', 5, 'five'), entry('b', 2, 'two first'), entry('c', 2, 'two second')];
  const { lookback, $, dayCell } = setup({ moods: MOODS, entries });
  await lookback.show('hers');
  dayCell(2).click();
  assert.equal($('lb-day-name').textContent, 'Monday, 2 November 2026');
  assert.equal($('lb-day-word').textContent, 'Glowing.');
  assert.equal($('lb-day-note').textContent, 'Clear head.');
  assert.equal($('lb-day-note').hidden, false);
  assert.equal($('lb-day-entries').children.length, 2);
  assert.equal($('lb-day-entries').children[0].byClass('td-text')[0].textContent, 'two first');
  assert.equal($('lb-day-empty').hidden, true);
  assert.equal(dayCell(2).getAttribute('aria-pressed'), 'true');
  assert.equal(dayCell(5).getAttribute('aria-pressed'), 'false');
});

test('a mood-only day says no entry, and hides the note line when there are no words', async () => {
  const { lookback, $, dayCell } = setup({ moods: MOODS, entries: [] });
  await lookback.show('hers');
  dayCell(3).click();
  assert.equal($('lb-day-note').hidden, true);
  assert.equal($('lb-day-entries').children.length, 0);
  assert.equal($('lb-day-empty').hidden, false);
});

test('a day without a mood is not clickable', async () => {
  const { lookback, $, dayCell } = setup({ moods: MOODS });
  await lookback.show('hers');
  dayCell(4).click();
  assert.equal($('lb-day-name').textContent, 'Thursday, 5 November 2026');
});

test('entries and notes go in as text, never markup, and long entries collapse', async () => {
  const nasty = '<script>alert(1)</script> "q" & \u{1F319} <b>x</b>';
  const long = 'word '.repeat(5000);
  const { lookback, $ } = setup({ moods: { '2026-11-05': { score: 6, note: '<i>note</i>' } }, entries: [entry('a', 5, nasty), entry('b', 5, long)] });
  await lookback.show('hers');
  assert.equal($('lb-day-note').textContent, '<i>note</i>');
  const [first, second] = $('lb-day-entries').children;
  const p = first.byClass('td-text')[0];
  assert.equal(p.textContent, nasty);
  assert.equal(p.children.length, 0);
  const more = second.byClass('td-more')[0];
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, 'Read more');
  more.click();
  assert.equal(more.textContent, 'Show less');
  assert.equal(second.byClass('td-text')[0].className.includes('td-clamp'), false);
  more.click();
  assert.equal(more.textContent, 'Read more');
});

test('previous and next move one month; next stops at the current month', async () => {
  const { lookback, $ } = setup({ moods: MOODS });
  await lookback.show('hers');
  assert.equal($('lb-next').disabled, true);
  $('lb-prev').click();
  assert.equal($('lb-month').textContent, 'October 2026');
  assert.equal($('lb-next').disabled, false);
  assert.equal($('lb-day-prompt').hidden, false); // nothing chosen in October yet
  assert.equal($('lb-day-body').hidden, true);
  $('lb-next').click();
  assert.equal($('lb-month').textContent, 'November 2026');
});

test('previous from January lands in December of the year before', async () => {
  const { lookback, $ } = setup({ now: () => new Date(2026, 0, 15) });
  await lookback.show('hers');
  assert.equal($('lb-month').textContent, 'January 2026');
  $('lb-prev').click();
  assert.equal($('lb-month').textContent, 'December 2025');
});

test('February of a leap year has 29 days', async () => {
  const { lookback, $, cells } = setup({ now: () => new Date(2028, 2, 10) });
  await lookback.show('hers');
  $('lb-prev').click();
  assert.equal($('lb-month').textContent, 'February 2028');
  assert.equal(cells().filter((c) => c.tag === 'button').length, 29);
});

test('picking a point on the chart opens that day, even in another month', async () => {
  const moods = { ...MOODS, '2026-10-30': { score: 2, note: 'Rough.' } };
  const { lookback, $ } = setup({ moods });
  await lookback.show('hers');
  $('lb-chart').dispatchEvent({ type: 'daypick', detail: { day: '2026-10-30' } });
  assert.equal($('lb-month').textContent, 'October 2026');
  assert.equal($('lb-day-name').textContent, 'Friday, 30 October 2026');
  assert.equal($('lb-day-note').textContent, 'Rough.');
});

test('the chart is drawn with a text alternative', async () => {
  const { lookback, $ } = setup({ moods: MOODS });
  await lookback.show('hers');
  const svg = $('lb-chart').children[0];
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Mood line chart for the last 30 days; most recent mood 7 of 10');
  const list = $('lb-chart').children[1];
  assert.equal(list.children.length, 3);
});

test('a brand-new journal shows a gentle prompt, and the chart and calendar frames', async () => {
  const { lookback, $, cells, nav } = setup();
  await lookback.show('hers');
  assert.equal($('lb-empty').hidden, false);
  assert.equal($('lb-error').hidden, true);
  assert.equal($('lb-chart').children[0].getAttribute('aria-label'), 'Mood line chart for the last 30 days; no moods recorded yet');
  assert.equal(cells().length, 42);
  assert.equal($('lb-day-prompt').hidden, false);
  $('lb-empty-today').click();
  assert.deepEqual(nav, ['today']);
});

test('the prompt is hidden once there is a mood', async () => {
  const { lookback, $ } = setup({ moods: MOODS });
  await lookback.show('hers');
  assert.equal($('lb-empty').hidden, true);
});

test('if the journal cannot be read, a friendly alert shows and nothing crashes', async () => {
  const { lookback, $, cells } = setup({ data: { getMoods: async () => { throw new Error('Could not read your journal on this device'); } } });
  await lookback.show('hers');
  assert.equal($('lb-error').hidden, false);
  assert.equal($('lb-error').textContent, 'Could not read your journal on this device');
  assert.equal($('lb-empty').hidden, true);
  assert.equal(cells().length, 42);
});

test('an unexplained failure still gets a plain message', async () => {
  const { lookback, $ } = setup({ data: { listEntries: async () => { throw 'boom'; } } });
  await lookback.show('his');
  assert.equal($('lb-error').hidden, false);
  assert.ok($('lb-error').textContent.length > 10);
});

test('showing again after an error clears it; clear() wipes the screen', async () => {
  let fail = true;
  const { lookback, $, cells } = setup({ moods: MOODS, data: { getMoods: async () => { if (fail) throw new Error('nope'); return MOODS; } } });
  await lookback.show('hers');
  assert.equal($('lb-error').hidden, false);
  fail = false;
  await lookback.show('hers');
  assert.equal($('lb-error').hidden, true);
  lookback.clear();
  assert.equal($('lb-day-note').textContent, '');
  assert.equal(cells().length, 0);
  assert.equal($('lb-chart').children.length, 0);
});

test('a slow reply from an earlier show is ignored', async () => {
  let resolve;
  const slow = new Promise((r) => { resolve = r; });
  let first = true;
  const { lookback, $, dayCell } = setup({ data: { getMoods: () => { if (first) { first = false; return slow; } return Promise.resolve(MOODS); } } });
  const a = lookback.show('hers');
  const b = lookback.show('hers');
  await b;
  resolve({ '2026-11-05': { score: 1, note: 'stale' } });
  await a;
  assert.equal($('lb-day-note').textContent, 'Steady day.');
  assert.ok(dayCell(2));
});
