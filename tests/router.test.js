import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoAdapter } from '../js/data/demo.js';
import { createToday } from '../js/screens/today.js';
import { createRail } from '../js/screens/rail.js';
import { createRouter } from '../js/router.js';
import { makeDom } from './helpers/fake-dom.js';

class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The real Today screen, the real shared rail and the real router, on the demo adapter.
async function setup(wrap = (d) => d) {
  const storage = new MemoryStorage();
  const data = wrap(createDemoAdapter(storage));
  await data.signIn('hers');
  const doc = makeDom();
  const host = doc.createElement('aside');
  let router;
  const rail = createRail({ host, current: 'today', onNavigate: (k) => router.navigate(k), document: doc });
  const today = createToday({ data, document: doc, showScreen() {}, rail, debounceMs: 60000 });
  const calls = { lookback: [], screens: [], gates: [], save: [], saveCleared: 0 };
  const lookback = { show: (d) => calls.lookback.push(d), clear() {} };
  const save = { show: (d) => calls.save.push(d), clear: () => { calls.saveCleared += 1; } };
  router = createRouter({ data, today, lookback, save, rails: [rail], showScreen: (n) => calls.screens.push(n), showGate: (...a) => calls.gates.push(a) });
  const navButton = (key) => host.find((c) => c.tag === 'button' && c.dataset.nav === key)[0];
  return { storage, data, doc, today, calls, navButton, $: (id) => doc.byId[id] };
}

test('clicking a rail button while a draft is pending saves the draft through the adapter', async () => {
  const { data, today, $, navButton, calls } = await setup();
  await today.show('hers');
  $('td-text').value = 'a thought I was not done with';
  $('td-text').dispatch('input'); // pending, 60 s debounce
  navButton('lookback').click();
  await tick();
  assert.equal(await data.getDraft(), 'a thought I was not done with');
  assert.deepEqual(calls.lookback, ['hers']);
});

test('the Save your journal button opens the Save screen for the signed-in door', async () => {
  const { navButton, calls } = await setup();
  navButton('save').click();
  assert.deepEqual(calls.save, ['hers']);
  assert.equal(calls.gates.length, 0);
});

test('signing out clears the Save screen too', async () => {
  const { navButton, calls } = await setup();
  navButton('signout').click();
  await tick();
  assert.equal(calls.saveCleared, 1);
});

test('sign-out waits for the draft write before wiping, and no draft remains afterwards', async () => {
  const order = [];
  const { storage, today, $, navButton, calls } = await setup((d) => ({
    ...d,
    currentSession: () => d.currentSession(),
    saveDraft: async (t) => { await wait(20); order.push('draft'); return d.saveDraft(t); },
    signOut: async () => { order.push('signOut'); return d.signOut(); },
  }));
  await today.show('hers');
  $('td-text').value = 'unsent words';
  $('td-text').dispatch('input');
  navButton('signout').click();
  await wait(80);
  assert.deepEqual(order, ['draft', 'signOut']);
  assert.deepEqual([...storage.m.keys()].filter((k) => k.includes('draft:')), []);
  assert.deepEqual(calls.screens.at(-1), 'front');
  assert.equal($('td-text').value, '');
});

test('Back to the three doors leaves Notes (unsubscribes) and shows the front page, still signed in', async () => {
  const { data, calls } = await setup();
  const left = [];
  const router = createRouter({ data, today: { show() {}, leave() {}, clear() {} }, lookback: { show() {}, clear() {} }, save: { show() {}, clear() {} },
    notes: { show() {}, leave: () => left.push('left'), clear() {} }, showScreen: (n) => calls.screens.push(n), showGate() {} });
  await router.navigate('front');
  assert.deepEqual(left, ['left']);
  assert.equal(calls.screens.at(-1), 'front');
  assert.ok(data.currentSession(), 'still signed in');
});

test('signing out clears the Notes screen (drops its listener) before the session ends', async () => {
  const { data, calls } = await setup();
  const order = [];
  const router = createRouter({ data: { ...data, signOut: async () => { order.push('signOut'); return data.signOut(); } },
    today: { show() {}, leave() {}, clear() {} }, lookback: { show() {}, clear() {} }, save: { show() {}, clear() {} },
    notes: { show() {}, leave() {}, clear: () => order.push('notes') }, showScreen: (n) => calls.screens.push(n), showGate() {} });
  await router.signOut();
  assert.deepEqual(order, ['notes', 'signOut']);
});

test('sample mode: the rail Sign out key just returns to the front page and wipes nothing', async () => {
  const { data, calls } = await setup();
  await data.saveMood('2026-11-05', 6);
  await data.addEntry('kept entry');
  const left = [];
  const cleared = [];
  const router = createRouter({ data, demo: true, today: { show() {}, leave: () => left.push('today'), clear: () => cleared.push('today') },
    lookback: { show() {}, clear: () => cleared.push('lookback') }, save: { show() {}, clear: () => cleared.push('save') },
    notes: { show() {}, leave: () => left.push('notes'), clear: () => cleared.push('notes') }, showScreen: (n) => calls.screens.push(n), showGate() {} });
  await router.navigate('signout');
  assert.deepEqual(left, ['today', 'notes']);
  assert.deepEqual(cleared, []);
  assert.equal(calls.screens.at(-1), 'front');
  assert.ok(data.currentSession(), 'still signed in');
  assert.equal((await data.listEntries()).length > 0, true);
  assert.equal((await data.getMoods())['2026-11-05'].score, 6);
});

test('sample mode: a pending Today draft is flushed on the way back to the doors', async () => {
  const { data, today, $ } = await setup();
  const router = createRouter({ data, demo: true, today, lookback: { show() {}, clear() {} }, save: { show() {}, clear() {} }, showScreen() {}, showGate() {} });
  await today.show('hers');
  $('td-text').value = 'unfinished';
  $('td-text').dispatch('input');
  await router.navigate('signout');
  assert.equal(await data.getDraft(), 'unfinished');
});

test('sample mode: router.signOut is still the wipe (used by Reset sample data)', async () => {
  const { data, storage, calls } = await setup();
  const router = createRouter({ data, demo: true, today: { show() {}, leave() {}, clear() {} }, lookback: { show() {}, clear() {} }, save: { show() {}, clear() {} }, showScreen: (n) => calls.screens.push(n), showGate() {} });
  await router.signOut();
  assert.equal(data.currentSession(), null);
  assert.equal(storage.length, 0);
  assert.equal(calls.screens.at(-1), 'front');
});
