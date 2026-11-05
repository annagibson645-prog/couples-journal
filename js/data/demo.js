// Demo adapter: implements the data interface (see contract.md) over
// localStorage. Not secure and not private: sample mode only.
import { dayKey } from '../lib/days.js';
import { isValidScore } from '../lib/moodlogic.js';
import { buildSeed } from './sample-seed.js';

const PREFIX = 'journal-demo:';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBERS = { names: { hers: 'Hers', his: 'His' }, doors: { hers: 'demo-hers', his: 'demo-his' } };

const SAVE_FAILED = 'Could not save on this device (storage may be full or blocked).';

// Minimal in-memory stand-in with the localStorage methods this adapter uses.
class MemoryStore {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// Real localStorage if it works; otherwise memory for this visit. Never throws.
function resolveStorage(given) {
  if (given) return given;
  try {
    const s = globalThis.localStorage;
    s.getItem(PREFIX + 'probe');
    return s;
  } catch (e) {
    return new MemoryStore();
  }
}

export function createDemoAdapter(given) {
  let storage = resolveStorage(given);
  let session = null;
  // In-memory copy of the signed-in person's journal data; cleared on signOut.
  let cache = null; // { moods, entries }
  const noteListeners = new Set();
  // Drafts that could not be written to storage live here for this visit.
  const memDrafts = {};

  const read = (key) => {
    try { return JSON.parse(storage.getItem(PREFIX + key)); } catch (e) { return null; }
  };
  // A failed write (quota, blocked) becomes a friendly error; callers commit
  // to the in-memory cache only after write() succeeds.
  const write = (key, value) => {
    try { storage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { throw new Error(SAVE_FAILED); }
  };

  function seedIfNeeded() {
    if (read('seeded')) return;
    const seed = buildSeed(new Date());
    try {
      write('hers', seed.hers);
      write('his', seed.his);
      write('notes', seed.notes);
      write('seeded', true);
    } catch (e) {
      // Can't persist here: keep the sample data in memory for this visit.
      storage = new MemoryStore();
      write('hers', seed.hers);
      write('his', seed.his);
      write('notes', seed.notes);
      write('seeded', true);
    }
  }

  function requireSession() {
    if (!session) throw new Error('Not signed in.');
    return session;
  }
  const mine = () => {
    const s = requireSession();
    if (!cache) cache = read(s.door) || { moods: {}, entries: [] };
    return cache;
  };
  // Write the next state first; only then does it become the cache.
  const commit = (next) => { write(requireSession().door, next); cache = next; };
  const readNotes = () => (read('notes') || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const newId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const emitNotes = () => { for (const cb of noteListeners) cb(readNotes()); };

  return {
    async signIn(door) {
      // Notes has no login of its own: callers pick hers or his.
      if (door !== 'hers' && door !== 'his') throw new Error('Sign in as hers or his.');
      seedIfNeeded();
      session = { uid: MEMBERS.doors[door], door };
      cache = null;
      return session;
    },

    // Demo choice: sign-out also resets the sample data (every journal-demo: key),
    // so nothing typed in sample mode lingers on the device.
    async signOut() {
      session = null;
      cache = null;
      noteListeners.clear();
      for (const k of Object.keys(memDrafts)) delete memDrafts[k];
      // Best effort: a blocked or failing store must not stop sign-out finishing.
      try {
        const doomed = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(PREFIX)) doomed.push(k);
        }
        for (const k of doomed) {
          try { storage.removeItem(k); } catch (e) {
            // A draft must not stay readable: overwrite its text, best effort.
            if (k.startsWith(PREFIX + 'draft:')) { try { storage.setItem(k, JSON.stringify('')); } catch (e2) { /* nothing more to do */ } }
          }
        }
      } catch (e) { /* storage unreadable: nothing more to clear */ }
    },

    currentSession() { return session; },

    async getMembers() { return structuredClone(MEMBERS); },

    async saveMood(day, score, note) {
      if (typeof day !== 'string' || !DAY_RE.test(day)) throw new Error('Invalid day.');
      if (!isValidScore(score)) throw new Error('Mood must be a whole number from 1 to 10.');
      const m = mine();
      commit({ ...m, moods: { ...m.moods, [day]: note ? { score, note: String(note) } : { score } } });
    },

    async getMoods() { return structuredClone(mine().moods); },

    async addEntry(text, now = new Date()) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('Write something first.');
      const m = mine();
      const id = newId('e');
      commit({ ...m, entries: [...m.entries, { id, day: dayKey(now), text, createdAt: now.getTime() }] });
      return id;
    },

    async listEntries() {
      return structuredClone(mine().entries).sort((a, b) => b.createdAt - a.createdAt);
    },

    // The unsent writing box, one per person. Never throws on a storage
    // problem: the draft is kept in memory for this visit instead.
    async saveDraft(text) {
      const s = requireSession();
      const key = 'draft:' + s.door;
      const value = typeof text === 'string' ? text : '';
      try {
        if (value) storage.setItem(PREFIX + key, JSON.stringify(value));
        else storage.removeItem(PREFIX + key);
        delete memDrafts[s.door];
      } catch (e) {
        if (!value) {
          // Removal failed: blank the stored text instead, so the old draft can
          // never come back. If even that fails, remember "no draft" in memory.
          try { storage.setItem(PREFIX + key, JSON.stringify('')); delete memDrafts[s.door]; } catch (e2) { memDrafts[s.door] = ''; }
        } else memDrafts[s.door] = value;
      }
    },

    async getDraft() {
      const s = requireSession();
      if (typeof memDrafts[s.door] === 'string') return memDrafts[s.door];
      const v = read('draft:' + s.door);
      return typeof v === 'string' ? v : '';
    },

    async deleteEntry(id) {
      const m = mine();
      commit({ ...m, entries: m.entries.filter((e) => e.id !== id) });
    },

    async addNote(text) {
      const s = requireSession();
      if (typeof text !== 'string' || !text.trim()) throw new Error('Write something first.');
      const id = newId('n');
      write('notes', [...(read('notes') || []), { id, authorDoor: s.door, text, createdAt: Date.now() }]);
      emitNotes();
      return id;
    },

    listenNotes(cb) {
      requireSession();
      noteListeners.add(cb);
      cb(readNotes());
      return () => { noteListeners.delete(cb); };
    },

    async deleteNote(id) {
      requireSession();
      write('notes', (read('notes') || []).filter((n) => n.id !== id));
      emitNotes();
    },
  };
}
