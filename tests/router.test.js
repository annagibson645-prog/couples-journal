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
  const calls = { lookback: [], screens: [], gates: [] };
  const lookback = { show: (d) => calls.lookback.push(d), clear() {} };
  router = createRouter({ data, today, lookback, rails: [rail], showScreen: (n) => calls.screens.push(n), showGate: (...a) => calls.gates.push(a) });
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

test('the Save your journal button opens its stand-in', async () => {
  const { navButton, calls } = await setup();
  navButton('save').click();
  assert.equal(calls.gates[0][0], 'Save your journal');
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
