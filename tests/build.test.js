import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoot, buildCss, buildIndex, sigilD } from '../scripts/build.mjs';
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

test('js/boot.js is up to date, flat, lists every module once with app.js then started.js last', () => {
  assert.equal(read('js/boot.js'), buildBoot());
  const imports = [...read('js/boot.js').matchAll(/^import '(\.\/[^']+)';$/gm)].map((m) => `js/${m[1].slice(2)}`);
  const { files } = importGraph('js/app.js');
  assert.deepEqual(imports.slice(-2), ['js/app.js', 'js/started.js']);
  assert.deepEqual([...imports].filter((f) => f !== 'js/started.js').sort(), files, 'exactly the modules the app imports, each once');
  assert.equal(new Set(imports).size, imports.length);
  assert.ok(!imports.includes('js/boot.js'));
});

test('from js/boot.js every module is at most 2 levels deep for the browser (old iOS has no modulepreload)', () => {
  const g = importGraph('js/boot.js');
  assert.ok(g.depth <= 2, `depth ${g.depth}`);
  assert.equal(g.files.length, importGraph('js/app.js').files.length + 2);
});

test('index.html loads js/boot.js as the only module script, after the guard', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['js/boot.js']);
});

test('js/boot.js imports js/started.js right after ./app.js, and started.js only sets the flag', () => {
  const lines = read('js/boot.js').split('\n').filter((l) => l.startsWith('import '));
  const at = lines.indexOf("import './app.js';");
  assert.ok(at >= 0);
  assert.equal(lines[at + 1], "import './started.js';");
  assert.equal(lines.at(-1), "import './started.js';");
  const src = read('js/started.js');
  assert.match(src, /globalThis\.__journalStarted = true;/);
  assert.doesNotMatch(src, /^\s*import /m);
  assert.match(read('js/app.js'), /globalThis\.__journalStarted = true;/, 'app.js keeps setting it too');
});
