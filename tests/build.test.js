import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCss, buildIndex, sigilD } from '../scripts/build.mjs';
import { importGraph } from '../scripts/import-graph.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('css/app.css is up to date with its source stylesheets (run: node scripts/build.mjs)', () => {
  assert.equal(read('css/app.css'), buildCss());
});

test('index.html links only css/app.css, not the nine separate sheets', () => {
  const html = read('index.html');
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sheets, ['css/app.css']);
});

test('index.html is up to date: sigil paths drawn and modulepreload list built (run: node scripts/build.mjs)', () => {
  const html = read('index.html');
  assert.equal(buildIndex(html), html);
});

test('every sigil path in index.html carries its precomputed d, so the first paint needs no JS', () => {
  const html = read('index.html');
  const paths = [...html.matchAll(/<path data-sigil="([a-z-]+)" data-n="(\d+)"( d="([^"]+)")?/g)];
  assert.ok(paths.length >= 6);
  for (const [, kind, n, , d] of paths) assert.equal(d, sigilD(kind, Number(n)), `${kind} ${n}`);
});

test('modulepreload hints equal the real import graph (no drift, none missing, none extra)', () => {
  const html = read('index.html');
  const hinted = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]).sort();
  const { files, depth } = importGraph();
  assert.deepEqual(hinted, files);
  assert.ok(files.includes('js/app.js'));
  assert.ok(hinted.every((h) => !h.startsWith('/') && !h.includes('://')), 'paths stay relative');
  assert.ok(depth >= 2);
});

test('web fonts: display=swap, non-blocking load with a noscript fallback, preconnect kept', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/);
  assert.match(html, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
  const pre = html.match(/<link rel="preload" as="style" href="(https:\/\/fonts\.googleapis\.com[^"]+)" onload="[^"]*rel='stylesheet'"/);
  assert.ok(pre, 'preload with onload swap');
  assert.match(pre[1], /display=swap/);
  assert.match(html, /<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]+display=swap"><\/noscript>/);
  assert.doesNotMatch(html, /<link href="https:\/\/fonts\.googleapis\.com[^>]*rel="stylesheet"/);
});

test('system fallbacks follow every web font name', () => {
  const css = read('css/app.css');
  for (const m of css.matchAll(/'(Fraunces|Newsreader|JetBrains Mono)'\s*,\s*([^;}]+)/g)) {
    const generic = m[1] === 'JetBrains Mono' ? /monospace/ : /serif/;
    assert.match(m[2], generic, m[0]);
    assert.match(m[2], m[1] === 'JetBrains Mono' ? /Menlo|Consolas|ui-monospace/ : /Georgia/, m[0]);
  }
});

test('head sets background and text colour for both themes before any stylesheet loads', () => {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('<link rel="stylesheet" href="css/app.css"'));
  assert.match(head, /html\{background:#0e0d14;color:#eae6f5/);
  assert.match(head, /html\[data-theme="light"\]\{background:#f0ead8;color:#2c1f0e/);
  assert.ok(head.indexOf("localStorage.getItem('journal-theme')") < head.indexOf('html{background'), 'theme is applied before the style');
});
