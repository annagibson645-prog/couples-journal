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
