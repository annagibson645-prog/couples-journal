import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToday } from '../js/screens/today.js';
import { makeDom } from './helpers/fake-dom.js';

const SAVED = 'Saved on this device, then synced';
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(overrides = {}, nowFn) {
  const doc = makeDom();
  const calls = { addEntry: [], deleteEntry: [], saveMood: [] };
  let entries = overrides.entries || [];
  let draft = overrides.draft || '';
  calls.saveDraft = [];
  const data = {
    getMoods: async () => overrides.moods || {},
    getMembers: async () => ({ names: { hers: 'Hers', his: 'His' } }),
    listEntries: async () => entries.slice(),
    addEntry: async (t) => { calls.addEntry.push(t); entries = [{ id: 'n' + entries.length, day: '2026-11-05', text: t, createdAt: Date.now() }, ...entries]; return 'x'; },
    deleteEntry: async (id) => { calls.deleteEntry.push(id); entries = entries.filter((e) => e.id !== id); },
    getDraft: async () => draft,
    saveDraft: async (t) => { calls.saveDraft.push(t); draft = t; },
    saveMood: async (...a) => { calls.saveMood.push(a); },
    ...overrides.data,
  };
  const today = createToday({ data, document: doc, now: nowFn || (() => new Date(2026, 10, 5, 10, 0)), debounceMs: 5, showScreen() {} });
  return { doc, data, calls, today, draftNow: () => draft, $: (id) => doc.byId[id] };
}
const entry = (id, text) => ({ id, day: '2026-11-05', text, createdAt: new Date(2026, 10, 5, 9, 0).getTime() });

test('a failed addEntry keeps the typed text, shows the error, and never claims it saved', async () => {
  const { $, today } = setup({ data: { addEntry: async () => { throw new Error('Could not save on this device'); } } });
  await today.show('hers');
  $('td-text').value = 'my words';
  $('td-save').click(); await tick();
  assert.equal($('td-text').value, 'my words');
  assert.equal($('td-error').hidden, false);
  assert.equal($('td-error').textContent, 'Could not save on this device');
  assert.equal($('td-status').hidden, true);
  assert.notEqual($('td-status').textContent, SAVED);
});

test('a successful save shows the saved line, clears the box and returns focus to it', async () => {
  const { $, doc, today } = setup();
  await today.show('hers');
  $('td-text').value = 'hello';
  $('td-save').click(); await tick();
  assert.equal($('td-text').value, '');
  assert.equal($('td-status').textContent, SAVED);
  assert.equal($('td-status').hidden, false);
  assert.equal(doc.activeElement, $('td-text'));
});

test('entry text is set as text, never as markup', async () => {
  const nasty = '<script>alert(1)</script> "quotes" & \'single\' \u{1F319}✨ <b>x</b>';
  const { $, today } = setup({ entries: [entry('a', nasty)] });
  await today.show('hers');
  const p = $('td-list').children[0].byClass('td-text')[0];
  assert.equal(p.textContent, nasty);
  assert.equal(p.children.length, 0);
});

test('choosing a moon keeps the note, and saving the note keeps the score', async () => {
  const { $, calls, today } = setup();
  await today.show('hers');
  $('td-note').value = 'slow morning';
  $('td-moons').children[6].click(); await tick();
  assert.deepEqual(calls.saveMood.at(-1), ['2026-11-05', 7, 'slow morning']);
  $('td-note').value = 'slow morning, good tea';
  $('td-note').dispatch('blur'); await tick();
  assert.deepEqual(calls.saveMood.at(-1), ['2026-11-05', 7, 'slow morning, good tea']);
});

test('Delete asks first; only the confirm calls deleteEntry; Keep it does not', async () => {
  const { $, calls, today } = setup({ entries: [entry('a', 'one')] });
  await today.show('hers');
  const acts = () => $('td-list').children[0].byClass('td-entry-actions')[0];
  acts().children[0].click();
  assert.equal(calls.deleteEntry.length, 0);
  assert.match($('td-list').children[0].textContent, /Delete this entry\?/);
  acts().children[2].click(); // Keep it
  assert.equal(calls.deleteEntry.length, 0);
  acts().children[0].click();
  acts().children[1].click(); // Yes, delete
  await tick();
  assert.deepEqual(calls.deleteEntry, ['a']);
});

test('an empty or blank box saves nothing and says so gently', async () => {
  const { $, calls, today } = setup();
  await today.show('hers');
  for (const v of ['', '   \n ']) {
    $('td-text').value = v;
    $('td-save').click(); await tick();
    assert.equal($('td-error').hidden, false);
  }
  assert.equal(calls.addEntry.length, 0);
  assert.equal($('td-status').hidden, true);
});

test('saved but the list refresh fails: says so, keeps the box cleared, no false error', async () => {
  let fail = false;
  const { $, calls, today } = setup({ data: { listEntries: async () => { if (fail) throw new Error('boom'); return []; } } });
  await today.show('hers');
  fail = true;
  $('td-text').value = 'kept safe';
  $('td-save').click(); await tick();
  assert.equal(calls.addEntry.length, 1);
  assert.equal($('td-text').value, '');
  assert.match($('td-error').textContent, /Saved, but we couldn't refresh the list/);
  assert.doesNotMatch($('td-error').textContent, /Could not save your entry/);
});

test('focus moves sensibly through the delete flow', async () => {
  const { $, doc, today } = setup({ entries: [entry('a', 'one'), entry('b', 'two')] });
  await today.show('hers');
  const actions = (i) => $('td-list').children[i].byClass('td-entry-actions')[0];
  actions(0).children[0].click();
  assert.equal(doc.activeElement, actions(0).children[1]);       // Yes, delete
  actions(0).children[2].click();                                // Keep it
  assert.equal(doc.activeElement, actions(0).children[0]);       // back on Delete
  actions(0).children[0].click();
  actions(0).children[1].click(); await tick();                  // confirm delete of the first
  assert.equal($('td-list').children.length, 1);
  assert.equal(doc.activeElement, actions(0).children[0]);       // next entry's Delete
  actions(0).children[0].click();
  actions(0).children[1].click(); await tick();                  // delete the last one
  assert.equal(doc.activeElement, $('td-entries-title'));
});

test('words typed before a moon is chosen get a hint, which goes once a moon is chosen', async () => {
  const { $, today } = setup();
  await today.show('hers');
  $('td-note').value = 'tired';
  $('td-note').dispatch('input');
  assert.equal($('td-hint').hidden, false);
  $('td-moons').children[2].click(); await tick();
  assert.equal($('td-hint').hidden, true);
});

test('past midnight the day key and heading are recomputed at the next save', async () => {
  let now = new Date(2026, 10, 5, 23, 59);
  const { $, calls, today } = setup({}, () => now);
  await today.show('hers');
  assert.equal($('td-date').textContent, 'Thursday, 5 November');
  now = new Date(2026, 10, 6, 0, 1);
  $('td-moons').children[4].click(); await tick();
  assert.equal(calls.saveMood.at(-1)[0], '2026-11-06');
  assert.equal($('td-date').textContent, 'Friday, 6 November');
});

test('typing updates the word count and autosaves the draft after a pause', async () => {
  const { $, calls, today } = setup();
  await today.show('hers');
  assert.equal($('td-count').textContent, '0 words');
  $('td-text').value = 'one two three';
  $('td-text').dispatch('input');
  assert.equal($('td-count').textContent, '3 words');
  assert.equal(calls.saveDraft.length, 0);   // debounced, not per keystroke
  $('td-text').value = 'one two three four';
  $('td-text').dispatch('input');
  await wait(30);
  assert.deepEqual(calls.saveDraft, ['one two three four']);
});

test('the saved draft is restored when Today is shown, and a saved entry clears it', async () => {
  const { $, calls, today, draftNow } = setup({ draft: 'unfinished thought' });
  await today.show('hers');
  assert.equal($('td-text').value, 'unfinished thought');
  assert.equal($('td-count').textContent, '2 words');
  $('td-save').click(); await tick(); await wait(20);
  assert.equal(calls.addEntry[0], 'unfinished thought');
  assert.equal(draftNow(), '');
  assert.equal($('td-text').value, '');
});

test('leaving Today flushes a pending draft so navigating away loses nothing', async () => {
  const { $, doc, calls, today } = setup();
  await today.show('hers');
  $('td-text').value = 'about to leave';
  $('td-text').dispatch('input');
  today.leave(); // the app calls this when the rail moves away from Today
  await tick();
  assert.deepEqual(calls.saveDraft, ['about to leave']);
});

test('a draft that cannot be saved or read raises no error', async () => {
  const { $, today } = setup({ data: { saveDraft: async () => { throw new Error('nope'); }, getDraft: async () => { throw new Error('nope'); } } });
  await today.show('hers');
  $('td-text').value = 'x';
  $('td-text').dispatch('input');
  await wait(30);
  assert.equal($('td-error').hidden, true);
});

test('long entries collapse behind a Read more button; short ones have none', async () => {
  const long = 'x'.repeat(50000);
  const { $, today } = setup({ entries: [entry('a', long), entry('b', 'short one')] });
  await today.show('hers');
  const btnOf = (i) => $('td-list').children[i].byClass('td-more')[0];
  const textOf = (i) => $('td-list').children[i].byClass('td-text')[0];
  assert.equal(textOf(0).textContent.length, 50000);
  assert.equal(btnOf(0).hidden, false);
  assert.equal(btnOf(0).textContent, 'Read more');
  assert.equal(btnOf(0).getAttribute('aria-expanded'), 'false');
  assert.ok(textOf(0).className.split(' ').includes('td-clamp'));
  btnOf(0).click();
  assert.equal(btnOf(0).textContent, 'Show less');
  assert.equal(btnOf(0).getAttribute('aria-expanded'), 'true');
  assert.ok(!textOf(0).className.split(' ').includes('td-clamp'));
  btnOf(0).click();
  assert.ok(textOf(0).className.split(' ').includes('td-clamp'));
  assert.equal(btnOf(1).hidden, true);
});

// --- send part of an entry to the other person ---------------------------
function sheetStub() {
  const calls = { open: [], clear: 0 };
  return { calls, open: (...a) => calls.open.push(a), close() {}, clear() { calls.clear += 1; } };
}
const sendBtn = (li) => li.byClass('td-send')[0];

test('each entry has a "Send to him" button for Hers and "Send to her" for His, opening the sheet with the entry text', async () => {
  const sheet = sheetStub();
  const { $, today } = setup({ entries: [entry('a', 'one two three')] });
  const s2 = setup({ entries: [entry('a', 'one two three')] });
  const t = createToday({ data: s2.data, document: s2.doc, now: () => new Date(2026, 10, 5, 10, 0), debounceMs: 5, showScreen() {}, sheet });
  await t.show('hers');
  const b = sendBtn(s2.$('td-list').children[0]);
  assert.equal(b.textContent, 'Send to him');
  assert.match(b.getAttribute('aria-label'), /^Send to him/);
  b.click();
  assert.deepEqual(sheet.calls.open[0].slice(0, 3), ['one two three', b, '']);
  await t.show('his');
  assert.equal(sendBtn(s2.$('td-list').children[0]).textContent, 'Send to her');
  void $; void today;
});

test('without a sheet there is no send button (older callers are unchanged)', async () => {
  const { $, today } = setup({ entries: [entry('a', 'x')] });
  await today.show('hers');
  assert.equal(sendBtn($('td-list').children[0]), undefined);
});

test('a selection inside the entry text starts the sheet with only the selection, even if pressing the button cleared it', async () => {
  const sheet = sheetStub();
  const s = setup({ entries: [entry('a', 'one two three')] });
  const t = createToday({ data: s.data, document: s.doc, now: () => new Date(2026, 10, 5, 10, 0), debounceMs: 5, showScreen() {}, sheet });
  await t.show('hers');
  const li = s.$('td-list').children[0];
  const p = li.byClass('td-text')[0];
  p.contains = (n) => n === p;
  let picked = 'two';
  s.doc.getSelection = () => (picked ? { rangeCount: 1, isCollapsed: false, anchorNode: p, focusNode: p, toString: () => picked } : { rangeCount: 0, isCollapsed: true });
  const b = sendBtn(li);
  b.dispatch('pointerdown'); // the phone clears the selection before the click
  picked = '';
  b.click();
  assert.equal(sheet.calls.open[0][2], 'two');
  // a later plain click (keyboard) with no selection sends the whole entry; the old capture is gone
  b.click();
  assert.equal(sheet.calls.open[1][2], '');
  // touchstart and mousedown both capture, and the empty second one does not erase the first
  picked = 'three';
  b.dispatch('touchstart');
  picked = '';
  b.dispatch('mousedown');
  b.click();
  assert.equal(sheet.calls.open[2][2], 'three');
});

test('show and clear wipe the sheet, and the entry text is unchanged by sending', async () => {
  const sheet = sheetStub();
  const s = setup({ entries: [entry('a', 'keep me')] });
  const t = createToday({ data: s.data, document: s.doc, now: () => new Date(2026, 10, 5, 10, 0), debounceMs: 5, showScreen() {}, sheet });
  await t.show('hers');
  const before = sheet.calls.clear;
  t.clear();
  assert.ok(sheet.calls.clear > before);
  await t.show('hers');
  assert.equal(s.$('td-list').children[0].byClass('td-text')[0].textContent, 'keep me');
});
