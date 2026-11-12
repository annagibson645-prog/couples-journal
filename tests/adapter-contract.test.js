// Must run before any Date is created.
process.env.TZ = 'America/Los_Angeles';

// One behaviour suite, run against BOTH data adapters (js/data/contract.md):
//   demo      js/data/demo.js over an in-memory store
//   firebase  js/data/firebase.js over the in-memory fake SDK (tests/helpers/fake-firebase.js)
// Nothing here may rely on the demo's sample seed: use dates far from today and find things by id.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoAdapter } from '../js/data/demo.js';
import { createFirebaseAdapter } from '../js/data/firebase.js';
import { createFakeFirebase } from './helpers/fake-firebase.js';

class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const targets = [
  {
    name: 'demo',
    async make() {
      const data = createDemoAdapter(new MemoryStorage());
      await data.ready();
      return { data, creds: { hers: undefined, his: undefined } };
    },
  },
  {
    name: 'firebase',
    async make() {
      const fake = createFakeFirebase();
      const data = createFirebaseAdapter({ sdk: fake.sdk, config: { projectId: 'demo-journal' } });
      await data.ready();
      return { data, creds: fake.credentials, fake };
    },
  },
];

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// The current notes, read once (the callback may come at once or a moment later).
function notesNow(data) {
  return new Promise((resolve, reject) => {
    let stop = null;
    let done = false;
    stop = data.listenNotes((n) => {
      if (done) return;
      done = true;
      resolve(n);
      Promise.resolve().then(() => stop && stop());
    }, reject);
  });
}

for (const t of targets) {
  describe(`adapter contract: ${t.name}`, () => {
    const setup = async () => {
      const { data, creds } = await t.make();
      return { data, creds, login: (door) => data.signIn(door, creds[door]) };
    };

    test('ready() resolves and nobody is signed in yet', async () => {
      const { data } = await setup();
      await data.ready();
      assert.equal(data.currentSession(), null);
    });

    test('signIn gives a session for hers and his, and rejects any other door', async () => {
      const { data, creds, login } = await setup();
      const s = await login('hers');
      assert.equal(s.door, 'hers');
      assert.ok(s.uid);
      assert.deepEqual(data.currentSession(), s);
      await assert.rejects(data.signIn('notes', creds.hers));
      await assert.rejects(data.signIn('admin', creds.hers));
    });

    test('data methods refuse to run when signed out, with a plain message', async () => {
      const { data } = await setup();
      for (const call of [
        () => data.getMoods(), () => data.saveMood('2031-01-01', 5), () => data.addEntry('x'), () => data.listEntries(),
        () => data.deleteEntry('x'), () => data.saveDraft('x'), () => data.getDraft(), () => data.addNote('x'), () => data.deleteNote('x'),
      ]) {
        await assert.rejects(call(), /Not signed in\./);
      }
      assert.throws(() => data.listenNotes(() => {}), /Not signed in\./);
    });

    test('a mood saves, and saving the same day again replaces the one record', async () => {
      const { data, login } = await setup();
      await login('hers');
      const day = '2031-01-15';
      await data.saveMood(day, 4, 'tired');
      await data.saveMood(day, 8);
      const moods = await data.getMoods();
      assert.deepEqual(moods[day], { score: 8 });
      await data.saveMood(day, 6, 'better');
      assert.deepEqual((await data.getMoods())[day], { score: 6, note: 'better' });
    });

    test('an invalid score or day is rejected and nothing is stored', async () => {
      const { data, login } = await setup();
      await login('hers');
      for (const bad of [0, 11, 5.5, -1, NaN, '7', null, undefined]) {
        await assert.rejects(data.saveMood('2031-02-01', bad), `score ${String(bad)}`);
      }
      await assert.rejects(data.saveMood('not-a-day', 5));
      assert.equal((await data.getMoods())['2031-02-01'], undefined);
    });

    test('an entry written at local 23:30 lands on that local day', async () => {
      const { data, login } = await setup();
      await login('hers');
      const id = await data.addEntry('late night thought', new Date(2031, 10, 5, 23, 30));
      const e = (await data.listEntries()).find((x) => x.id === id);
      assert.equal(e.day, '2031-11-05');
      assert.equal(e.createdAt, new Date(2031, 10, 5, 23, 30).getTime());
    });

    test('two entries on one day are both listed, newest first', async () => {
      const { data, login } = await setup();
      await login('hers');
      const a = await data.addEntry('first one', new Date(2031, 2, 3, 9, 0));
      const b = await data.addEntry('second one', new Date(2031, 2, 3, 21, 0));
      const list = (await data.listEntries()).filter((e) => e.day === '2031-03-03');
      assert.deepEqual(list.map((e) => e.id), [b, a]);
      assert.notEqual(a, b);
    });

    test('createdAt is always a finite number', async () => {
      const { data, login } = await setup();
      await login('hers');
      await data.addEntry('stamp me');
      const nid = await data.addNote('stamp me too');
      for (const e of await data.listEntries()) assert.ok(Number.isFinite(e.createdAt), 'entry');
      for (const n of await notesNow(data)) assert.ok(Number.isFinite(n.createdAt), `note ${n.id}`);
      assert.ok((await notesNow(data)).some((n) => n.id === nid));
    });

    test('entry text round-trips exactly: emoji, markup, 12,000 and 50,000 characters', async () => {
      const { data, login } = await setup();
      await login('his');
      const samples = [
        '<script>alert(1)</script> & "quotes" 😀 **md**',
        '😀 *bold* _it_ # h `code` [l](u) "q" \'s\' <script>alert(1)</script> & é\nline2',
        'a'.repeat(12000) + ' end',
        'word \u{1F319} '.repeat(7000).slice(0, 50000),
      ];
      const ids = [];
      for (let i = 0; i < samples.length; i++) ids.push(await data.addEntry(samples[i], new Date(2031, 8, 1, 9 + i, 0)));
      const list = await data.listEntries();
      samples.forEach((s, i) => assert.equal(list.find((e) => e.id === ids[i]).text, s, `sample ${i}`));
    });

    test('note text round-trips exactly: emoji, markup, and the 2,000-character limit', async () => {
      const { data, login } = await setup();
      await login('his');
      const samples = ['<script>alert(1)</script> & "quotes" 😀 **md**', 'line one\nline two é', 'n'.repeat(2000)];
      const ids = [];
      for (const s of samples) ids.push(await data.addNote(s));
      const notes = await notesNow(data);
      samples.forEach((s, i) => assert.equal(notes.find((n) => n.id === ids[i]).text, s, `sample ${i}`));
    });

    test('blank entries and notes are rejected', async () => {
      const { data, login } = await setup();
      await login('his');
      await assert.rejects(data.addEntry('   '));
      await assert.rejects(data.addEntry(42));
      await assert.rejects(data.addNote(''));
    });

    test('deleteEntry removes the entry', async () => {
      const { data, login } = await setup();
      await login('hers');
      const id = await data.addEntry('to go', new Date(2031, 5, 1, 10, 0));
      await data.deleteEntry(id);
      assert.ok(!(await data.listEntries()).some((e) => e.id === id));
    });

    test('listenNotes reports changes, newest first, and stops when asked', async () => {
      const { data, login } = await setup();
      await login('hers');
      const seen = [];
      const off = data.listenNotes((n) => seen.push(n));
      await tick();
      const base = seen[seen.length - 1].length;
      const a = await data.addNote('older');
      await tick(2);
      const b = await data.addNote('newer');
      await tick();
      const last = seen[seen.length - 1];
      assert.equal(last.length, base + 2);
      const ia = last.findIndex((n) => n.id === a);
      const ib = last.findIndex((n) => n.id === b);
      assert.ok(ib < ia, 'newest first');
      await data.deleteNote(a);
      await tick();
      assert.ok(!seen[seen.length - 1].some((n) => n.id === a));
      off();
      const count = seen.length;
      await data.addNote('after unsubscribe');
      await tick();
      assert.equal(seen.length, count);
    });

    test('listenNotes takes an optional error callback and does not call it when all is well', async () => {
      const { data, login } = await setup();
      await login('hers');
      let errors = 0;
      const off = data.listenNotes(() => {}, () => { errors++; });
      await tick();
      off();
      assert.equal(errors, 0);
    });

    test('notes: you delete your own, never the other person\'s', async () => {
      const { data, login } = await setup();
      await login('hers');
      const hers = await data.addNote('from hers');
      await login('his');
      const before = await notesNow(data);
      assert.equal(before.find((n) => n.id === hers).authorDoor, 'hers');
      await assert.rejects(data.deleteNote(hers), /only delete your own/);
      assert.ok((await notesNow(data)).some((n) => n.id === hers));
      const his = await data.addNote('from his');
      await login('hers');
      await assert.rejects(data.deleteNote(his), /only delete your own/);
      await data.deleteNote(hers);
      const after = await notesNow(data);
      assert.ok(!after.some((n) => n.id === hers));
      assert.ok(after.some((n) => n.id === his));
    });

    test('the note\'s author is whoever was signed in when addNote was called', async () => {
      const { data, login } = await setup();
      await login('his');
      const id = await data.addNote('mine');
      const note = (await notesNow(data)).find((n) => n.id === id);
      assert.equal(note.authorDoor, 'his');
    });

    test('addNote with { source: "entry" } keeps the source; any other value is dropped', async () => {
      const { data, login } = await setup();
      await login('hers');
      const a = await data.addNote('from my journal', { source: 'entry' });
      const b = await data.addNote('typed in notes');
      const c = await data.addNote('odd source', { source: 'weird' });
      const d = await data.addNote('no opts object', {});
      const notes = await notesNow(data);
      assert.equal(notes.find((n) => n.id === a).source, 'entry');
      for (const id of [b, c, d]) assert.equal('source' in notes.find((n) => n.id === id), false);
    });

    test('drafts: one per person, plain text of any length, empty text removes it', async () => {
      const { data, login } = await setup();
      await login('hers');
      assert.equal(await data.getDraft(), '');
      await data.saveDraft('half a thought\nmore');
      assert.equal(await data.getDraft(), 'half a thought\nmore');
      const big = 'word \u{1F319} '.repeat(7000).slice(0, 50000);
      await data.saveDraft(big);
      assert.equal(await data.getDraft(), big);
      await login('his');
      assert.equal(await data.getDraft(), '');
      await login('hers');
      assert.equal(await data.getDraft(), big);
      await data.saveDraft('');
      assert.equal(await data.getDraft(), '');
    });

    test('one person never sees the other person\'s moods, entries or draft', async () => {
      const { data, login } = await setup();
      await login('hers');
      await data.addEntry('only hers', new Date(2031, 6, 1, 10, 0));
      await data.saveMood('2031-07-01', 9, 'hers only');
      await data.saveDraft('hers draft');
      await login('his'); // straight over, no signOut
      assert.ok(!(await data.listEntries()).some((e) => e.text === 'only hers'));
      assert.equal((await data.getMoods())['2031-07-01'], undefined);
      assert.equal(await data.getDraft(), '');
    });

    test('signOut ends the session and wipes drafts and notes listeners', async () => {
      const { data, login } = await setup();
      await login('hers');
      await data.saveDraft('private words');
      let calls = 0;
      data.listenNotes(() => { calls++; });
      await tick();
      await data.signOut();
      assert.equal(data.currentSession(), null);
      await assert.rejects(data.listEntries(), /Not signed in\./);
      await login('hers');
      assert.equal(await data.getDraft(), '');
      const before = calls;
      await data.addNote('after sign-out');
      await tick();
      assert.equal(calls, before, 'the old listener is gone');
    });

    test('signOut never rejects, even when called twice or while signed out', async () => {
      const { data, login } = await setup();
      await assert.doesNotReject(data.signOut());
      await login('hers');
      await assert.doesNotReject(data.signOut());
      await assert.doesNotReject(data.signOut());
      assert.equal(data.currentSession(), null);
    });

    test('getMembers returns names and two different doors', async () => {
      const { data, login } = await setup();
      await login('hers');
      const m = await data.getMembers();
      assert.deepEqual(m.names, { hers: 'Hers', his: 'His' });
      assert.ok(m.doors.hers && m.doors.his && m.doors.hers !== m.doors.his);
    });
  });
}
