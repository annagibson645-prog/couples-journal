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
  assert.match(html, /Sample mode — entries stay on this device only and aren't private or backed up</);
});

test('banner and theme switch sit before the front screen, outside it', () => {
  const b = html.indexOf('id="sample-banner"'), t = html.indexOf('id="theme-toggle"'), m = html.indexOf('id="screen-front"');
  assert.ok(b > 0 && t > 0 && b < m && t < m);
});

test('door links are labelled by their name heading', () => {
  assert.equal((html.match(/aria-labelledby="name-(hers|notes|his)"/g) || []).length, 3);
  assert.match(html, /family=Newsreader:ital,wght@0,400;1,400/);
});

test('today screen has the moon group, writing box, save button and an alert area', () => {
  for (const id of ['screen-today', 'td-moons', 'td-note', 'td-text', 'td-save', 'td-list', 'td-nav']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="td-error"[^>]*role="alert"/);
  assert.match(html, />Nothing here yet\. Write whenever you're ready\.</);
  assert.match(html, /href="css\/journal\.css"/);
});
