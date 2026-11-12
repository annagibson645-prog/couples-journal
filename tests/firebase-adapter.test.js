process.env.TZ = 'America/Los_Angeles';

// Behaviour that belongs to the Firebase adapter only (the shared suite is adapter-contract.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFirebaseAdapter, loadFirebaseSdk, SDK_URLS, toFriendly } from '../js/data/firebase.js';
import { createFakeFirebase } from './helpers/fake-firebase.js';

const CONFIG = { projectId: 'demo-journal' };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const make = (opts = {}, fakeOpts) => {
  const fake = createFakeFirebase(fakeOpts);
  const data = createFirebaseAdapter({ sdk: fake.sdk, config: CONFIG, ...opts });
  return { fake, data };
};

test('the door comes from config/members, not from the form that was used', async () => {
  const { fake, data } = make();
  await data.ready();
  const s = await data.signIn('hers', fake.credentials.his); // His credentials on the Hers form
  assert.equal(s.door, 'his');
  assert.equal(s.uid, 'hisUid');
  const t = await data.signIn('his', fake.credentials.hers);
  assert.equal(t.door, 'hers');
});

test('a login that is not in config/members is refused and signed out again', async () => {
  const { fake, data } = make();
  await data.ready();
  await assert.rejects(data.signIn('hers', fake.credentials.stranger), /not part of this journal/);
  assert.equal(data.currentSession(), null);
  assert.equal(fake.world.persistedUid, null, 'the stranger is not left signed in');
});

test('sign-in errors are plain sentences with no Firebase codes', async () => {
  const { fake, data } = make();
  await data.ready();
  const bad = [
    [{ email: fake.credentials.hers.email, password: 'wrong' }, /email and password did not work/],
    [{ email: 'nobody@example.test', password: 'x' }, /email and password did not work/],
    [{ email: '', password: '' }, /Enter your email and password/],
    [undefined, /Enter your email and password/],
  ];
  for (const [creds, re] of bad) {
    await assert.rejects(data.signIn('hers', creds), (e) => re.test(e.message) && !/auth\/|Firebase/i.test(e.message));
  }
  for (const code of ['auth/too-many-requests', 'auth/network-request-failed', 'auth/user-disabled', 'auth/something-new']) {
    fake.world.failAuthCode = code;
    await assert.rejects(data.signIn('hers', fake.credentials.hers), (e) => !/auth\/|Firebase/i.test(e.message) && e.message.endsWith('.'), code);
  }
  assert.match(toFriendly({ code: 'auth/too-many-requests' }).message, /Too many tries/);
  assert.match(toFriendly({ code: 'unavailable' }).message, /internet/);
  assert.match(toFriendly({ code: 'permission-denied' }).message, /do not have access/);
  assert.match(toFriendly(new Error('secret@example.test leaked')).message, /Something went wrong/);
});

test('nothing is logged to the console while signing in, writing and signing out', async () => {
  const seen = [];
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { saved[k] = console[k]; console[k] = (...a) => seen.push(a); }
  try {
    const { fake, data } = make();
    await data.ready();
    await assert.rejects(data.signIn('hers', { email: fake.credentials.hers.email, password: 'wrong' }));
    await data.signIn('hers', fake.credentials.hers);
    await data.addEntry('private words');
    await data.signOut();
  } finally {
    for (const k of Object.keys(saved)) console[k] = saved[k];
  }
  assert.deepEqual(seen, []);
});

test('ready() restores a signed-in member from an earlier visit', async () => {
  const { fake, data } = make();
  fake.world.persistedUid = 'herUid';
  await data.ready();
  assert.deepEqual(data.currentSession(), { uid: 'herUid', door: 'hers' });
});

test('ready() signs a restored non-member out instead of restoring them', async () => {
  const { fake, data } = make();
  fake.world.persistedUid = 'strangerUid';
  await data.ready();
  assert.equal(data.currentSession(), null);
  assert.equal(fake.world.persistedUid, null);
});

test('ready() stays signed out when nobody was signed in, and does not hang if auth never answers', async () => {
  const { fake, data } = make();
  await data.ready();
  assert.equal(data.currentSession(), null);
  const other = createFakeFirebase();
  const slow = createFirebaseAdapter({ sdk: { ...other.sdk, onAuthStateChanged: () => () => {} }, config: CONFIG, authWaitMs: 20 });
  await slow.ready();
  assert.equal(slow.currentSession(), null);
});

test('signOut: ends the session, terminates then clears the device cache, and builds a fresh database', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  await data.addEntry('cached words');
  assert.ok(fake.world.cache.size > 0, 'something is cached on the device');
  const firstDb = fake.world.dbs[0];
  await data.signOut();
  const calls = fake.world.calls;
  assert.ok(calls.indexOf('terminate') > -1 && calls.indexOf('clearIndexedDbPersistence') > calls.indexOf('terminate'), calls.join(','));
  assert.equal(fake.world.cache.size, 0, 'the device cache is empty');
  assert.equal(fake.world.persistedUid, null, 'Firebase Auth is signed out');
  assert.equal(firstDb.terminated, true);
  assert.equal(fake.world.dbs.length, 2, 'a fresh database for the next sign-in');
  assert.equal(fake.world.dbs[1].terminated, false);
  assert.deepEqual([...fake.world.apps], ['journal'], 'the same fixed app name is reused');
  assert.deepEqual(fake.world.calls.filter((c) => c.startsWith('initializeApp')), ['initializeApp:journal', 'initializeApp:journal']);
  assert.equal(data.currentSession(), null);
  // The next person can sign in on the fresh instance.
  const s = await data.signIn('his', fake.credentials.his);
  assert.equal(s.door, 'his');
});

test('signOut still finishes when every cleanup step throws', async () => {
  const fake = createFakeFirebase();
  const boom = async () => { throw new Error('boom'); };
  const broken = createFirebaseAdapter({ sdk: { ...fake.sdk, terminate: boom, clearIndexedDbPersistence: boom, deleteApp: boom, signOut: boom }, config: CONFIG });
  await broken.ready();
  await broken.signIn('hers', fake.credentials.hers);
  await assert.doesNotReject(broken.signOut());
  assert.equal(broken.currentSession(), null);
});

test('signOut removes the unsent draft from the cloud copy too', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  await data.saveDraft('half a thought');
  assert.ok(fake.read('users/herUid/drafts/current'));
  await data.signOut();
  assert.equal(fake.read('users/herUid/drafts/current'), undefined);
});

test('data is written under the signed-in person only, in the shape the rules expect', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('his', fake.credentials.his);
  await data.saveMood('2031-04-01', 7, 'ok');
  const id = await data.addEntry('words', new Date(2031, 3, 1, 23, 30));
  const nid = await data.addNote('hello', { source: 'entry' });
  assert.deepEqual(Object.keys(fake.read('users/hisUid/moods/2031-04-01')).sort(), ['note', 'score', 'updatedAt']);
  assert.deepEqual(fake.read(`users/hisUid/entries/${id}`).day, '2031-04-01');
  assert.deepEqual(Object.keys(fake.read(`users/hisUid/entries/${id}`)).sort(), ['createdAt', 'day', 'text', 'updatedAt']);
  const note = fake.read(`notes/${nid}`);
  assert.deepEqual(Object.keys(note).sort(), ['authorDoor', 'authorUid', 'createdAt', 'source', 'text']);
  assert.equal(note.authorUid, 'hisUid');
  assert.equal(note.authorDoor, 'his');
  assert.equal(fake.paths('users/herUid').length, 0);
  assert.ok(Number.isFinite(note.createdAt));
});

test('limits that the rules enforce are checked first with a plain message', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  await assert.rejects(data.addNote('n'.repeat(2001)), /up to 2,000 characters/);
  await assert.rejects(data.saveMood('2031-04-02', 5, 'n'.repeat(501)), /under 500 characters/);
  await assert.rejects(data.addEntry('x'.repeat(200001)), /too long/);
  assert.equal(fake.paths('notes/').length, 0);
});

test('a document with a missing or pending createdAt still gets a finite number', async () => {
  const { fake, data } = make({ now: () => 4242 });
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  fake.world.docs.set('notes/odd', { authorUid: 'hisUid', authorDoor: 'his', text: 'no stamp' });
  fake.world.docs.set('users/herUid/entries/odd', { day: '2031-05-05', text: 'no stamp', createdAt: null });
  let notes;
  const stop = data.listenNotes((n) => { notes = n; });
  await tick();
  stop();
  assert.equal(notes.find((n) => n.id === 'odd').createdAt, 4242);
  assert.equal((await data.listEntries()).find((e) => e.id === 'odd').createdAt, 4242);
});

test('listenNotes: a refused or failed listener reaches onError with a friendly Error', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  for (const [code, re] of [['permission-denied', /do not have access/], ['unavailable', /internet/]]) {
    fake.world.failListenCode = code;
    const errors = [];
    let called = 0;
    data.listenNotes(() => { called++; }, (e) => errors.push(e));
    await tick();
    assert.equal(called, 0);
    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof Error);
    assert.match(errors[0].message, re);
    assert.doesNotMatch(errors[0].message, /permission-denied|unavailable|Firebase/);
    fake.world.failListenCode = null;
  }
  // No error callback given: a failure is silent, not a crash.
  fake.world.failListenCode = 'permission-denied';
  data.listenNotes(() => {});
  await tick();
});

test('a write that waits for the network does not freeze the screen; a refused write still rejects', async () => {
  const { fake, data } = make({ pendingMs: 15 });
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  fake.world.holdWrites = true;
  const id = await data.addEntry('written offline');
  assert.ok(id);
  assert.ok((await data.listEntries()).some((e) => e.id === id), 'it shows at once from the local copy');
  fake.world.holdWrites = false;
  fake.world.failWriteCode = 'permission-denied';
  await assert.rejects(data.addEntry('refused'), /do not have access/);
  await assert.rejects(data.addNote('refused'), /do not have access/);
});

test('saveDraft never rejects for a storage or network problem and keeps the text for this visit', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  fake.world.failWriteCode = 'unavailable';
  await data.saveDraft('still here');
  assert.equal(await data.getDraft(), 'still here');
  fake.world.failWriteCode = null;
  await data.saveDraft('saved for real');
  assert.equal(await data.getDraft(), 'saved for real');
  fake.world.failReadCode = 'unavailable';
  assert.equal(await data.getDraft(), '', 'a failed read gives an empty box, not an error');
});

test('getMembers before sign-in gives the plain labels, and no member list is read', async () => {
  const { fake, data } = make();
  await data.ready();
  const m = await data.getMembers();
  assert.deepEqual(m.names, { hers: 'Hers', his: 'His' });
  await data.signIn('hers', fake.credentials.hers);
  fake.world.docs.set('config/members', { uids: ['herUid', 'hisUid'], doors: { hers: 'herUid', his: 'hisUid' }, names: { hers: 'Rosa', his: 'Sam' } });
  await data.signOut();
  await data.signIn('hers', fake.credentials.hers);
  assert.deepEqual((await data.getMembers()).names, { hers: 'Rosa', his: 'Sam' });
});

test('config/members that is missing or malformed fails closed with a plain message', async () => {
  const { fake, data } = make();
  await data.ready();
  fake.world.docs.delete('config/members');
  await assert.rejects(data.signIn('hers', fake.credentials.hers), /not been set up/);
  assert.equal(fake.world.persistedUid, null);
  fake.world.docs.set('config/members', { uids: 'nope' });
  await assert.rejects(data.signIn('hers', fake.credentials.hers), /not been set up/);
  assert.equal(data.currentSession(), null);
});

test('password reset never says whether the address has an account', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.sendPasswordReset(fake.credentials.hers.email);
  assert.deepEqual(fake.world.resetEmails, [fake.credentials.hers.email]);
  await assert.doesNotReject(data.sendPasswordReset('unknown@example.test'));
  await assert.rejects(data.sendPasswordReset(''), /Enter your email/);
  fake.world.failAuthCode = 'auth/too-many-requests';
  await assert.rejects(data.sendPasswordReset('a@example.test'), /Too many tries/);
});

test('the SDK is loaded from pinned gstatic URLs, and only when asked', async () => {
  assert.deepEqual(Object.values(SDK_URLS), [
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js',
  ]);
  const asked = [];
  const sdk = await loadFirebaseSdk(async (url) => { asked.push(url); return { [`from${asked.length}`]: true }; });
  assert.deepEqual(asked.sort(), Object.values(SDK_URLS).sort());
  assert.equal(Object.keys(sdk).length, 3);
  // Importing the adapter module (or creating an adapter with a fake) contacts nothing.
  const src = readFileSync(new URL('../js/data/firebase.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s[^;]*gstatic/m, 'no static import of the SDK');
  assert.doesNotMatch(src, /firebasejs\/(latest|\d+\/|\d+\.\d+\/)/, 'no unpinned version');
});

test('no innerHTML or eval in the adapter', () => {
  const src = readFileSync(new URL('../js/data/firebase.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('sign-out and rebuild reuse one fixed app name; nothing from the earlier app keeps a session or cache', async () => {
  const { fake, data } = make();
  await data.ready();
  for (const door of ['hers', 'his', 'hers']) {
    await data.signIn(door, fake.credentials[door]);
    await data.addEntry('words');
    assert.deepEqual(await data.signOut(), { wiped: true, unsynced: false });
    assert.deepEqual([...fake.world.apps], ['journal']);
    assert.equal(fake.world.persistedUid, null);
    assert.equal(fake.world.cache.size, 0);
  }
  assert.equal(fake.world.dbs.filter((d) => !d.terminated).length, 1, 'only the newest database is running');
  assert.ok(fake.world.dbs.every((d, i) => i === fake.world.dbs.length - 1 || d.terminated));
  assert.equal(fake.world.dbs[0].settings.localCache.settings.tabManager.kind, 'single-tab');
});

test('if the old app cannot be deleted a unique name is used so the rebuild still works', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  fake.world.failDeleteAppCode = 'app/boom';
  assert.equal((await data.signOut()).wiped, true);
  assert.ok(fake.world.apps.has('journal-1'));
  fake.world.failDeleteAppCode = null;
  const s = await data.signIn('his', fake.credentials.his);
  assert.equal(s.door, 'his');
});

test('signOut says so when the device cache could not be cleared (another tab has it open)', async () => {
  const { fake, data } = make();
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  fake.world.failClearCode = 'failed-precondition';
  const r = await data.signOut();
  assert.deepEqual(r, { wiped: false, unsynced: false });
  assert.equal(data.currentSession(), null, 'the person is still signed out');
});

test('signOut with unsynced writing does nothing unless forced', async () => {
  const { fake, data } = make({ pendingMs: 15 });
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  fake.world.holdWrites = true;
  await data.addEntry('written offline');
  const dbBefore = fake.world.dbs[fake.world.dbs.length - 1];
  const r = await data.signOut();
  assert.deepEqual(r, { wiped: false, unsynced: true });
  assert.deepEqual(data.currentSession(), { uid: 'herUid', door: 'hers' }, 'still signed in');
  assert.equal(dbBefore.terminated, false);
  assert.equal(fake.world.persistedUid, 'herUid');
  assert.ok((await data.listEntries()).length === 1, 'the writing is still there');
  const f = await data.signOut({ force: true });
  assert.deepEqual(f, { wiped: true, unsynced: true });
  assert.equal(data.currentSession(), null);
  assert.equal(dbBefore.terminated, true);
  assert.equal(fake.world.cache.size, 0);
});

test('signOut waits for writes that do finish, and reports nothing unsynced', async () => {
  const { fake, data } = make({ pendingMs: 15 });
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  await data.addEntry('synced');
  assert.deepEqual(await data.signOut(), { wiped: true, unsynced: false });
});

test('onSessionLost: firebase signing this tab out behind its back clears the session and calls back once', async () => {
  let lost = 0;
  const { fake, data } = make({ onSessionLost: () => { lost++; } });
  await data.ready();
  await data.signIn('hers', fake.credentials.hers);
  let notesCalls = 0;
  data.listenNotes(() => { notesCalls++; });
  await tick();
  fake.signOutElsewhere();
  await tick();
  assert.equal(lost, 1);
  assert.equal(data.currentSession(), null);
  await assert.rejects(data.listEntries(), /Not signed in/);
  const seen = notesCalls;
  await tick();
  assert.equal(notesCalls, seen);
  // Our own sign-out and sign-in never count as lost.
  await data.signIn('his', fake.credentials.his);
  await data.signOut();
  assert.equal(lost, 1);
});

test('a sign-in that is overtaken by a sign-out fails with a plain error and sets no session', async () => {
  const fake = createFakeFirebase();
  let release;
  const gate = new Promise((r) => { release = r; });
  const sdk = { ...fake.sdk, signInWithEmailAndPassword: async (...a) => { await gate; return fake.sdk.signInWithEmailAndPassword(...a); } };
  const data = createFirebaseAdapter({ sdk, config: CONFIG });
  await data.ready();
  const attempt = data.signIn('hers', fake.credentials.hers);
  attempt.catch(() => {});
  await tick();
  await data.signOut();
  release();
  await assert.rejects(attempt, (e) => /Something went wrong/.test(e.message));
  assert.equal(data.currentSession(), null);
});

test('more sign-in error codes are plain sentences', () => {
  assert.match(toFriendly({ code: 'auth/invalid-login-credentials' }).message, /email and password did not work/);
  assert.match(toFriendly({ code: 'auth/user-token-expired' }).message, /sign in again/);
});
