// Demo adapter: implements the data interface (see contract.md) over
// localStorage. Not secure and not private: sample mode only.
import { dayKey } from '../lib/days.js';
import { isValidScore } from '../lib/moodlogic.js';
import { buildSeed } from './sample-seed.js';

const PREFIX = 'journal-demo:';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBERS = { names: { hers: 'Hers', his: 'His' }, doors: { hers: 'demo-hers', his: 'demo-his' } };

export function createDemoAdapter(storage = globalThis.localStorage) {
  let session = null;
  // In-memory copy of the signed-in person's journal data; cleared on signOut.
  let cache = null; // { moods, entries }
  const noteListeners = new Set();

  const read = (key) => {
    try { return JSON.parse(storage.getItem(PREFIX + key)); } catch (e) { return null; }
  };
  const write = (key, value) => storage.setItem(PREFIX + key, JSON.stringify(value));

  function seedIfNeeded() {
    if (read('seeded')) return;
    const seed = buildSeed(new Date());
    write('hers', seed.hers);
    write('his', seed.his);
    write('notes', seed.notes);
    write('seeded', true);
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
  const saveMine = () => write(requireSession().door, cache);
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
      const doomed = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(PREFIX)) doomed.push(k);
      }
      doomed.forEach((k) => storage.removeItem(k));
      noteListeners.clear();
    },

    currentSession() { return session; },

    async getMembers() { return structuredClone(MEMBERS); },

    async saveMood(day, score, note) {
      if (typeof day !== 'string' || !DAY_RE.test(day)) throw new Error('Invalid day.');
      if (!isValidScore(score)) throw new Error('Mood must be a whole number from 1 to 10.');
      const m = mine();
      m.moods[day] = note ? { score, note: String(note) } : { score };
      saveMine();
    },

    async getMoods() { return structuredClone(mine().moods); },

    async addEntry(text, now = new Date()) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('Write something first.');
      const m = mine();
      const id = newId('e');
      m.entries.push({ id, day: dayKey(now), text, createdAt: now.getTime() });
      saveMine();
      return id;
    },

    async listEntries() {
      return structuredClone(mine().entries).sort((a, b) => b.createdAt - a.createdAt);
    },

    async deleteEntry(id) {
      const m = mine();
      m.entries = m.entries.filter((e) => e.id !== id);
      saveMine();
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
