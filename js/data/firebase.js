// Firebase data adapter: implements the data interface (see contract.md) over
// Firebase Auth and Cloud Firestore. Loaded only when MODE is 'firebase' (never in
// sample mode, so the sample site never contacts Google).
//
// The SDK arrives as the `sdk` parameter so tests can pass an in-memory fake. In the
// browser `loadFirebaseSdk()` fetches the three pinned modules from gstatic on demand.
//
// Privacy habits: errors shown to people are plain sentences (never a Firebase code or
// message), and nothing here logs credentials, tokens or document contents.
import { dayKey } from '../lib/days.js';
import { isValidScore } from '../lib/moodlogic.js';

export const SDK_VERSION = '10.14.1';
const BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
export const SDK_URLS = Object.freeze({
  app: `${BASE}/firebase-app.js`,
  auth: `${BASE}/firebase-auth.js`,
  firestore: `${BASE}/firebase-firestore.js`,
});

// Merges the three SDK modules into the one object the adapter uses.
export async function loadFirebaseSdk(importer = (url) => import(url)) {
  const [app, auth, firestore] = await Promise.all([importer(SDK_URLS.app), importer(SDK_URLS.auth), importer(SDK_URLS.firestore)]);
  return { ...app, ...auth, ...firestore };
}

// Limits mirror firestore.rules; keep the two in step.
export const LIMITS = Object.freeze({ entryText: 200000, draftText: 200000, noteText: 2000, moodNote: 500 });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOORS = ['hers', 'his'];
const APP_NAME = 'journal'; // ONE fixed name: deleteApp frees it, so no old login or cache sits under a name nothing clears
const DEFAULT_NAMES = { hers: 'Hers', his: 'His' };

const MSG = {
  notSignedIn: 'Not signed in.',
  signInFailed: 'That email and password did not work. Please try again.',
  needCredentials: 'Enter your email and password.',
  tooMany: 'Too many tries. Please wait a few minutes and try again.',
  offline: 'Could not reach the internet. Check your connection and try again.',
  denied: 'You do not have access to that.',
  notMember: 'This login is not part of this journal.',
  notSetUp: 'This journal has not been set up yet.',
  generic: 'Something went wrong. Please try again.',
  expired: 'Your sign-in has run out. Please sign in again.',
  disabled: 'This login has been turned off.',
  blank: 'Write something first.',
  ownNotes: 'You can only delete your own notes.',
  badMood: 'Mood must be a whole number from 1 to 10.',
  badDay: 'Invalid day.',
};

// An Error whose message is already safe to show.
class FriendlyError extends Error {}
const friendlyError = (message) => new FriendlyError(message);

// Turns anything the SDK throws into a plain sentence. The raw error is never shown.
export function toFriendly(err) {
  if (err instanceof FriendlyError) return err;
  const code = String((err && err.code) || '').replace(/^auth\//, '');
  switch (code) {
    case 'wrong-password':
    case 'user-not-found':
    case 'invalid-credential':
    case 'invalid-login-credentials':
    case 'invalid-email':
    case 'missing-password':
      return friendlyError(MSG.signInFailed);
    case 'too-many-requests': return friendlyError(MSG.tooMany);
    case 'network-request-failed':
    case 'unavailable':
    case 'deadline-exceeded': return friendlyError(MSG.offline);
    case 'permission-denied':
    case 'unauthenticated': return friendlyError(MSG.denied);
    case 'user-disabled': return friendlyError(MSG.disabled);
    case 'user-token-expired': return friendlyError(MSG.expired);
    default: return friendlyError(MSG.generic);
  }
}

// Resolves when the promise settles OR after `ms`. A write waiting for the network keeps
// going in the background (the offline cache holds it), so a slow connection does not
// freeze the screen; a refused write still rejects at once.
function settle(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    promise.then(() => { clearTimeout(timer); resolve(); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// True if the promise finished within `ms`; false if it was still waiting or failed.
function finishedWithin(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(false); });
  });
}

const finiteOr = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function createFirebaseAdapter({ sdk, config, now = () => Date.now(), pendingMs = 8000, authWaitMs = 8000, onSessionLost } = {}) {
  if (!sdk) throw new Error('The Firebase SDK is missing.');
  let generation = 0; // only used to name an app when 'journal' could not be freed
  let epoch = 0; // bumps on every sign-out, so a sign-in that was overtaken can tell
  let stopWatch = null;
  let wiping = false;
  let appName = APP_NAME;
  let app = null;
  let auth = null;
  let db = null;
  let session = null;
  let members = null;
  let readyPromise = null;
  let queue = Promise.resolve(); // serialises sign-outs
  const stops = new Set();
  const memDrafts = new Map(); // drafts that could not be written; kept for this visit only

  // A fresh app + auth + database. Called at start and again after every sign-out.
  function build() {
    app = sdk.initializeApp(config, appName);
    auth = sdk.getAuth(app);
    try {
      // One tab owns the offline cache; any other tab falls back to a memory cache.
      const tabManager = sdk.persistentSingleTabManager ? sdk.persistentSingleTabManager({}) : undefined;
      db = sdk.initializeFirestore(app, { localCache: sdk.persistentLocalCache(tabManager ? { tabManager } : {}) });
    } catch (e) {
      // No offline storage here (for example a private window): carry on online-only.
      db = sdk.initializeFirestore(app, {});
    }
    watchAuth();
  }

  // Lasting listener: if Firebase Auth becomes signed-out (another tab signed out, the account was
  // removed) while this tab still holds a session, drop the session and tell the app.
  function watchAuth() {
    if (stopWatch) { try { stopWatch(); } catch (e) { /* gone */ } stopWatch = null; }
    try {
      stopWatch = sdk.onAuthStateChanged(auth, (user) => {
        if (user || !session || wiping) return;
        session = null;
        members = null;
        memDrafts.clear();
        for (const stop of [...stops]) stop();
        stops.clear();
        if (typeof onSessionLost === 'function') { try { onSessionLost(); } catch (e) { /* the callback must not break auth */ } }
      });
    } catch (e) { stopWatch = null; }
  }

  const requireSession = () => {
    if (!session) throw friendlyError(MSG.notSignedIn);
    return session;
  };
  const doorOf = (m, uid) => {
    if (!m || !m.uids.includes(uid)) return null;
    return DOORS.find((d) => m.doors[d] === uid) || null;
  };

  async function loadMembers() {
    const snap = await sdk.getDoc(sdk.doc(db, 'config', 'members'));
    if (!snap.exists()) throw friendlyError(MSG.notSetUp);
    const d = snap.data();
    const ok = d && Array.isArray(d.uids) && d.doors && typeof d.doors.hers === 'string' && typeof d.doors.his === 'string';
    if (!ok) throw friendlyError(MSG.notSetUp);
    const names = { ...DEFAULT_NAMES };
    for (const k of DOORS) if (d.names && typeof d.names[k] === 'string' && d.names[k]) names[k] = d.names[k];
    members = { uids: d.uids.filter((u) => typeof u === 'string'), doors: { hers: d.doors.hers, his: d.doors.his }, names };
    return members;
  }

  function firstAuthState() {
    return new Promise((resolve) => {
      let done = false;
      let off = null;
      const timer = setTimeout(() => finish(null), authWaitMs);
      function finish(user) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        Promise.resolve().then(() => { if (off) off(); });
        resolve(user);
      }
      try { off = sdk.onAuthStateChanged(auth, (u) => finish(u || null), () => finish(null)); } catch (e) { finish(null); }
    });
  }

  async function quietSignOut() {
    try { await sdk.signOut(auth); } catch (e) { /* nothing more to do */ }
  }

  // Restores a sign-in from an earlier visit. A login that is not a member is signed out again.
  async function restore(user) {
    try {
      const m = await loadMembers();
      const door = doorOf(m, user.uid);
      if (door) session = { uid: user.uid, door };
      else await quietSignOut();
    } catch (e) {
      session = null; // offline or refused: the person can sign in again
    }
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try { build(); } catch (e) { throw toFriendly(e); }
        const user = await firstAuthState();
        if (user) await restore(user);
      })();
    }
    return readyPromise;
  }

  const col = (uid, name) => sdk.collection(db, 'users', uid, name);
  const guard = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { throw toFriendly(e); }
  };

  // Returns { wiped, unsynced }. Without `force`, writing that has not reached the server yet is NOT
  // thrown away: nothing is changed and { wiped: false, unsynced: true } comes back so the app can ask.
  async function doSignOut(force) {
    const oldDb = db;
    const oldApp = app;
    const oldAuth = auth;
    const who = session;
    let unsynced = false;
    if (oldDb && who) {
      unsynced = !(await finishedWithin(sdk.waitForPendingWrites(oldDb), pendingMs));
      if (unsynced && !force) return { wiped: false, unsynced: true };
    }
    epoch += 1;
    wiping = true;
    try {
      session = null;
      members = null;
      memDrafts.clear();
      for (const stop of [...stops]) stop();
      stops.clear();
      if (!oldDb) return { wiped: true, unsynced };
      // Remove this person's unsent draft from their cloud copy while still signed in (best effort).
      if (who) {
        try { await settle(sdk.deleteDoc(sdk.doc(oldDb, 'users', who.uid, 'drafts', 'current')), Math.min(pendingMs, 1500)); } catch (e) { /* best effort */ }
      }
      let wiped = true;
      try { await sdk.signOut(oldAuth); } catch (e) { wiped = false; }
      // Empty the offline cache: terminate first (the SDK refuses to clear a running database).
      try { await sdk.terminate(oldDb); } catch (e) { wiped = false; }
      // Fails while another tab still has the database open.
      try { await sdk.clearIndexedDbPersistence(oldDb); } catch (e) { wiped = false; }
      let freed = true;
      try { await sdk.deleteApp(oldApp); } catch (e) { freed = false; }
      if (stopWatch) { try { stopWatch(); } catch (e) { /* gone */ } stopWatch = null; }
      app = null; auth = null; db = null;
      // Ready for the next person: a brand new app, auth and database under the same name
      // (a different one only if the old app could not be deleted).
      appName = freed ? APP_NAME : `${APP_NAME}-${++generation}`;
      try { build(); } catch (e) { app = null; auth = null; db = null; }
      readyPromise = Promise.resolve();
      return { wiped, unsynced };
    } finally {
      wiping = false;
    }
  }

  return {
    ready,

    signIn: guard(async (door, credentials) => {
      if (!DOORS.includes(door)) throw friendlyError('Sign in as hers or his.');
      const email = credentials && typeof credentials.email === 'string' ? credentials.email.trim() : '';
      const password = credentials && typeof credentials.password === 'string' ? credentials.password : '';
      if (!email || !password) throw friendlyError(MSG.needCredentials);
      await queue; // a sign-out in progress finishes first
      await ready();
      if (!auth) throw friendlyError(MSG.generic);
      const startedAt = epoch;
      const cred = await sdk.signInWithEmailAndPassword(auth, email, password);
      if (epoch !== startedAt) throw friendlyError(MSG.generic);
      const uid = cred && cred.user && cred.user.uid;
      let m;
      try { m = await loadMembers(); } catch (e) {
        if (epoch !== startedAt) throw friendlyError(MSG.generic);
        await quietSignOut();
        if (e && e.code === 'permission-denied') throw friendlyError(MSG.notMember);
        throw e;
      }
      // The door comes from config/members, NOT from the form that was used.
      const actual = doorOf(m, uid);
      if (!actual) {
        await quietSignOut();
        throw friendlyError(MSG.notMember);
      }
      if (epoch !== startedAt) throw friendlyError(MSG.generic); // signed out while signing in
      session = { uid, door: actual };
      return session;
    }),

    // Never rejects. Resolves { wiped, unsynced }; see doSignOut. `{ force: true }` discards unsynced writing.
    signOut(opts) {
      const force = !!(opts && opts.force);
      const failed = { wiped: false, unsynced: false };
      const run = queue.then(() => doSignOut(force)).catch(() => failed);
      queue = run.then(() => {}, () => {});
      return run;
    },

    currentSession() { return session; },

    // Before sign-in the plain labels stand: the list of members is private to members.
    async getMembers() {
      let m = members;
      if (!m && session) {
        try { m = await loadMembers(); } catch (e) { m = null; }
      }
      return m ? { names: { ...m.names }, doors: { ...m.doors } } : { names: { ...DEFAULT_NAMES }, doors: { hers: '', his: '' } };
    },

    // Sends the reset email. Never says whether the address has an account.
    sendPasswordReset: guard(async (email) => {
      const e = typeof email === 'string' ? email.trim() : '';
      if (!e || !e.includes('@')) throw friendlyError('Enter your email address first.');
      await ready();
      try { await sdk.sendPasswordResetEmail(auth, e); } catch (err) {
        const code = String((err && err.code) || '');
        if (code !== 'auth/user-not-found' && code !== 'auth/invalid-email') throw err;
      }
    }),

    saveMood: guard(async (day, score, note) => {
      const s = requireSession();
      if (typeof day !== 'string' || !DAY_RE.test(day)) throw friendlyError(MSG.badDay);
      if (!isValidScore(score)) throw friendlyError(MSG.badMood);
      const text = note ? String(note) : '';
      if (text.length > LIMITS.moodNote) throw friendlyError(`Keep the note under ${LIMITS.moodNote} characters.`);
      const body = text ? { score, note: text, updatedAt: now() } : { score, updatedAt: now() };
      await settle(sdk.setDoc(sdk.doc(db, 'users', s.uid, 'moods', day), body), pendingMs);
    }),

    getMoods: guard(async () => {
      const s = requireSession();
      const snap = await sdk.getDocs(col(s.uid, 'moods'));
      const out = {};
      for (const d of snap.docs) {
        const v = d.data();
        if (v && isValidScore(v.score)) out[d.id] = typeof v.note === 'string' && v.note ? { score: v.score, note: v.note } : { score: v.score };
      }
      return out;
    }),

    addEntry: guard(async (text, at = new Date()) => {
      const s = requireSession();
      if (typeof text !== 'string' || !text.trim()) throw friendlyError(MSG.blank);
      if (text.length > LIMITS.entryText) throw friendlyError('That entry is too long to save.');
      const when = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date(now());
      const ref = sdk.doc(col(s.uid, 'entries'));
      await settle(sdk.setDoc(ref, { day: dayKey(when), text, createdAt: when.getTime(), updatedAt: now() }), pendingMs);
      return ref.id;
    }),

    listEntries: guard(async () => {
      const s = requireSession();
      const snap = await sdk.getDocs(sdk.query(col(s.uid, 'entries'), sdk.orderBy('createdAt', 'desc')));
      const list = [];
      for (const d of snap.docs) {
        const v = d.data();
        if (v && typeof v.text === 'string' && typeof v.day === 'string') list.push({ id: d.id, day: v.day, text: v.text, createdAt: finiteOr(v.createdAt, now()) });
      }
      return list.sort((a, b) => b.createdAt - a.createdAt);
    }),

    deleteEntry: guard(async (id) => {
      const s = requireSession();
      if (typeof id !== 'string' || !id) return;
      await settle(sdk.deleteDoc(sdk.doc(db, 'users', s.uid, 'entries', id)), pendingMs);
    }),

    // The unsent writing box. A storage problem never rejects: the text is kept for this visit.
    async saveDraft(text) {
      const s = requireSession();
      const value = typeof text === 'string' ? text : '';
      const ref = sdk.doc(db, 'users', s.uid, 'drafts', 'current');
      try {
        if (value.length > LIMITS.draftText) throw new Error('too long for the cloud copy');
        if (value) await settle(sdk.setDoc(ref, { text: value, updatedAt: now() }), pendingMs);
        else await settle(sdk.deleteDoc(ref), pendingMs);
        memDrafts.delete(s.uid);
      } catch (e) {
        memDrafts.set(s.uid, value);
      }
    },

    async getDraft() {
      const s = requireSession();
      if (memDrafts.has(s.uid)) return memDrafts.get(s.uid);
      try {
        const snap = await sdk.getDoc(sdk.doc(db, 'users', s.uid, 'drafts', 'current'));
        const v = snap.exists() ? snap.data() : null;
        return v && typeof v.text === 'string' ? v.text : '';
      } catch (e) {
        return '';
      }
    },

    addNote: guard(async (text, opts) => {
      const s = requireSession(); // the author is fixed now, not when the write finishes
      const author = { uid: s.uid, door: s.door };
      if (typeof text !== 'string' || !text.trim()) throw friendlyError(MSG.blank);
      if (text.length > LIMITS.noteText) throw friendlyError('A note can be up to 2,000 characters.');
      const ref = sdk.doc(sdk.collection(db, 'notes'));
      const body = { authorUid: author.uid, authorDoor: author.door, text, createdAt: now() };
      if (opts && opts.source === 'entry') body.source = 'entry';
      await settle(sdk.setDoc(ref, body), pendingMs);
      return ref.id;
    }),

    // Calls back with the notes once they load (a moment after the call), then after every change.
    listenNotes(cb, onError) {
      requireSession();
      let live = true;
      let unsub = null;
      const stop = () => {
        live = false;
        stops.delete(stop);
        if (unsub) { const u = unsub; unsub = null; try { u(); } catch (e) { /* already stopped */ } }
      };
      const fail = (err) => { if (live && typeof onError === 'function') onError(toFriendly(err)); };
      try {
        const q = sdk.query(sdk.collection(db, 'notes'), sdk.orderBy('createdAt', 'desc'));
        unsub = sdk.onSnapshot(q, (snap) => {
          if (!live) return;
          const notes = [];
          for (const d of snap.docs) {
            const v = d.data();
            if (!v || typeof v.text !== 'string' || !DOORS.includes(v.authorDoor)) continue;
            const n = { id: d.id, authorDoor: v.authorDoor, text: v.text, createdAt: finiteOr(v.createdAt, now()) };
            if (v.source === 'entry') n.source = 'entry';
            notes.push(n);
          }
          cb(notes.sort((a, b) => b.createdAt - a.createdAt));
        }, fail);
        stops.add(stop);
      } catch (e) {
        live = false;
        Promise.resolve().then(() => { if (typeof onError === 'function') onError(toFriendly(e)); });
      }
      return stop;
    },

    deleteNote: guard(async (id) => {
      const s = requireSession();
      if (typeof id !== 'string' || !id) return;
      const ref = sdk.doc(db, 'notes', id);
      const snap = await sdk.getDoc(ref);
      if (!snap.exists()) return;
      // The rules enforce this too; checking first gives a plain message.
      if (snap.data().authorUid !== s.uid) throw friendlyError(MSG.ownNotes);
      await settle(sdk.deleteDoc(ref), pendingMs);
    }),
  };
}
