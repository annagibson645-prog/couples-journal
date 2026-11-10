process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotes } from '../js/screens/notes.js';
import { createDemoAdapter } from '../js/data/demo.js';
import { makeNotesDom } from './helpers/fake-dom.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = new Date(2026, 10, 5, 12, 0);
const t = (d, h, m) => new Date(2026, 10, d, h, m).getTime();

class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// A hand-driven adapter so a test decides exactly when notes arrive.
function setup(over = {}) {
  const doc = makeNotesDom();
  const calls = { addNote: [], deleteNote: [], listen: 0, unsub: 0, screens: [], rail: [], signIn: [], signOut: 0, order: [] };
  const listeners = new Set();
  let notes = over.notes || []; // newest first, like the adapters
  const emit = () => { for (const cb of [...listeners]) cb(notes.slice()); };
  const data = {
    getMembers: async () => ({ names: { hers: 'Maya', his: 'Sam' } }),
    listenNotes: (cb) => {
      calls.listen += 1;
      listeners.add(cb);
      cb(notes.slice());
      return () => { calls.unsub += 1; listeners.delete(cb); };
    },
    addNote: async (text) => { calls.addNote.push(text); notes = [{ id: 'n' + notes.length, authorDoor: over.door || 'hers', text, createdAt: NOW.getTime() }, ...notes]; emit(); return 'x'; },
    signIn: async (door) => { calls.order.push('signIn'); calls.signIn.push(door); if (over.signInFails) throw new Error('nope'); },
    signOut: async () => { calls.signOut += 1; },
    deleteNote: async (id) => { calls.deleteNote.push(id); notes = notes.filter((n) => n.id !== id); emit(); },
    ...over.data,
  };
  const rail = { show: (...a) => calls.rail.push(a), clear() {} };
  const screen = createNotes({ data, document: doc, now: () => NOW, rail, showScreen: (...a) => calls.screens.push(a), beforeSwitch: async () => { calls.order.push('before'); }, ...over.screen });
  return {
    doc, data, calls, screen, rail, listeners,
    push(n) { notes = [n, ...notes]; emit(); },
    $: (id) => doc.byId[id],
    items: () => doc.byId['nt-list'].children.filter((c) => c.className.split(' ').includes('nt-note')),
    rows: () => doc.byId['nt-list'].children,
  };
}
const note = (id, door, text, when = t(5, 8, 40)) => ({ id, authorDoor: door, text, createdAt: when });
const SAMPLE = [
  note('c', 'his', 'Left you coffee. Love you.', t(5, 8, 40)),
  note('b', 'hers', 'Thank you for the soup.', t(5, 7, 15)),
  note('a', 'his', 'Proud of you.', t(4, 21, 2)),
];
const button = (li, label) => li.find((x) => x.tag === 'button' && x.textContent === label);

test('shows the screen with the notes accent and the viewer, oldest first', async () => {
  const { screen, calls, items } = setup({ notes: SAMPLE });
  await screen.show('hers');
  assert.deepEqual(calls.screens[0], ['notes', 'notes']);
  assert.equal(calls.rail[0][0], 'notes');
  assert.deepEqual(items().map((li) => li.byClass('nt-text')[0].textContent),
    ['Proud of you.', 'Thank you for the soup.', 'Left you coffee. Love you.']);
});

test("own notes sit right with a Delete; the other person's sit left without one", async () => {
  const { screen, items } = setup({ notes: SAMPLE });
  await screen.show('hers');
  const [a, b, c] = items();
  assert.ok(a.className.includes('nt-other') && !a.className.includes('nt-own'));
  assert.ok(b.className.includes('nt-own'));
  assert.ok(c.className.includes('nt-other'));
  assert.equal(button(a, 'Delete').length, 0);
  assert.equal(button(b, 'Delete').length, 1);
  assert.equal(button(c, 'Delete').length, 0);
});

test('seen as His the sides swap', async () => {
  const { screen, items } = setup({ notes: SAMPLE });
  await screen.show('his');
  const [a, b, c] = items();
  assert.ok(a.className.includes('nt-own'));
  assert.ok(b.className.includes('nt-other'));
  assert.ok(c.className.includes('nt-own'));
});

test('author colour and name: pink for Hers, blue for His, with the member names and friendly times', async () => {
  const { screen, items } = setup({ notes: SAMPLE });
  await screen.show('hers');
  await tick();
  const [a, b] = items();
  assert.ok(a.className.includes('nt-by-his'));
  assert.ok(b.className.includes('nt-by-hers'));
  assert.equal(a.byClass('nt-who')[0].textContent, 'Sam');
  assert.equal(b.byClass('nt-who')[0].textContent, 'Maya');
  assert.equal(a.byClass('nt-when')[0].textContent, 'Yesterday, 21:02');
  assert.equal(b.byClass('nt-when')[0].textContent, 'Today, 7:15');
});

test('an empty feed says so; a first note hides the line', async () => {
  const { screen, $, push, items } = setup();
  await screen.show('hers');
  assert.equal($('nt-empty').hidden, false);
  assert.equal($('nt-empty').textContent, 'No notes yet. Leave the first one.');
  assert.equal(items().length, 0);
  push(note('z', 'his', 'hi'));
  assert.equal($('nt-empty').hidden, true);
  assert.equal(items().length, 1);
});

test('leaving a note sends it, clears the box, announces it and focuses the box', async () => {
  const { screen, $, calls, doc, items } = setup({ door: 'hers' });
  await screen.show('hers');
  $('nt-text').value = 'You are lovely.';
  $('nt-send').click(); await tick();
  assert.deepEqual(calls.addNote, ['You are lovely.']);
  assert.equal($('nt-text').value, '');
  assert.equal($('nt-live').textContent, 'Note left');
  assert.equal(doc.activeElement, $('nt-text'));
  assert.equal(items().length, 1);
  assert.equal($('nt-error').hidden, true);
});

test('line breaks are kept and the text is trimmed at the ends only', async () => {
  const { screen, $, calls } = setup();
  await screen.show('hers');
  $('nt-text').value = '  one\n\ntwo  ';
  $('nt-send').click(); await tick();
  assert.deepEqual(calls.addNote, ['one\n\ntwo']);
});

test('a whitespace-only note is refused kindly and nothing is added', async () => {
  const { screen, $, calls, doc } = setup();
  await screen.show('hers');
  $('nt-text').value = '  \n  ';
  $('nt-send').click(); await tick();
  assert.equal(calls.addNote.length, 0);
  assert.equal($('nt-error').hidden, false);
  assert.match($('nt-error').textContent, /few words/);
  assert.equal($('nt-live').textContent, '');
  assert.equal(doc.activeElement, $('nt-text'));
});

test('2,000 characters is the limit: the box is capped, 2,001 is refused, 2,000 goes through', async () => {
  const { screen, $, calls } = setup();
  await screen.show('hers');
  assert.equal($('nt-text').getAttribute('maxlength'), '2000');
  $('nt-text').value = 'a'.repeat(2001);
  $('nt-send').click(); await tick();
  assert.equal(calls.addNote.length, 0);
  assert.match($('nt-error').textContent, /2,000/);
  assert.equal($('nt-text').value.length, 2001);
  $('nt-text').value = 'a'.repeat(2000);
  $('nt-send').click(); await tick();
  assert.equal(calls.addNote.length, 1);
  assert.equal($('nt-error').hidden, true);
});

test('the remaining count appears only under 100 left, and goes again when text is cleared', async () => {
  const { screen, $ } = setup();
  await screen.show('hers');
  assert.equal($('nt-count').hidden, true);
  $('nt-text').value = 'a'.repeat(1950);
  $('nt-text').dispatch('input');
  assert.equal($('nt-count').hidden, false);
  assert.equal($('nt-count').textContent, '50 left');
  $('nt-text').value = 'a'.repeat(10);
  $('nt-text').dispatch('input');
  assert.equal($('nt-count').hidden, true);
});

test("a failed add keeps the typed text, shows the adapter's message as an alert, and re-enables Leave note", async () => {
  const { screen, $, doc, calls } = setup({ data: { addNote: async () => { throw new Error('Could not save on this device'); } } });
  await screen.show('hers');
  $('nt-text').value = 'do not lose me';
  $('nt-send').click(); await tick();
  assert.equal($('nt-text').value, 'do not lose me');
  assert.equal($('nt-error').textContent, 'Could not save on this device');
  assert.equal($('nt-error').hidden, false);
  assert.equal($('nt-live').textContent, '');
  assert.equal($('nt-send').disabled, false);
  assert.equal(doc.activeElement, $('nt-text'));
  assert.equal(calls.addNote.length, 0);
});

test('hostile text is shown as text: no markup, long strings and emoji intact', async () => {
  const nasty = '<script>alert(1)</script> "q" & \'s\' \u{1F319}✨ <b>x</b>';
  const long = 'x'.repeat(500);
  const { screen, items } = setup({ notes: [note('b', 'his', long), note('a', 'hers', nasty)] });
  await screen.show('hers');
  const [a, b] = items();
  const p = a.byClass('nt-text')[0];
  assert.equal(p.textContent, nasty);
  assert.equal(p.children.length, 0);
  assert.equal(b.byClass('nt-text')[0].textContent, long);
});

test('names from the adapter are text too', async () => {
  const { screen, items } = setup({ notes: [note('a', 'hers', 'hi')], data: { getMembers: async () => ({ names: { hers: '<img src=x onerror=1>', his: 'Sam' } }) } });
  await screen.show('hers');
  await tick();
  const who = items()[0].byClass('nt-who')[0];
  assert.equal(who.textContent, '<img src=x onerror=1>');
  assert.equal(who.children.length, 0);
});

test('Delete asks first; only "Yes, delete" calls deleteNote; "Keep it" does not', async () => {
  const { screen, $, calls, doc, items } = setup({ notes: [note('b', 'hers', 'mine'), note('a', 'hers', 'also mine', t(4, 9, 0))] });
  await screen.show('hers');
  button(items()[0], 'Delete')[0].click();
  assert.equal(calls.deleteNote.length, 0);
  assert.equal(doc.activeElement.textContent, 'Yes, delete');
  button(items()[0], 'Keep it')[0].click();
  assert.equal(calls.deleteNote.length, 0);
  assert.equal(doc.activeElement.textContent, 'Delete');
  button(items()[0], 'Delete')[0].click();
  button(items()[0], 'Yes, delete')[0].click(); await tick(); await tick();
  assert.deepEqual(calls.deleteNote, ['a']);
  assert.equal($('nt-live').textContent, 'Note deleted');
  assert.equal(items().length, 1);
  // focus moved to the neighbouring note's Delete
  assert.equal(doc.activeElement.textContent, 'Delete');
  assert.equal(items()[0].find((x) => x === doc.activeElement).length, 1);
});

test('deleting the only note moves focus to the box', async () => {
  const { screen, $, doc, items } = setup({ notes: [note('a', 'hers', 'only')] });
  await screen.show('hers');
  button(items()[0], 'Delete')[0].click();
  button(items()[0], 'Yes, delete')[0].click(); await tick(); await tick();
  assert.equal(items().length, 0);
  assert.equal(doc.activeElement, $('nt-text'));
});

test('a failed delete shows a friendly alert and keeps the note', async () => {
  const { screen, $, items } = setup({ notes: [note('a', 'hers', 'only')], data: { deleteNote: async () => { throw new Error('Could not delete that note.'); } } });
  await screen.show('hers');
  button(items()[0], 'Delete')[0].click();
  button(items()[0], 'Yes, delete')[0].click(); await tick(); await tick();
  assert.equal($('nt-error').textContent, 'Could not delete that note.');
  assert.equal($('nt-error').hidden, false);
  assert.equal(items().length, 1);
});

test('the feed is live: a note from the other person appears without a reload', async () => {
  const { screen, push, items } = setup({ notes: [note('a', 'his', 'first')] });
  await screen.show('hers');
  push(note('b', 'his', 'second', t(5, 11, 0)));
  assert.equal(items().length, 2);
  assert.equal(items()[1].byClass('nt-text')[0].textContent, 'second');
});

test('scrolled to the newest on show; a new note while at the bottom keeps following', async () => {
  const { screen, $, push } = setup({ notes: SAMPLE });
  const feed = $('nt-feed');
  Object.assign(feed, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
  await screen.show('hers');
  assert.equal(feed.scrollTop, 1000);
  feed.scrollHeight = 1200; feed.scrollTop = 900; // at the bottom (1200 - 300)
  push(note('d', 'his', 'new', t(5, 11, 0)));
  assert.equal(feed.scrollTop, 1200);
  assert.equal($('nt-new').hidden, true);
});

test('a new note does not yank a reader who scrolled up; a New note button appears instead', async () => {
  const { screen, $, push } = setup({ notes: SAMPLE });
  const feed = $('nt-feed');
  Object.assign(feed, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
  await screen.show('hers');
  feed.scrollTop = 120; // reading older notes
  feed.scrollHeight = 1200;
  push(note('d', 'his', 'new', t(5, 11, 0)));
  assert.equal(feed.scrollTop, 120);
  assert.equal($('nt-new').hidden, false);
  assert.equal($('nt-new').textContent, 'New note');
  $('nt-new').click();
  assert.equal(feed.scrollTop, 1200);
  assert.equal($('nt-new').hidden, true);
});

test('my own new note always scrolls to the bottom, even if I had scrolled up', async () => {
  const { screen, $ } = setup({ notes: SAMPLE, door: 'hers' });
  const feed = $('nt-feed');
  Object.assign(feed, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
  await screen.show('hers');
  feed.scrollTop = 50; feed.scrollHeight = 1300;
  $('nt-text').value = 'mine';
  $('nt-send').click(); await tick();
  assert.equal(feed.scrollTop, 1300);
  assert.equal($('nt-new').hidden, true);
});

test('a delete or a redraw does not show New note or move a scrolled reader', async () => {
  const { screen, $, items } = setup({ notes: SAMPLE });
  const feed = $('nt-feed');
  Object.assign(feed, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
  await screen.show('hers');
  feed.scrollTop = 200;
  button(items()[1], 'Delete')[0].click();
  assert.equal(feed.scrollTop, 200);
  assert.equal($('nt-new').hidden, true);
});

test('leaving unsubscribes from the feed', async () => {
  const { screen, calls, listeners } = setup({ notes: SAMPLE });
  await screen.show('hers');
  assert.equal(calls.listen, 1);
  assert.equal(listeners.size, 1);
  screen.leave();
  assert.equal(calls.unsub, 1);
  assert.equal(listeners.size, 0);
  screen.leave(); // leaving twice is harmless
  assert.equal(calls.unsub, 1);
});

test('showing twice never leaves two listeners', async () => {
  const { screen, calls, listeners } = setup({ notes: SAMPLE });
  await screen.show('hers');
  await screen.show('his');
  assert.equal(calls.listen, 2);
  assert.equal(calls.unsub, 1);
  assert.equal(listeners.size, 1);
});

test('clear() (sign-out) unsubscribes and wipes notes, names and any typed text', async () => {
  const { screen, $, calls, listeners, items } = setup({ notes: SAMPLE });
  await screen.show('hers');
  $('nt-text').value = 'half a thought';
  screen.clear();
  assert.equal(calls.unsub, 1);
  assert.equal(listeners.size, 0);
  assert.equal(items().length, 0);
  assert.equal($('nt-text').value, '');
  assert.equal($('nt-empty').hidden, true);
  assert.equal($('nt-live').textContent, '');
});

test('a reply that arrives after leaving does not redraw', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { screen, items } = setup({ notes: SAMPLE, data: { getMembers: async () => { await gate; return { names: { hers: 'Maya', his: 'Sam' } }; } } });
  const p = screen.show('hers');
  screen.clear();
  release();
  await p; await tick();
  assert.equal(items().length, 0);
});

test('a feed that cannot open shows a friendly alert instead of crashing', async () => {
  const { screen, $ } = setup({ data: { listenNotes: () => { throw new Error('Could not open the notes.'); } } });
  await screen.show('hers');
  assert.equal($('nt-error').textContent, 'Could not open the notes.');
  assert.equal($('nt-error').hidden, false);
});

test('works on the real demo adapter: Hers writes, His sees it, only own notes have Delete', async () => {
  const storage = new MemoryStorage();
  const adapter = createDemoAdapter(storage);
  const doc = makeNotesDom();
  const make = () => createNotes({ data: adapter, document: doc, now: () => new Date(), rail: { show() {} }, showScreen() {} });
  await adapter.signIn('hers');
  const hers = make();
  await hers.show('hers');
  const list = doc.byId['nt-list'];
  const notesIn = () => list.children.filter((c) => c.className.split(' ').includes('nt-note'));
  const before = notesIn().length;
  doc.byId['nt-text'].value = 'A little note';
  doc.byId['nt-send'].click(); await tick();
  assert.equal(notesIn().length, before + 1);
  assert.equal(list.children.at(-1).byClass('nt-text')[0].textContent, 'A little note');
  hers.leave();
  await adapter.signOut();
  await adapter.signIn('his');
  const his = make();
  await his.show('his');
  assert.ok(notesIn().length > 0);
  for (const li of notesIn()) {
    assert.equal(button(li, 'Delete').length, li.className.includes('nt-own') ? 1 : 0);
  }
  his.leave();
});

test('Ctrl+Enter pressed twice, or held down, before the add finishes posts the note once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { screen, $, calls } = setup({ data: { addNote: async (text) => { calls.addNote.push(text); await gate; } } });
  await screen.show('hers');
  $('nt-text').value = 'only once';
  $('nt-text').dispatch('keydown', { key: 'Enter', ctrlKey: true });
  $('nt-text').dispatch('keydown', { key: 'Enter', ctrlKey: true });
  $('nt-text').dispatch('keydown', { key: 'Enter', metaKey: true, repeat: true });
  $('nt-send').click();
  release(); await tick(); await tick();
  assert.deepEqual(calls.addNote, ['only once']);
});

test('a key-repeat Ctrl+Enter alone does not send', async () => {
  const { screen, $, calls } = setup();
  await screen.show('hers');
  $('nt-text').value = 'x';
  $('nt-text').dispatch('keydown', { key: 'Enter', ctrlKey: true, repeat: true });
  await tick();
  assert.equal(calls.addNote.length, 0);
});

// --- sample mode: the viewer switch ---------------------------------------
const switchLabel = ($) => $('nt-switch').textContent;

test('the viewer switch is hidden outside sample mode', async () => {
  const { screen, $ } = setup({ notes: SAMPLE });
  await screen.show('hers');
  assert.equal($('nt-switch').hidden, true);
});

test('outside sample mode, pressing the switch does nothing (no sign-in)', async () => {
  const { screen, $, calls } = setup({ notes: SAMPLE });
  await screen.show('hers');
  $('nt-switch').click(); await tick(); await tick();
  assert.deepEqual(calls.signIn, []);
  assert.equal(calls.order.length, 0);
});

test('in sample mode the switch is a real button naming who is seen and who is next', async () => {
  const { screen, $ } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  assert.equal($('nt-switch').hidden, false);
  assert.equal(switchLabel($), 'Seen from Hers. Switch to His');
  assert.equal($('nt-switch').type, 'button');
  await screen.show('his');
  assert.equal(switchLabel($), 'Seen from His. Switch to Hers');
});

test('switching signs in as the other person (never signs out), flips the sides, announces, keeps focus', async () => {
  const { screen, $, calls, doc, items } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  $('nt-switch').focus();
  $('nt-switch').click(); await tick(); await tick();
  assert.deepEqual(calls.signIn, ['his']);
  assert.equal(calls.signOut, 0);
  assert.equal(switchLabel($), 'Seen from His. Switch to Hers');
  assert.equal($('nt-live').textContent, 'Now seen from His');
  assert.equal(doc.activeElement, $('nt-switch'));
  const [a, b, c] = items();
  assert.ok(a.className.includes('nt-own') && button(a, 'Delete').length === 1);
  assert.ok(b.className.includes('nt-other') && button(b, 'Delete').length === 0);
  assert.ok(c.className.includes('nt-own'));
});

test('switching back and forth never doubles the subscription or leaks a listener', async () => {
  const { screen, $, calls, listeners, items } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  assert.equal(listeners.size, 1);
  for (let i = 0; i < 4; i++) { $('nt-switch').click(); await tick(); await tick(); }
  assert.equal(listeners.size, 1);
  assert.equal(calls.listen, 5);
  assert.equal(calls.unsub, 4);
  assert.equal(items().length, 3);
  assert.deepEqual(calls.signIn, ['his', 'hers', 'his', 'hers']);
  assert.equal(switchLabel($), 'Seen from Hers. Switch to His');
});

test('a second press while a switch is in flight is ignored', async () => {
  const { screen, $, calls } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  $('nt-switch').click(); $('nt-switch').click();
  await tick(); await tick();
  assert.deepEqual(calls.signIn, ['his']);
});

test('the person leaving is cleaned up first, and typed text never crosses over', async () => {
  const { screen, $, calls } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  $('nt-text').value = 'a half-written note to him';
  $('nt-text').dispatch('input');
  $('nt-switch').click(); await tick(); await tick();
  assert.deepEqual(calls.order, ['before', 'signIn']);
  assert.equal($('nt-text').value, '');
  assert.equal($('nt-count').hidden, true);
});

test('a failed switch keeps the current viewer and says so', async () => {
  const { screen, $, calls, items, listeners } = setup({ notes: SAMPLE, signInFails: true, screen: { demo: true } });
  await screen.show('hers');
  $('nt-switch').click(); await tick(); await tick();
  assert.equal($('nt-error').hidden, false);
  assert.equal(switchLabel($), 'Seen from Hers. Switch to His');
  assert.equal(calls.signOut, 0);
  assert.equal(listeners.size, 1);
  assert.ok(items()[1].className.includes('nt-own'));
});

test('an old listener cannot draw into the new viewer, and leave() stops the new one', async () => {
  const { screen, $, listeners, calls } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  const old = [...listeners][0];
  $('nt-switch').click(); await tick(); await tick();
  old([note('zz', 'his', 'stale')]);
  assert.equal($('nt-list').children.filter((c) => c.className.includes('nt-note')).length, 3);
  screen.leave();
  assert.equal(listeners.size, 0);
  assert.equal(calls.unsub, 2);
});

// --- the thread of light ----------------------------------------------------
const cls = (e) => e.className.split(' ');
const seps = (rows) => rows.filter((c) => cls(c).includes('nt-sep'));

test('a day separator appears whenever the local day changes, and not between notes of one day', async () => {
  const { screen, rows } = setup({ notes: [
    note('d', 'his', 'late', t(5, 9, 0)),
    note('c', 'hers', 'early', t(5, 7, 15)),
    note('b', 'his', 'last night', t(4, 23, 50)),
    note('a', 'hers', 'old', t(1, 8, 0)),
  ] });
  await screen.show('hers');
  assert.deepEqual(rows().map((x) => (cls(x).includes('nt-sep') ? `sep:${x.textContent}` : x.byClass('nt-text')[0].textContent)),
    ['sep:1 November', 'old', 'sep:Yesterday', 'last night', 'sep:Today', 'early', 'late']);
});

test('separators use local days: 23:59 and 00:01 land on different days, even a minute apart', async () => {
  const { screen, rows } = setup({ notes: [note('b', 'his', 'b', t(5, 0, 1)), note('a', 'hers', 'a', t(4, 23, 59))] });
  await screen.show('hers');
  assert.deepEqual(seps(rows()).map((x) => x.textContent), ['Yesterday', 'Today']);
});

test('no separator is drawn for a note with no usable time', async () => {
  const { screen, rows } = setup({ notes: [{ id: 'x', authorDoor: 'hers', text: 'undated' }] });
  await screen.show('hers');
  assert.equal(seps(rows()).length, 0);
});

test('a separator is plain text, not a control', async () => {
  const { screen, rows } = setup({ notes: SAMPLE });
  await screen.show('hers');
  assert.ok(seps(rows()).length > 0);
  for (const s of seps(rows())) {
    assert.equal(s.children.length, 0);
    assert.equal(s.find((x) => x.tag === 'button').length, 0);
  }
});

test('each note has an aria-hidden dot on the thread, a card, and the author name and time', async () => {
  const { screen, items } = setup({ notes: SAMPLE });
  await screen.show('hers');
  await tick();
  for (const li of items()) {
    const dot = li.children.find((c) => cls(c).includes('nt-dot'));
    assert.ok(dot, 'the dot is a direct child of the note, so it can sit on the line');
    assert.equal(dot.getAttribute('aria-hidden'), 'true');
    assert.equal(li.byClass('nt-card').length, 1);
  }
  const [a, b] = items();
  assert.ok(cls(a).includes('nt-by-his') && cls(b).includes('nt-by-hers'));
  assert.ok(a.byClass('nt-meta')[0].textContent.startsWith('Sam'));
});

test('the sides still follow the viewer: own right, other left, with separators between', async () => {
  const { screen, $, items, rows } = setup({ notes: SAMPLE, screen: { demo: true } });
  await screen.show('hers');
  assert.equal(rows().length, 5); // 2 separators + 3 notes
  assert.deepEqual(items().map((x) => cls(x).includes('nt-own')), [false, true, false]);
  $('nt-switch').click(); await tick(); await tick();
  assert.deepEqual(items().map((x) => cls(x).includes('nt-own')), [true, false, true]);
});

test('a note arriving on the same day adds no separator', async () => {
  const { screen, push, rows } = setup({ notes: [note('a', 'his', 'first', t(5, 8, 0))] });
  await screen.show('hers');
  assert.equal(seps(rows()).length, 1);
  push(note('b', 'his', 'second', t(5, 11, 0)));
  assert.equal(seps(rows()).length, 1);
  assert.equal(rows().length, 3);
});

test('Delete sits on the card, the confirm pair replaces it, and focus follows', async () => {
  const { screen, doc, items } = setup({ notes: SAMPLE });
  await screen.show('hers');
  const card = items()[1].byClass('nt-card')[0];
  assert.equal(button(card, 'Delete').length, 1);
  button(card, 'Delete')[0].click();
  assert.equal(doc.activeElement.textContent, 'Yes, delete');
  assert.equal(button(items()[1], 'Keep it').length, 1);
});

test('day separators are role="presentation", so screen readers count only the notes as list items', async () => {
  const { screen, rows } = setup({ notes: SAMPLE });
  await screen.show('hers');
  const sp = seps(rows());
  assert.ok(sp.length > 0);
  for (const s of sp) assert.equal(s.getAttribute('role'), 'presentation');
  for (const r of rows().filter((c) => !seps([c]).length)) assert.equal(r.getAttribute('role'), null);
});

test('a note sent from a journal shows "From her/his journal" by its AUTHOR, other notes do not', async () => {
  const mk = (id, door, source) => ({ id, authorDoor: door, text: id, createdAt: NOW.getTime() - 1000 * (10 - id.length), ...(source ? { source } : {}) });
  const s = setup({ notes: [mk('aaaa', 'his', 'entry'), mk('bbb', 'hers', 'entry'), mk('cc', 'hers')] });
  await s.screen.show('hers'); // the viewer is Hers
  const labelOf = (id) => s.items().find((li) => li.byClass('nt-text')[0].textContent === id).byClass('nt-from').map((x) => x.textContent);
  assert.deepEqual(labelOf('aaaa'), ['From his journal']); // his note seen by her: his journal
  assert.deepEqual(labelOf('bbb'), ['From her journal']);
  assert.deepEqual(labelOf('cc'), []);
  assert.equal(s.items().length, 3);
});

// --- dictation on Notes -----------------------------------------------------
import { makeSpeechWin, engines } from './helpers/fake-speech.js';

function dictSetup(over = {}) {
  const win = makeSpeechWin();
  return { ...setup({ ...over, screen: { win, ...(over.screen || {}) } }), win };
}

test('dictation: the Dictate button shows on Notes but nothing listens until it is pressed', async () => {
  const s = dictSetup();
  await s.screen.show('hers');
  assert.equal(s.$('nt-dictate').hidden, false);
  assert.equal(engines().length, 0);
});

test('dictation: heard words land in the composer and the count updates', async () => {
  const s = dictSetup();
  await s.screen.show('hers');
  s.$('nt-dictate').click();
  engines()[0].say('see you at seven', true);
  assert.equal(s.$('nt-text').value, 'see you at seven');
  engines()[0].say('x'.repeat(1990), true);
  assert.match(s.$('nt-count').textContent, /left|over/, 'the counter heard about the change');
});

test('dictation: leaving, signing out, showing again and switching viewer each stop the microphone', async () => {
  for (const how of ['leave', 'clear', 'show', 'switch']) {
    const s = dictSetup({ screen: { demo: true } });
    await s.screen.show('hers');
    s.$('nt-dictate').click();
    const e = engines()[0];
    assert.equal(e.running, true);
    if (how === 'leave') s.screen.leave();
    else if (how === 'clear') s.screen.clear();
    else if (how === 'show') await s.screen.show('his');
    else { s.$('nt-switch').click(); await tick(); await tick(); }
    assert.equal(e.running, false, how);
    assert.equal(e.aborted, 1, how);
  }
});

test('dictation: Leave note stops gently and sends the last words that were being heard', async () => {
  const s = dictSetup();
  await s.screen.show('hers');
  s.$('nt-dictate').click();
  const e = engines()[0];
  e.say('hello there', true);
  e.say('and one more', false);
  s.$('nt-send').click(); await wait(30);
  assert.equal(e.stopped, 1);
  assert.equal(e.aborted, 1);
  assert.deepEqual(s.calls.addNote, ['hello there and one more']);
});

test('dictation: switching viewer turns the microphone off at once, before anything is awaited', async () => {
  const s = dictSetup({ screen: { demo: true } });
  await s.screen.show('hers');
  s.$('nt-dictate').click();
  const e = engines()[0];
  s.$('nt-switch').click();
  assert.equal(e.aborted, 1);
  assert.equal(e.running, false);
  await tick(); await tick();
});

test('dictation: dictating past 2,000 characters stops with a plain message and keeps the counter', async () => {
  const s = dictSetup();
  await s.screen.show('hers');
  s.$('nt-dictate').click();
  const e = engines()[0];
  e.say('x'.repeat(2100), true);
  assert.equal(e.stopped, 1);
  assert.equal(s.$('nt-dc-alert').textContent, 'Stopped: a note can hold 2,000 characters.');
  assert.match(s.$('nt-count').textContent, /over/);
});
