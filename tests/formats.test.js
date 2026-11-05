process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toText, toJson, toPrintHtml, exportTitle, exportFileName, EMPTY_MESSAGE } from '../js/lib/formats.js';

const NASTY = '# not a heading * star _ under_ <script>alert("x")</script> & \'q\' \u{1F319}\u{1F468}‍\u{1F469} 日本語\nsecond line\n\n  indented';
const MODEL = [
  { day: '2026-11-02', score: 4, note: null, entries: [] },
  { day: '2026-11-05', score: 7, note: 'Steady <b>day</b>.', entries: [{ time: '09:05', text: NASTY }, { time: '21:30', text: 'evening' }] },
  { day: '2026-11-06', score: null, note: null, entries: [{ time: '08:00', text: 'no mood today' }] },
];
const GEN = new Date(2026, 10, 5, 12, 0);
const TITLE = 'Hers journal';
const BIG12 = 'Lorem & ipsum 12k. '.repeat(631).slice(0, 12000);
const BIG50 = ('word \u{1F319} ' + 'x'.repeat(93) + '\n').repeat(500).slice(0, 50000);
const big = (t) => [{ day: '2026-11-05', score: 6, note: null, entries: [{ time: '10:00', text: t }] }];

test('title and file names', () => {
  assert.equal(exportTitle('hers'), 'Hers journal');
  assert.equal(exportTitle('his'), 'His journal');
  assert.equal(exportTitle('anything'), 'Hers journal');
  assert.equal(exportFileName('his', 'md', GEN), 'his-journal-2026-11-05.md');
  assert.equal(exportFileName('hers', 'docx', GEN), 'hers-journal-2026-11-05.docx');
  assert.match(exportFileName('hers', 'txt', GEN), /^[a-z0-9.-]+$/);
});

test('markdown: title, generated date, dated sections, mood word, note, entries verbatim', () => {
  const md = toMarkdown(MODEL, TITLE, GEN);
  assert.ok(md.startsWith('# Hers journal\n'));
  assert.ok(md.includes('Saved on Thursday, 5 November 2026'));
  assert.ok(md.includes('## Thursday, 5 November 2026'));
  assert.ok(md.includes('Mood: 7 of 10, mostly bright'));
  assert.ok(md.includes('Mood: 4 of 10, a bit low'));
  assert.ok(md.includes('Note: Steady <b>day</b>.'));
  assert.ok(md.includes(NASTY), 'entry text must be verbatim');
  assert.ok(md.indexOf('## Monday, 2 November 2026') < md.indexOf('## Thursday, 5 November 2026'));
  assert.ok(md.includes('09:05'));
  assert.ok(!/Mood:.*null/.test(md));
});

test('plain text: same content, no markup syntax added, entry verbatim', () => {
  const t = toText(MODEL, TITLE, GEN);
  assert.ok(t.startsWith('Hers journal\n'));
  assert.ok(t.includes('Thursday, 5 November 2026'));
  assert.ok(t.includes('Mood: 7 of 10, mostly bright'));
  assert.ok(t.includes('Note: Steady <b>day</b>.'));
  assert.ok(t.includes(NASTY));
  assert.ok(!t.includes('## '));
});

test('a day with an entry but no mood shows no mood line', () => {
  const md = toMarkdown([MODEL[2]], TITLE, GEN);
  assert.ok(!md.includes('Mood:'));
  assert.ok(md.includes('no mood today'));
});

test('json: round trips the model exactly', () => {
  const back = JSON.parse(toJson(MODEL));
  assert.deepEqual(back.days, MODEL);
  assert.equal(back.days[1].entries[0].text, NASTY);
});

test('12,000 and 50,000 character entries survive intact', () => {
  for (const t of [BIG12, BIG50]) {
    assert.ok(toMarkdown(big(t), TITLE, GEN).includes(t));
    assert.ok(toText(big(t), TITLE, GEN).includes(t));
    assert.equal(JSON.parse(toJson(big(t))).days[0].entries[0].text, t);
  }
});

test('empty model: every format gives a friendly short document, not a blank file', () => {
  assert.ok(toMarkdown([], TITLE, GEN).includes(EMPTY_MESSAGE));
  assert.ok(toText([], TITLE, GEN).includes(EMPTY_MESSAGE));
  assert.ok(toPrintHtml([], TITLE, GEN).includes(EMPTY_MESSAGE));
  assert.equal(JSON.parse(toJson([])).days.length, 0);
  assert.ok(toJson([]).includes(EMPTY_MESSAGE));
  assert.match(EMPTY_MESSAGE, /No entries yet/);
});

test('print html: a full document, ALL text escaped, nothing becomes markup', () => {
  const html = toPrintHtml(MODEL, 'Hers <i>journal</i>', GEN);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!html.includes('<script'), 'no script element at all');
  assert.ok(!html.includes('<b>day</b>'));
  assert.ok(!html.includes('<i>journal</i>'));
  assert.ok(html.includes('Steady &lt;b&gt;day&lt;/b&gt;.'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&amp; &#39;q&#39;'));
  assert.ok(html.includes('\u{1F319}'));
  assert.ok(html.includes('Thursday, 5 November 2026'));
  assert.ok(html.includes('7 of 10, mostly bright'));
  assert.ok(html.includes('@media print') || html.includes('@page'));
  assert.ok(/<title>Hers &lt;i&gt;journal&lt;\/i&gt;<\/title>/.test(html));
});

test('print html keeps long entries whole', () => {
  const esc = (s) => s.replace(/&/g, '&amp;');
  assert.ok(toPrintHtml(big(BIG12), TITLE, GEN).includes(esc(BIG12)));
  assert.ok(toPrintHtml(big(BIG50), TITLE, GEN).includes(BIG50));
});
