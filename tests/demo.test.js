// Must run before any Date is created.
process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoAdapter } from '../js/data/demo.js';

class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const fresh = () => { const storage = new MemoryStorage(); return { storage, data: createDemoAdapter(storage) }; };
const demoKeys = (s) => [...s.m.keys()].filter((k) => k.startsWith('journal-demo:'));
const notesNow = (data) => { let n; data.listenNotes((x) => { n = x; })(); return n; };

test('signIn gives a session for hers and his, and rejects anything else', async () => {
  const { data } = fresh();
  assert.equal(data.currentSession(), null);
  const s = await data.signIn('hers');
  assert.equal(s.door, 'hers');
  assert.deepEqual(data.currentSession(), s);
  await assert.rejects(data.signIn('notes'));
  await assert.rejects(data.signIn('admin'));
});

test('data methods refuse to run when signed out', async () => {
  const { data } = fresh();
  await assert.rejects(data.getMoods());
  await assert.rejects(data.addEntry('x'));
  await assert.rejects(data.addNote('x'));
});

test('seed: about 30 days of moods, a few entries, notes; each person has their own', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  assert.ok(Object.keys(await data.getMoods()).length >= 28);
  const hersEntries = await data.listEntries();
  assert.ok(hersEntries.length >= 3);
  await data.signOut();
  await data.signIn('his');
  const hisEntries = await data.listEntries();
  assert.ok(hisEntries.length >= 3);
  assert.notEqual(hisEntries.map((e) => e.text).join('|'), hersEntries.map((e) => e.text).join('|'));
  const notes = notesNow(data);
  assert.ok(notes.length >= 3);
  assert.ok(notes.some((n) => n.authorDoor === 'hers') && notes.some((n) => n.authorDoor === 'his'));
});

test('a mood saves, and saving the same day again updates the one record', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  const day = '2020-01-15';
  await data.saveMood(day, 4, 'tired');
  await data.saveMood(day, 8);
  const moods = await data.getMoods();
  assert.equal(Object.keys(moods).filter((k) => k === day).length, 1);
  assert.equal(moods[day].score, 8);
  await data.saveMood(day, 6, 'better');
  assert.deepEqual((await data.getMoods())[day], { score: 6, note: 'better' });
});

test('an invalid score is rejected and nothing is stored', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  for (const bad of [0, 11, 5.5, -1, NaN, '7', null, undefined]) {
    await assert.rejects(data.saveMood('2020-02-01', bad), `score ${String(bad)}`);
  }
  assert.equal((await data.getMoods())['2020-02-01'], undefined);
  await assert.rejects(data.saveMood('not-a-day', 5));
});

test('an entry written at local 23:30 lands on that local day', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  const id = await data.addEntry('late night thought', new Date(2026, 10, 5, 23, 30));
  const e = (await data.listEntries()).find((x) => x.id === id);
  assert.equal(e.day, '2026-11-05');
});

test('two entries on the same day are both listed, newest first', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  const a = await data.addEntry('first one', new Date(2031, 2, 3, 9, 0));
  const b = await data.addEntry('second one', new Date(2031, 2, 3, 21, 0));
  const list = (await data.listEntries()).filter((e) => e.day === '2031-03-03');
  assert.deepEqual(list.map((e) => e.id), [b, a]);
  assert.notEqual(a, b);
});

test('markup in text round-trips as plain text, unchanged', async () => {
  const { data } = fresh();
  await data.signIn('his');
  const s = '<script>alert(1)</script> & "quotes" 😀 **md**';
  const id = await data.addEntry(s);
  assert.equal((await data.listEntries()).find((e) => e.id === id).text, s);
  const nid = await data.addNote(s);
  assert.equal(notesNow(data).find((n) => n.id === nid).text, s);
});

test('blank entries and notes are rejected', async () => {
  const { data } = fresh();
  await data.signIn('his');
  await assert.rejects(data.addEntry('   '));
  await assert.rejects(data.addNote(''));
});

test('deleteEntry and deleteNote remove them; listenNotes pushes updates and can stop', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  const id = await data.addEntry('to go', new Date(2031, 5, 1, 10, 0));
  await data.deleteEntry(id);
  assert.ok(!(await data.listEntries()).some((e) => e.id === id));
  const seen = [];
  const off = data.listenNotes((n) => seen.push(n.length));
  const nid = await data.addNote('hello');
  await data.deleteNote(nid);
  off();
  await data.addNote('after unsubscribe');
  assert.equal(seen.length, 3);
  assert.equal(seen[1], seen[0] + 1);
  assert.equal(seen[2], seen[0]);
});

test("one person never sees the other person's journal data", async () => {
  const { data } = fresh();
  await data.signIn('hers');
  await data.addEntry('only hers', new Date(2031, 6, 1, 10, 0));
  await data.saveMood('2031-07-01', 9);
  await data.signOut();
  await data.signIn('his');
  assert.ok(!(await data.listEntries()).some((e) => e.text === 'only hers'));
  assert.equal((await data.getMoods())['2031-07-01'], undefined);
});

test('signOut empties the demo store and the in-memory cache', async () => {
  const { storage, data } = fresh();
  await data.signIn('hers');
  await data.addEntry('keep me out of the next session', new Date(2031, 6, 2, 10, 0));
  assert.ok(demoKeys(storage).length > 0);
  await data.signOut();
  assert.deepEqual(demoKeys(storage), []);
  assert.equal(data.currentSession(), null);
  await assert.rejects(data.listEntries());
  // Signing in again starts from a clean seed, not from the old session's data.
  await data.signIn('hers');
  assert.ok(!(await data.listEntries()).some((e) => e.text.startsWith('keep me out')));
});

test('getMembers returns names and doors', async () => {
  const { data } = fresh();
  const m = await data.getMembers();
  assert.deepEqual(m.names, { hers: 'Hers', his: 'His' });
  assert.ok(m.doors.hers && m.doors.his && m.doors.hers !== m.doors.his);
});

test('signing in as His directly after Hers (no signOut) shows none of Hers\' data', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  await data.saveMood('2031-08-01', 9, 'hers only');
  await data.addEntry('hers private entry', new Date(2031, 7, 1, 10, 0));
  await data.signIn('his');
  assert.equal((await data.getMoods())['2031-08-01'], undefined);
  assert.ok(!(await data.listEntries()).some((e) => e.text === 'hers private entry'));
});

test('very long and awkward entries round-trip unchanged', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  const long = 'a'.repeat(10500) + ' end';
  const awkward = '😀 *bold* _it_ # h `code` [l](u) "q" \'s\' <script>alert(1)</script> & é\nline2';
  const a = await data.addEntry(long, new Date(2031, 8, 1, 9, 0));
  const b = await data.addEntry(awkward, new Date(2031, 8, 1, 10, 0));
  const list = await data.listEntries();
  assert.equal(list.find((e) => e.id === a).text, long);
  assert.equal(list.find((e) => e.id === b).text, awkward);
});

// Storage failure handling.
class FlakyStorage extends MemoryStorage {
  constructor() { super(); this.failSet = false; this.failRemove = false; }
  setItem(k, v) { if (this.failSet) throw new Error('QuotaExceededError'); super.setItem(k, v); }
  removeItem(k) { if (this.failRemove) throw new Error('blocked'); super.removeItem(k); }
}

test('a throwing localStorage getter falls back to in-memory storage', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    const data = createDemoAdapter();
    await data.signIn('hers');
    const id = await data.addEntry('works without storage', new Date(2031, 9, 1, 9, 0));
    assert.ok((await data.listEntries()).some((e) => e.id === id));
    await data.signOut();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
});

test('signIn still works when seeding cannot be written', async () => {
  const storage = new FlakyStorage();
  storage.failSet = true;
  const data = createDemoAdapter(storage);
  await data.signIn('his');
  assert.ok((await data.listEntries()).length >= 3);
});

test('a failed write gives a friendly error and leaves memory and storage unchanged', async () => {
  const storage = new FlakyStorage();
  const data = createDemoAdapter(storage);
  await data.signIn('hers');
  const moodsBefore = await data.getMoods();
  const entriesBefore = await data.listEntries();
  let notesBefore;
  data.listenNotes((n) => { notesBefore = n; })();
  storage.failSet = true;
  await assert.rejects(data.saveMood('2031-10-01', 5), /device/);
  await assert.rejects(data.addEntry('will not save', new Date(2031, 9, 1, 9, 0)), /device/);
  await assert.rejects(data.addNote('will not save'), /device/);
  await assert.rejects(data.deleteEntry(entriesBefore[0].id), /device/);
  assert.deepEqual(await data.getMoods(), moodsBefore);
  assert.deepEqual(await data.listEntries(), entriesBefore);
  assert.deepEqual(notesNow(data), notesBefore);
});

test('signOut finishes clearing even if removeItem throws', async () => {
  const storage = new FlakyStorage();
  const data = createDemoAdapter(storage);
  await data.signIn('hers');
  storage.failRemove = true;
  await assert.doesNotReject(data.signOut());
  assert.equal(data.currentSession(), null);
  await assert.rejects(data.getMoods());
});

test('drafts: saved per person under the journal-demo: prefix, restored, and cleared by signOut', async () => {
  const { data, storage } = fresh();
  await data.signIn('hers');
  assert.equal(await data.getDraft(), '');
  await data.saveDraft('half a thought\nmore');
  assert.equal(await data.getDraft(), 'half a thought\nmore');
  assert.ok(demoKeys(storage).some((k) => k.startsWith('journal-demo:draft:')));
  await data.signOut();
  assert.equal(demoKeys(storage).length, 0);
  await data.signIn('his');
  assert.equal(await data.getDraft(), '');
  await data.signIn('hers');
  assert.equal(await data.getDraft(), '');
});

test('drafts: his and hers do not see each other, empty text removes the draft, signed out rejects', async () => {
  const { data } = fresh();
  await assert.rejects(data.getDraft());
  await assert.rejects(data.saveDraft('x'));
  await data.signIn('hers');
  await data.saveDraft('hers draft');
  await data.signIn('his');
  assert.equal(await data.getDraft(), '');
  await data.signIn('hers');
  assert.equal(await data.getDraft(), 'hers draft');
  await data.saveDraft('');
  assert.equal(await data.getDraft(), '');
});

test('drafts: when storage cannot be written the draft is kept in memory and nothing throws', async () => {
  const storage = new MemoryStorage();
  const data = createDemoAdapter(storage);
  await data.signIn('hers');
  storage.setItem = () => { throw new Error('full'); };
  await data.saveDraft('still here');
  assert.equal(await data.getDraft(), 'still here');
});

test('a 50,000-character entry and draft round-trip quickly', async () => {
  const { data } = fresh();
  await data.signIn('hers');
  const big = 'word \u{1F319} '.repeat(7000).slice(0, 50000);
  const t0 = Date.now();
  await data.saveDraft(big);
  const id = await data.addEntry(big);
  const list = await data.listEntries();
  assert.equal(list.find((e) => e.id === id).text, big);
  assert.equal(await data.getDraft(), big);
  assert.ok(Date.now() - t0 < 2000);
});

test('drafts: a saved entry clears the draft even when removeItem throws, also after a restart', async () => {
  const storage = new MemoryStorage();
  const data = createDemoAdapter(storage);
  await data.signIn('hers');
  await data.saveDraft('old draft text');
  storage.removeItem = () => { throw new Error('blocked'); };
  await data.addEntry('old draft text');
  await data.saveDraft('');
  assert.equal(await data.getDraft(), '');
  const again = createDemoAdapter(storage);
  await again.signIn('hers');
  assert.equal(await again.getDraft(), '');
});

test('drafts: signOut with a throwing removeItem leaves no readable draft', async () => {
  const storage = new MemoryStorage();
  const data = createDemoAdapter(storage);
  await data.signIn('hers');
  await data.saveDraft('private words');
  storage.removeItem = () => { throw new Error('blocked'); };
  await data.signOut();
  await data.signIn('hers');
  assert.equal(await data.getDraft(), '');
  const again = createDemoAdapter(storage);
  await again.signIn('hers');
  assert.equal(await again.getDraft(), '');
});
