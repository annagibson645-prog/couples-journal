import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSendSheet } from '../js/screens/send-sheet.js';
import { El, makeSheetDom } from './helpers/fake-dom.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const ENTRY = 'Slow morning, good tea. I keep thinking about the walk.';

function setup(over = {}) {
  const doc = makeSheetDom();
  const calls = { addNote: [], sent: 0 };
  let door = over.door || 'hers';
  const data = { addNote: async (...a) => { calls.addNote.push(a); return 'n1'; }, ...over.data };
  const sheet = createSendSheet({ data, doc, getViewerDoor: () => door, onSent: () => { calls.sent += 1; }, ...over.sheet });
  const root = doc.body.children.find((c) => c.className.split(' ').includes('sd-root'));
  const q = (cls) => root.byClass(cls)[0];
  // a button standing in for the one that opened the dialog
  const trigger = new El(doc, 'button');
  doc.body.appendChild(trigger);
  return {
    doc, calls, sheet, root, trigger, setDoor: (d) => { door = d; },
    dialog: q('sd-dialog'), area: q('sd-area'), send: q('sd-send'), cancel: q('sd-cancel'),
    title: q('sd-title'), counter: q('sd-count'), hint: q('sd-limit'), err: q('sd-error'), live: q('sd-live'), scrim: q('sd-scrim'),
    key(key, extra = {}) { let prevented = false; root.dispatch('keydown', { key, preventDefault() { prevented = true; }, ...extra }); return prevented; },
  };
}

test('nothing is visible until it opens; it opens with the entry, labelled, modal, focus in the textarea', () => {
  const s = setup();
  assert.equal(s.scrim.hidden, true);
  s.sheet.open(ENTRY, s.trigger);
  assert.equal(s.scrim.hidden, false);
  assert.equal(s.dialog.getAttribute('role'), 'dialog');
  assert.equal(s.dialog.getAttribute('aria-modal'), 'true');
  assert.equal(s.dialog.getAttribute('aria-labelledby'), s.title.id);
  assert.equal(s.title.textContent, 'Send to him');
  assert.equal(s.area.value, ENTRY);
  assert.equal(s.doc.activeElement, s.area);
  assert.equal(s.counter.textContent, `${ENTRY.length} of 2,000 characters`);
  assert.match(s.root.textContent, /You can take it back later from Notes\./);
  assert.match(s.root.textContent, /Keep only the words you want him to read, then send\. They appear in Notes, where only the two of you can see them\. Your journal stays private, and the original entry doesn't change\./);
  assert.equal(s.send.textContent, 'Send to Notes');
  assert.equal(s.cancel.textContent, 'Cancel');
});

test('for His it says Send to her', () => {
  const s = setup({ door: 'his' });
  s.sheet.open(ENTRY, s.trigger);
  assert.equal(s.title.textContent, 'Send to her');
  assert.match(s.root.textContent, /words you want her to read/);
});

test('a selection starts the dialog with only the selection', () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger, 'good tea.');
  assert.equal(s.area.value, 'good tea.');
  s.sheet.close();
  s.sheet.open(ENTRY, s.trigger, 'not in the entry');
  assert.equal(s.area.value, ENTRY);
});

test('the rest of the page is inert while open, and restored on close', () => {
  const s = setup();
  s.doc.page[0].setAttribute('aria-hidden', 'false');
  s.sheet.open(ENTRY, s.trigger);
  for (const p of s.doc.page) {
    assert.equal(p.getAttribute('inert'), '');
    assert.equal(p.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(s.root.getAttribute('inert'), null);
  assert.equal(s.root.getAttribute('aria-hidden'), null);
  assert.equal(s.doc.documentElement.classList.contains('sd-lock'), true);
  s.sheet.close();
  for (const p of s.doc.page) assert.equal(p.getAttribute('inert'), null);
  assert.equal(s.doc.page[0].getAttribute('aria-hidden'), 'false');
  assert.equal(s.doc.page[1].getAttribute('aria-hidden'), null);
  assert.equal(s.doc.documentElement.classList.contains('sd-lock'), false);
});

test('Tab and Shift+Tab stay inside the dialog', () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.doc.activeElement = s.send;
  assert.equal(s.key('Tab'), true);
  assert.equal(s.doc.activeElement, s.area); // wrapped from the last to the first
  assert.equal(s.key('Tab', { shiftKey: true }), true);
  assert.equal(s.doc.activeElement, s.send); // and back
  s.doc.activeElement = s.cancel; // in the middle: the browser moves it, we do not interfere
  assert.equal(s.key('Tab'), false);
  assert.equal(s.key('Tab', { shiftKey: true }), false);
  s.doc.activeElement = s.trigger; // focus somehow outside: pulled back in
  s.key('Tab');
  assert.equal(s.doc.activeElement, s.area);
});

test('with Send disabled the trap skips it', () => {
  const s = setup();
  s.sheet.open('', s.trigger); // nothing to send: disabled
  assert.equal(s.send.disabled, true);
  s.doc.activeElement = s.cancel;
  assert.equal(s.key('Tab'), true);
  assert.equal(s.doc.activeElement, s.area);
});

test('Escape closes and returns focus to the opening button; so does Cancel', () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.key('Escape');
  assert.equal(s.scrim.hidden, true);
  assert.equal(s.doc.activeElement, s.trigger);
  s.doc.activeElement = null;
  s.sheet.open(ENTRY, s.trigger);
  s.cancel.click();
  assert.equal(s.scrim.hidden, true);
  assert.equal(s.doc.activeElement, s.trigger);
  assert.equal(s.calls.addNote.length, 0);
});

test('Send to Notes calls addNote once with the trimmed text and source entry, announces, closes, returns focus', async () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.area.value = `  ${ENTRY}  \n`;
  s.send.click();
  s.send.click(); // a double click
  s.key('Enter', { ctrlKey: true }); // and a repeated shortcut
  await tick();
  assert.deepEqual(s.calls.addNote, [[ENTRY, { source: 'entry' }]]);
  assert.equal(s.calls.sent, 1);
  assert.equal(s.scrim.hidden, true);
  assert.equal(s.live.textContent, "Sent to him. It's in Notes.");
  assert.equal(s.live.getAttribute('aria-live'), 'polite');
  assert.equal(s.doc.activeElement, s.trigger);
  assert.equal(s.area.value, ''); // the words are not kept around
});

test('a held Enter (key repeat) does not send twice', async () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.key('Enter', { ctrlKey: true, repeat: true });
  await tick();
  assert.equal(s.calls.addNote.length, 0);
});

test('for His the announcement says her', async () => {
  const s = setup({ door: 'his' });
  s.sheet.open(ENTRY, s.trigger);
  s.send.click(); await tick();
  assert.equal(s.live.textContent, "Sent to her. It's in Notes.");
});

test('an adapter error shows a friendly alert, keeps the text, and allows trying again', async () => {
  let fail = true;
  const s = setup({ data: { addNote: async () => { if (fail) throw new Error('Could not save on this device'); return 'ok'; } } });
  s.sheet.open(ENTRY, s.trigger);
  s.area.value = 'edited words';
  s.send.click(); await tick();
  assert.equal(s.scrim.hidden, false);
  assert.equal(s.area.value, 'edited words');
  assert.equal(s.err.getAttribute('role'), 'alert');
  assert.equal(s.err.hidden, false);
  assert.equal(s.err.textContent, 'Could not save on this device');
  assert.equal(s.send.disabled, false);
  assert.equal(s.live.textContent, '');
  fail = false;
  s.send.click(); await tick();
  assert.equal(s.scrim.hidden, true);
  assert.equal(s.err.hidden, true);
});

test('a non-Error rejection gets a plain fallback message', async () => {
  const s = setup({ data: { addNote: async () => { throw 'boom'; } } });
  s.sheet.open(ENTRY, s.trigger);
  s.send.click(); await tick();
  assert.equal(s.err.textContent, 'Could not send that. Please try again.');
});

test('over the limit: Send disabled, clear message, the counter shows it, nothing is sent, the value is never rewritten', async () => {
  const s = setup();
  s.sheet.open('a'.repeat(50000), s.trigger);
  assert.equal(s.area.value.length, 50000);
  assert.equal(s.counter.textContent, '50,000 of 2,000 characters');
  assert.equal(s.send.disabled, true);
  assert.equal(s.hint.textContent, 'That is over 2,000 characters. Delete some words to send it.');
  s.send.click(); s.key('Enter', { ctrlKey: true }); await tick();
  assert.equal(s.calls.addNote.length, 0);
  // trimming: typing never reassigns the textarea's value (that would move the person's cursor)
  let writes = 0;
  let v = 'b'.repeat(2000);
  Object.defineProperty(s.area, 'value', { get: () => v, set: (x) => { writes += 1; v = x; }, configurable: true });
  s.area.dispatch('input');
  assert.equal(writes, 0);
  assert.equal(s.send.disabled, false);
  assert.equal(s.hint.textContent, '');
  assert.equal(s.counter.textContent, '2,000 of 2,000 characters');
  v = 'b'.repeat(2001);
  s.area.dispatch('input');
  assert.equal(writes, 0);
  assert.equal(s.send.disabled, true);
});

test('empty or whitespace-only cannot send, with a clear message', async () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.area.value = '   \n';
  s.area.dispatch('input');
  assert.equal(s.send.disabled, true);
  assert.equal(s.hint.textContent, 'There is nothing to send yet. Add some words first.');
  s.send.click(); await tick();
  assert.equal(s.calls.addNote.length, 0);
});

test('clear() empties the text and closes without stealing focus, even mid-flight', async () => {
  let release;
  const s = setup({ data: { addNote: () => new Promise((r) => { release = r; }) } });
  s.sheet.open(ENTRY, s.trigger);
  s.send.click();
  s.doc.activeElement = null;
  s.sheet.clear();
  assert.equal(s.area.value, '');
  assert.equal(s.scrim.hidden, true);
  assert.equal(s.doc.page[0].getAttribute('inert'), null);
  assert.equal(s.doc.activeElement, null);
  release('n9'); await tick();
  assert.equal(s.live.textContent, ''); // no announcement after a wipe
  assert.equal(s.calls.sent, 0);
  s.sheet.open('again', s.trigger); // usable afterwards
  assert.equal(s.area.value, 'again');
  assert.equal(s.send.disabled, false);
});

test('reopening starts clean: no old error, no old announcement', async () => {
  const s = setup({ data: { addNote: async () => { throw new Error('nope'); } } });
  s.sheet.open(ENTRY, s.trigger);
  s.send.click(); await tick();
  s.cancel.click();
  s.sheet.open('second', s.trigger);
  assert.equal(s.err.hidden, true);
  assert.equal(s.err.textContent, '');
  assert.equal(s.area.value, 'second');
});

test('text is never set as markup', () => {
  const s = setup();
  const nasty = '<img src=x onerror=alert(1)> & <b>x</b>';
  s.sheet.open(nasty, s.trigger);
  assert.equal(s.area.value, nasty);
  assert.equal(s.root.find((c) => c.tag === 'img').length, 0);
});

test('opening twice without closing does not stack inert state', () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.sheet.open(ENTRY, s.trigger);
  s.sheet.close();
  assert.equal(s.doc.page[1].getAttribute('inert'), null);
  assert.equal(s.doc.page[1].getAttribute('aria-hidden'), null);
});

test('closing (Cancel or Escape) empties the textarea so cancelled words do not linger', () => {
  const s = setup();
  s.sheet.open(ENTRY, s.trigger);
  s.cancel.click();
  assert.equal(s.area.value, '');
  s.sheet.open(ENTRY, s.trigger);
  s.key('Escape');
  assert.equal(s.area.value, '');
});

test('the textarea has autocomplete off', () => {
  const s = setup();
  assert.equal(s.area.getAttribute('autocomplete'), 'off');
});

test('if the opener is gone when it closes, focus goes to the screen heading, not <body>', () => {
  const heading = new El(makeSheetDom(), 'h1');
  const s = setup();
  heading.doc = s.doc; heading.root = true;
  s.doc.querySelector = (q) => (q === 'main:not([hidden]) h1' ? heading : null);
  s.sheet.open(ENTRY, s.trigger);
  s.doc.body.children = s.doc.body.children.filter((c) => c !== s.trigger);
  s.trigger.parent = null; // the entry list redrew
  s.cancel.click();
  assert.equal(s.doc.activeElement, heading);
});
