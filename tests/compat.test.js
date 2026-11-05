// Guards for older phones (iOS 14 / Safari 14 / Android WebView 90). See the mobile-fix report for the audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createBanner } from '../js/screens/banner.js';
import { makeBannerDom } from './helpers/fake-dom.js';

const url = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(url(p), 'utf8').replace(/\r\n/g, '\n');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const walk = (dir) => readdirSync(url(dir)).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(url(p)).isDirectory() ? walk(p) : [p];
});
const jsFiles = walk('js').filter((p) => p.endsWith('.js'));
const cssSources = readdirSync(url('css')).filter((f) => f.endsWith('.css') && f !== 'app.css').map((f) => `css/${f}`);

// Syntax and APIs newer than iOS 14 / Safari 14.
const BAD_JS = [
  [/\.at\(\s*-?\d/, 'Array/String .at()'],
  [/Object\.hasOwn\(/, 'Object.hasOwn'],
  [/\.findLast(Index)?\(/, 'findLast'],
  [/\.replaceAll\(/, 'replaceAll'],
  [/\?\?=|\|\|=|&&=/, 'logical assignment'],
  [/static\s*\{/, 'class static block'],
  [/randomUUID/, 'crypto.randomUUID'],
  [/\(\?<[=!]/, 'regex lookbehind'],
  [/structuredClone/, 'structuredClone'],
  [/^await\s/m, 'top-level await'],
  [/Intl\.(Segmenter|ListFormat|DurationFormat|DisplayNames)/, 'new Intl features'],
  [/\.toSorted\(|\.toReversed\(/, 'change-by-copy array methods'],
  [/Object\.groupBy|Array\.fromAsync/, 'groupBy / fromAsync'],
];
test('no JavaScript syntax or API newer than iOS 14 under js/', () => {
  for (const f of jsFiles) {
    const src = read(f).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [re, name] of BAD_JS) assert.doesNotMatch(src, re, `${f}: ${name}`);
  }
});

const BAD_CSS = [
  [/color-mix\(/, 'color-mix'],
  [/backdrop-filter/, 'backdrop-filter'],
  [/@container|@layer|:where\(|:is\(/, 'container queries / layers / :is / :where'],
  [/\b(svh|lvh)\b/, 'svh/lvh units'],
  [/\bsubgrid\b/, 'subgrid'],
  [/text-wrap\s*:/, 'text-wrap'],
];
test('no CSS feature newer than Safari 14 without a fallback', () => {
  for (const f of cssSources) {
    const src = stripCss(read(f));
    for (const [re, name] of BAD_CSS) assert.doesNotMatch(src, re, `${f}: ${name}`);
  }
});

// A declaration the old browser does not understand is dropped, so the older one must come first inside the same rule.
test('dvh always follows a vh line in the same rule', () => {
  for (const f of cssSources) {
    for (const [, body] of stripCss(read(f)).matchAll(/\{([^{}]*dvh[^{}]*)\}/g)) {
      const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
      decls.forEach((d, i) => {
        if (!/dvh/.test(d)) return;
        const prop = d.split(':')[0].trim();
        assert.ok(decls.slice(0, i).some((x) => x.startsWith(`${prop}:`) && /vh/.test(x) && !/dvh/.test(x)), `${f}: ${d}`);
      });
    }
  }
});

test('position: sticky has a -webkit- line first', () => {
  for (const f of cssSources) {
    for (const [, body] of read(f).matchAll(/\{([^{}]*position:\s*sticky[^{}]*)\}/g)) {
      assert.match(body, /position:\s*-webkit-sticky;\s*position:\s*sticky/, f);
    }
  }
});

test('inset shorthand (Safari 14.1) has top/right/bottom/left first', () => {
  for (const f of cssSources) {
    for (const [, body] of stripCss(read(f)).matchAll(/\{([^{}]*[\s;{]inset:\s*[^;}]+[^{}]*)\}/g)) {
      assert.match(body, /top:[^;]+;\s*right:[^;]+;\s*bottom:[^;]+;\s*left:[^;]+;\s*inset:/, `${f}: ${body.trim()}`);
    }
  }
});

test('aspect-ratio rules have an @supports fallback', () => {
  const css = cssSources.map(read).join('\n');
  const uses = css.match(/aspect-ratio: 1;/g) || [];
  const fallbacks = css.match(/@supports not \(aspect-ratio: 1\)/g) || [];
  assert.equal(uses.length, 3);
  assert.equal(fallbacks.length, 3);
});

test('overflow-wrap: anywhere is always preceded by break-word', () => {
  for (const f of cssSources) {
    const src = read(f);
    assert.equal((src.match(/overflow-wrap: anywhere/g) || []).length, (src.match(/overflow-wrap: break-word; overflow-wrap: anywhere/g) || []).length, f);
  }
});

test('no :has() selector (Safari 15.4+); the banner uses a class instead', () => {
  for (const f of cssSources) assert.doesNotMatch(stripCss(read(f)), /:has\(/, f);
});

// iOS Safari zooms the page when a field under 16px gets focus.
function fontSize(css, selector) {
  const esc = selector.replace(/[.#[\]]/g, '\\$&');
  let size = null;
  for (const m of css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
    const f = m[1].match(/font:\s*(?:italic\s+)?\d+\s+(\d+)px/);
    const s = m[1].match(/font-size:\s*(\d+)px/);
    if (s) size = Number(s[1]); else if (f) size = Number(f[1]);
  }
  return size;
}
test('every text field is at least 16px on phones (no iOS focus zoom)', () => {
  const css = cssSources.map(read).join('\n');
  const fields = { '.td-field': 17, '.td-area': 19, '.nt-area': 19, '#si-form input': 18 };
  for (const [sel, expected] of Object.entries(fields)) {
    const size = fontSize(css, sel);
    assert.ok(size >= 16, `${sel} is ${size}px`);
    assert.equal(size, expected);
  }
  const phone = css.match(/@media \(max-width: 760px\) \{[\s\S]*?\n\}/g).join('\n');
  assert.doesNotMatch(phone, /(td-field|td-area|nt-area|si-form input)[^{]*\{[^}]*font(-size)?:[^;}]*\b1[0-5]px/);
  // Markup: every input / textarea / select is one of the styled kinds above.
  const html = read('index.html');
  const tags = html.match(/<(input|textarea|select)\b[^>]*>/g);
  assert.equal(tags.length, 5);
  for (const tag of tags) assert.ok(/class="td-field/.test(tag) || /id="si-(email|password)"/.test(tag) || /class="td-field td-area|nt-area/.test(tag), tag);
});

test('viewport allows zoom; text-size-adjust and touch-action are set', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /user-scalable|maximum-scale|minimum-scale/);
  const layout = read('css/layout.css');
  assert.match(layout, /-webkit-text-size-adjust: 100%/);
  assert.match(layout, /touch-action: manipulation/);
});

test('hover never reveals a control: :hover rules only restyle', () => {
  for (const f of cssSources) {
    for (const m of stripCss(read(f)).matchAll(/[^{}]*:hover[^{}]*\{([^}]*)\}/g)) {
      assert.doesNotMatch(m[1], /display\s*:|visibility\s*:|opacity\s*:\s*1|pointer-events/, `${f}: ${m[0].trim()}`);
    }
  }
});

test('banner: the confirm state is a class on the banner (replaces :has)', () => {
  const doc = makeBannerDom();
  createBanner({ document: doc, onReset: async () => {} });
  const banner = doc.byId['sample-banner'];
  doc.byId['sample-reset'].click();
  assert.match(banner.className, /\bis-confirming\b/);
  doc.byId['sample-no'].click();
  assert.doesNotMatch(banner.className, /is-confirming/);
  assert.match(read('css/layout.css'), /\.banner\.is-confirming \.banner-text \{ display: none; \}/);
});
