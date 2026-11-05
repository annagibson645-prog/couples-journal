import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { cloneData } from '../js/lib/clone.js';
import { createDemoAdapter } from '../js/data/demo.js';

test('cloneData returns a deep, independent copy of plain JSON data', () => {
  const src = { a: [1, { b: 'x' }], n: null, t: true };
  const copy = cloneData(src);
  assert.deepEqual(copy, src);
  copy.a[1].b = 'changed';
  copy.a.push(3);
  assert.equal(src.a[1].b, 'x');
  assert.equal(src.a.length, 2);
});

test('cloneData handles primitives, arrays and undefined', () => {
  assert.equal(cloneData(5), 5);
  assert.equal(cloneData('s'), 's');
  assert.equal(cloneData(null), null);
  assert.equal(cloneData(undefined), undefined);
  assert.deepEqual(cloneData([]), []);
});

test('the demo adapter still works when structuredClone does not exist (older iPhones)', async () => {
  const saved = globalThis.structuredClone;
  delete globalThis.structuredClone;
  try {
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    const d = createDemoAdapter(storage);
    await d.getMembers();
    await d.signIn('hers');
    assert.ok(Array.isArray(await d.listEntries()));
    assert.equal(typeof (await d.getMoods()), 'object');
  } finally {
    if (saved) globalThis.structuredClone = saved;
  }
});

test('no file under js/ calls structuredClone', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const root = new URL('../js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  for (const f of walk(root).filter((p) => p.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /structuredClone\s*\(/, f);
  }
});
