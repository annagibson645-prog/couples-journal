process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotes } from '../js/screens/notes.js';
import { createDemoAdapter } from '../js/data/demo.js';
import { makeNotesDom } from './helpers/fake-dom.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
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
    items: () => doc.byId['nt-list'].children,
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
  const before = list.children.length;
  doc.byId['nt-text'].value = 'A little note';
  doc.byId['nt-send'].click(); await tick();
  assert.equal(list.children.length, before + 1);
  assert.equal(list.children.at(-1).byClass('nt-text')[0].textContent, 'A little note');
  hers.leave();
  await adapter.signOut();
  await adapter.signIn('his');
  const his = make();
  await his.show('his');
  assert.ok(list.children.length > 0);
  for (const li of list.children) {
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
  assert.equal($('nt-list').children.length, 3);
  screen.leave();
  assert.equal(listeners.size, 0);
  assert.equal(calls.unsub, 2);
});
