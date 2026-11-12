// A small in-memory FAKE of exactly the Firebase SDK calls js/data/firebase.js uses
// (modular v10 shape), so the adapter can be tested offline with no packages.
//
//   const fake = createFakeFirebase();          // three accounts: hers, his, a stranger
//   const sdk = fake.sdk;                       // pass as createFirebaseAdapter({ sdk })
//   fake.credentials.hers                       // { email, password } for the Hers login
//   fake.world                                  // the "server" plus switches to make things fail
//
// What it imitates: auth state restored on a new app, sign-in errors with Firebase-style
// codes, documents and collections, query ordering, snapshot listeners that answer after a
// tick, a terminated database that refuses work, clearIndexedDbPersistence that only works
// on a terminated database, writes that never resolve while "offline", and the real SDK's
// refusal of undefined field values. It does NOT imitate security rules (tests/rules does).

const clone = (v) => structuredClone(v);

function codeError(code, text) {
  const e = new Error(`Firebase: ${text || 'Error'} (${code}).`);
  e.code = code;
  return e;
}

function hasUndefined(v) {
  if (v === undefined) return true;
  if (v && typeof v === 'object') return Object.values(v).some(hasUndefined);
  return false;
}

export function createFakeFirebase(opts = {}) {
  const accounts = opts.accounts || {
    hers: { email: 'her@example.test', password: 'her-test-password', uid: 'herUid' },
    his: { email: 'his@example.test', password: 'his-test-password', uid: 'hisUid' },
    stranger: { email: 'stranger@example.test', password: 'stranger-test-password', uid: 'strangerUid' },
  };
  const world = {
    docs: new Map(),            // path -> data (the "server")
    persistedUid: null,         // who is signed in on this device (survives a new app instance)
    cache: new Set(),           // paths held in the device cache
    calls: [],                  // names of the calls that matter, in order
    apps: new Set(),            // names of live apps
    dbs: [],                    // every database created
    listeners: new Set(),       // live snapshot listeners
    authListeners: new Set(),
    failAuthCode: null,         // next sign-in fails with this code
    failReadCode: null,         // reads fail with this code while set
    failListenCode: null,       // snapshot listeners get this error while set
    failWriteCode: null,        // writes fail with this code while set
    holdWrites: false,          // writes apply locally but never resolve (offline)
    resetEmails: [],
    nextAuto: 1,
  };
  world.docs.set('config/members', clone(opts.members || {
    uids: [accounts.hers.uid, accounts.his.uid],
    doors: { hers: accounts.hers.uid, his: accounts.his.uid },
    names: { hers: 'Hers', his: 'His' },
  }));

  const byUid = (uid) => Object.values(accounts).find((a) => a.uid === uid);
  const userOf = (uid) => (uid ? { uid, email: byUid(uid)?.email } : null);
  const fireAuth = () => { for (const l of [...world.authListeners]) l.fire(); };

  // ---- refs -----------------------------------------------------------
  const pathOf = (parent, segs) => {
    const base = parent && parent.kind === 'db' ? [] : [parent.path];
    return [...base, ...segs].join('/');
  };
  const collectionRef = (db, path) => ({ kind: 'collection', db, path, id: path.split('/').pop() });
  const docRef = (db, path) => ({ kind: 'doc', db, path, id: path.split('/').pop() });
  const dbOf = (parent) => (parent.kind === 'db' ? parent : parent.db);
  const parentPath = (p) => p.split('/').slice(0, -1).join('/');
  const childOf = (collPath) => (p) => p.startsWith(`${collPath}/`) && !p.slice(collPath.length + 1).includes('/');

  const assertLive = (db) => {
    if (db.terminated) throw codeError('failed-precondition', 'The client has already been terminated');
  };
  const snapOf = (path) => {
    const has = world.docs.has(path);
    return { id: path.split('/').pop(), exists: () => has, data: () => (has ? clone(world.docs.get(path)) : undefined) };
  };
  const queryDocs = (q) => {
    const coll = q.kind === 'query' ? q.coll : q;
    const order = q.kind === 'query' ? q.constraints.find((c) => c.type === 'orderBy') : null;
    let paths = [...world.docs.keys()].filter(childOf(coll.path));
    paths = paths.map((p) => ({ p, d: world.docs.get(p) }));
    if (order) {
      const dir = order.dir === 'desc' ? -1 : 1;
      paths.sort((a, b) => (a.d[order.field] < b.d[order.field] ? -dir : a.d[order.field] > b.d[order.field] ? dir : 0));
    }
    return paths.map(({ p }) => snapOf(p));
  };
  const touch = (db, path) => { world.cache.add(path); };
  const notify = () => { for (const l of [...world.listeners]) l.emit(); };

  const checkSize = (data) => {
    if (new TextEncoder().encode(JSON.stringify(data)).length > 1048576) throw codeError('invalid-argument', 'Document is too large');
  };

  // ---- the sdk object -------------------------------------------------
  const sdk = {
    initializeApp(config, name) {
      world.calls.push(`initializeApp:${name}`);
      if (world.apps.has(name)) throw codeError('app/duplicate-app', 'Duplicate app');
      world.apps.add(name);
      return { name, config };
    },
    async deleteApp(app) { world.calls.push('deleteApp'); world.apps.delete(app.name); },

    getAuth(app) {
      return { app, currentUser: userOf(world.persistedUid) };
    },
    onAuthStateChanged(auth, cb) {
      const l = { fire: () => { auth.currentUser = userOf(world.persistedUid); cb(auth.currentUser); } };
      world.authListeners.add(l);
      queueMicrotask(() => { if (world.authListeners.has(l)) l.fire(); });
      return () => world.authListeners.delete(l);
    },
    async signInWithEmailAndPassword(auth, email, password) {
      if (world.failAuthCode) throw codeError(world.failAuthCode);
      const a = Object.values(accounts).find((x) => x.email === email);
      if (!a || a.password !== password) throw codeError('auth/invalid-credential');
      world.persistedUid = a.uid;
      auth.currentUser = userOf(a.uid);
      fireAuth();
      return { user: auth.currentUser };
    },
    async signOut(auth) {
      world.calls.push('signOut');
      world.persistedUid = null;
      auth.currentUser = null;
      fireAuth();
    },
    async sendPasswordResetEmail(auth, email) {
      if (world.failAuthCode) throw codeError(world.failAuthCode);
      world.resetEmails.push(email);
    },

    persistentLocalCache(settings) { return { kind: 'persistent', settings }; },
    persistentMultipleTabManager() { return { kind: 'multi-tab' }; },
    initializeFirestore(app, settings) {
      world.calls.push('initializeFirestore');
      const db = { kind: 'db', app, settings, terminated: false };
      world.dbs.push(db);
      return db;
    },
    async terminate(db) { world.calls.push('terminate'); db.terminated = true; for (const l of [...world.listeners]) if (l.db === db) world.listeners.delete(l); },
    async clearIndexedDbPersistence(db) {
      world.calls.push('clearIndexedDbPersistence');
      if (!db.terminated) throw codeError('failed-precondition', 'Persistence can only be cleared after terminate');
      world.cache.clear();
    },

    collection(parent, ...segs) { return collectionRef(dbOf(parent), pathOf(parent, segs)); },
    doc(parent, ...segs) {
      if (parent.kind === 'collection' && segs.length === 0) return docRef(dbOf(parent), `${parent.path}/auto${world.nextAuto++}`);
      return docRef(dbOf(parent), pathOf(parent, segs));
    },
    orderBy(field, dir = 'asc') { return { type: 'orderBy', field, dir }; },
    query(coll, ...constraints) { return { kind: 'query', db: coll.db, coll, constraints }; },

    async getDoc(ref) {
      const db = ref.db;
      assertLive(db);
      if (world.failReadCode) throw codeError(world.failReadCode);
      touch(db, ref.path);
      return snapOf(ref.path);
    },
    async getDocs(q) {
      const db = q.db;
      assertLive(db);
      if (world.failReadCode) throw codeError(world.failReadCode);
      const docs = queryDocs(q);
      for (const d of docs) touch(db, `${(q.coll || q).path}/${d.id}`);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    async setDoc(ref, data) {
      const db = ref.db;
      assertLive(db);
      if (hasUndefined(data)) throw new Error('Function setDoc() called with invalid data. Unsupported field value: undefined');
      checkSize(data);
      if (world.failWriteCode) throw codeError(world.failWriteCode);
      world.docs.set(ref.path, clone(data));
      touch(db, ref.path);
      notify();
      if (world.holdWrites) return new Promise(() => {});
    },
    async deleteDoc(ref) {
      const db = ref.db;
      assertLive(db);
      if (world.failWriteCode) throw codeError(world.failWriteCode);
      world.docs.delete(ref.path);
      notify();
      if (world.holdWrites) return new Promise(() => {});
    },
    onSnapshot(q, next, error) {
      const db = q.db;
      assertLive(db);
      const l = {
        db,
        emit: () => {
          queueMicrotask(() => {
            if (!world.listeners.has(l)) return;
            if (world.failListenCode) { world.listeners.delete(l); if (error) error(codeError(world.failListenCode)); return; }
            const docs = queryDocs(q);
            for (const d of docs) touch(db, `${(q.coll || q).path}/${d.id}`);
            next({ docs, empty: docs.length === 0, size: docs.length });
          });
        },
      };
      world.listeners.add(l);
      l.emit();
      return () => world.listeners.delete(l);
    },
  };

  return {
    sdk,
    world,
    accounts,
    credentials: {
      hers: { email: accounts.hers.email, password: accounts.hers.password },
      his: { email: accounts.his.email, password: accounts.his.password },
      stranger: { email: accounts.stranger.email, password: accounts.stranger.password },
    },
    // A path -> data peek at the "server" for assertions.
    read: (path) => (world.docs.has(path) ? clone(world.docs.get(path)) : undefined),
    paths: (prefix) => [...world.docs.keys()].filter((p) => p.startsWith(prefix)),
    parentPath,
  };
}
