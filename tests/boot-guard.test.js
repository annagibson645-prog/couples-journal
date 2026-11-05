// The inline guard in index.html: runs the real shipped script text against a tiny DOM stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const guardSrc = html.match(/<script id="boot-guard">([\s\S]*?)<\/script>/)[1];
const nomoduleSrc = html.match(/<script nomodule>([\s\S]*?)<\/script>/)[1];

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.parentNode = null; this.textContent = ''; this.id = ''; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : this.children.length; this.children.splice(i < 0 ? 0 : i, 0, c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  get firstChild() { return this.children[0] || null; }
  find(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.find(pred, out); } return out; }
}

function setup({ ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 Safari', started = false, withBody = true } = {}) {
  const body = new Node('body');
  const doc = { body: withBody ? body : null, listeners: {}, createElement: (t) => new Node(t),
    getElementById: (id) => { const hit = (withBody ? body : { find: () => [] }).find((n) => n.id === id); return hit[0] || null; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } };
  const timers = [];
  const win = { navigator: { userAgent: ua }, listeners: {}, location: { reloads: 0, reload() { this.reloads++; } }, __journalStarted: started || undefined,
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    setTimeout: (f, ms) => { timers.push({ f, ms, kind: 'timeout' }); return timers.length; },
    setInterval: (f, ms) => { timers.push({ f, ms, kind: 'interval' }); return timers.length; },
    clearInterval() {} };
  win.window = win;
  const ctx = vm.createContext({ window: win, document: doc, String, Error });
  vm.runInContext(guardSrc, ctx);
  return { win, doc, body, timers, ctx, fire: (t, ev) => (win.listeners[t] || []).forEach((f) => f(ev)) };
}

const box = (s) => s.doc.getElementById('boot-error');

test('formatTech joins the message and the user agent and never exceeds 200 characters', () => {
  const s = setup({ ua: 'UA/1.0' });
  const { formatTech } = s.win.__journalGuard;
  assert.equal(formatTech('boom'), 'boom | UA/1.0');
  assert.equal(formatTech(''), 'unknown error | UA/1.0');
  assert.equal(formatTech(null), 'unknown error | UA/1.0');
  assert.equal(formatTech('line one\n   line two'), 'line one line two | UA/1.0');
  const long = setup({ ua: 'U'.repeat(500) }).win.__journalGuard.formatTech('E'.repeat(500));
  assert.equal(long.length, 200);
  assert.ok(long.startsWith('E'.repeat(90) + ' | U'));
});

test('an error before the app has started shows the message, a Reload button and the grey technical line', () => {
  const s = setup();
  s.fire('error', { message: 'Can\'t find variable: structuredClone' });
  const b = box(s);
  assert.ok(b, 'message is shown');
  assert.equal(b.attrs.role, 'alert');
  assert.equal(s.body.firstChild, b, 'at the top of the page');
  const text = b.find(() => true).map((n) => n.textContent).join('|');
  assert.match(text, /Something went wrong loading the journal\./);
  assert.match(text, /Can't find variable: structuredClone \| Mozilla\/5\.0 \(iPhone/);
  const btn = b.find((n) => n.tag === 'button')[0];
  assert.equal(btn.textContent, 'Reload');
  btn.listeners.click[0]();
  assert.equal(s.win.location.reloads, 1);
  assert.equal(b.find((n) => n.className === 'boot-tech').length, 1);
});

test('an unhandled promise rejection before start shows the message too', () => {
  const s = setup();
  s.fire('unhandledrejection', { reason: new Error('nope') });
  assert.match(box(s).find((n) => n.className === 'boot-tech')[0].textContent, /^nope \| /);
});

test('a script that fails to load is reported; a failed font or image is not', () => {
  const s = setup();
  s.fire('error', { target: { tagName: 'LINK' } });
  assert.equal(box(s), null);
  s.fire('error', { target: { tagName: 'SCRIPT', src: 'https://x.test/js/app.js' } });
  assert.match(box(s).find((n) => n.className === 'boot-tech')[0].textContent, /^Could not load https:\/\/x\.test\/js\/app\.js \| /);
});

test('once the app has started, later errors show nothing', () => {
  const s = setup({ started: true });
  s.fire('error', { message: 'late' });
  s.fire('unhandledrejection', { reason: 'late' });
  assert.equal(box(s), null);
});

test('only one message is ever shown', () => {
  const s = setup();
  s.fire('error', { message: 'a' });
  s.fire('error', { message: 'b' });
  assert.equal(s.body.children.length, 1);
});

test('when the app starts after an early error, the message goes away', () => {
  const s = setup();
  s.fire('error', { message: 'injected by an in-app browser' });
  assert.ok(box(s));
  s.win.__journalStarted = true;
  s.timers.find((t) => t.kind === 'interval').f();
  assert.equal(box(s), null);
});

test('no message on a fast start; a quiet "Still loading" note only if start is slow; failure after 15 s', () => {
  const fast = setup();
  fast.win.__journalStarted = true;
  fast.timers.filter((t) => t.kind === 'timeout').forEach((t) => t.f());
  assert.equal(fast.body.children.length, 0, 'nothing appears when the app is up');

  const slow = setup();
  const [note, giveUp] = slow.timers.filter((t) => t.kind === 'timeout');
  assert.equal(note.ms, 1500);
  note.f();
  const loading = slow.doc.getElementById('boot-loading');
  assert.equal(loading.textContent, 'Still loading…');
  assert.equal(loading.attrs.role, 'status');
  assert.equal(giveUp.ms, 15000);
  giveUp.f();
  assert.ok(box(slow));
  assert.equal(slow.doc.getElementById('boot-loading'), null, 'the note is replaced by the error');
});

test('if the body is not parsed yet, the message waits for DOMContentLoaded', () => {
  const s = setup({ withBody: false });
  s.win.__journalGuard.show('Hello', 'x', true);
  assert.equal(s.doc.listeners.DOMContentLoaded.length, 1);
  s.doc.body = new Node('body');
  s.doc.listeners.DOMContentLoaded[0]();
  assert.equal(s.doc.body.children.length, 1);
});

test('nomodule script shows the too-old message without a Reload button', () => {
  const s = setup();
  vm.runInContext(nomoduleSrc, s.ctx);
  const texts = box(s).find(() => true).map((n) => n.textContent);
  assert.ok(texts.includes('This browser is too old for this page. Try the latest Chrome or Safari.'));
  assert.equal(box(s).find((n) => n.tag === 'button').length, 0);
});

test('index.html: noscript message, guard before the module script, nomodule present, readable in both themes at 375px', () => {
  assert.match(html, /<noscript><p[^>]*>This journal needs JavaScript\./);
  assert.ok(html.indexOf('id="boot-guard"') < html.indexOf('<script type="module"'));
  assert.match(html, /<script nomodule>/);
  assert.match(html, /#boot-error,#boot-loading\{[^}]*font:400 16px/);
  assert.match(html, /html\[data-theme="light"\] #boot-error/);
  assert.match(html, /#boot-error button\{[^}]*min-height:44px/);
  assert.match(html, /#boot-error \.boot-tech\{[^}]*word-break:break-all/);
});
