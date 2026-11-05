import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('three door links in order hers, notes, his', () => {
  const doors = [...html.matchAll(/<a\b[^>]*data-door="(hers|notes|his)"/g)].map((m) => m[1]);
  assert.deepEqual(doors, ['hers', 'notes', 'his']);
});

test('has viewport meta tag', () => {
  assert.match(html, /<meta[^>]+name="viewport"[^>]+width=device-width/);
});

test('has theme switch button', () => {
  assert.match(html, /<button[^>]+id="theme-toggle"/);
});

test('has sample-mode banner element', () => {
  assert.match(html, /id="sample-banner"/);
  assert.match(html, /Sample mode: entries stay on this device only and aren't private or backed up\./);
});
