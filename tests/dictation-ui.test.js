import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDictation } from '../js/screens/dictation.js';
import { El } from './helpers/fake-dom.js';

const KEY = 'journal-dictation-ok';
const BLOCKED = "The microphone is blocked. Allow it in your browser's settings, or use your keyboard's microphone key.";

// A stand-in for SpeechRecognition that records what was done to it.
class FakeEngine {
  static all = [];
  static startThrows = 0;
  static autoStart = true;
  constructor() {
    this.started = 0; this.aborted = 0; this.stopped = 0;
    FakeEngine.all.push(this);
  }
  start() {
    this.started += 1;
    if (FakeEngine.startThrows > 0) { FakeEngine.startThrows -= 1; throw new Error('InvalidStateError'); }
    this.running = true;
    if (FakeEngine.autoStart && this.onstart) this.onstart({});
  }
  abort() { this.aborted += 1; this.running = false; }
  stop() { this.stopped += 1; this.running = false; }
  // test drivers: parts is [[text, isFinal], ...]
  say(parts, resultIndex = 0) {
    const results = parts.map(([t, f]) => Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: f }));
    if (this.onresult) this.onresult({ resultIndex, results });
  }
  fail(error) { if (this.onerror) this.onerror({ error }); }
  end() { this.running = false; if (this.onend) this.onend({}); }
}

function makeTimers() {
  const q = [];
  let id = 0;
  return {
    q,
    setTimer: (fn, ms) => { id += 1; q.push({ id, fn, ms }); return id; },
    clearTimer: (i) => { const k = q.findIndex((t) => t.id === i); if (k >= 0) q.splice(k, 1); },
    fire() { const t = q.shift(); if (t) t.fn(); return t; },
  };
}

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
}

function setup(over = {}) {
  FakeEngine.all = []; FakeEngine.startThrows = 0; FakeEngine.autoStart = true;
  const doc = { activeElement: null, visibilityState: 'visible', listeners: {} };
  doc.addEventListener = (t, f) => { (doc.listeners[t] ||= []).push(f); };
  doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter((x) => x !== f); };
  const wl = {};
  const win = {
    SpeechRecognition: FakeEngine, isSecureContext: true, document: doc, navigator: { language: 'en-GB' },
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    addEventListener: (t, f) => { (wl[t] ||= []).push(f); },
    removeEventListener: (t, f) => { wl[t] = (wl[t] || []).filter((x) => x !== f); },
    ...over.win,
  };
  const mk = () => { const e = new El(doc, 'x'); e.root = true; return e; };
  const area = mk(); area.selectionStart = 0; area.selectionEnd = 0;
  area.setSelectionRange = (a, b) => { area.selectionStart = a; area.selectionEnd = b; };
  const inputs = [];
  area.addEventListener('input', () => inputs.push(area.value));
  const button = mk(); button.hidden = true; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', 'Dictate');
  const previewEl = mk(), statusEl = mk(), alertEl = mk(), notice = mk(), startBtn = mk(), noBtn = mk();
  notice.hidden = true;
  const timers = makeTimers();
  const storage = over.storage === undefined ? memoryStorage() : over.storage;
  const dictation = createDictation({
    win, area, button, previewEl, statusEl, alertEl, notice, startBtn, noBtn, storage,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...over.opts,
  });
  const engine = () => FakeEngine.all[FakeEngine.all.length - 1];
  const sel = (a, b = a) => { area.selectionStart = a; area.selectionEnd = b; };
  return { dictation, doc, win, wl, area, button, previewEl, statusEl, alertEl, notice, startBtn, noBtn, timers, storage, inputs, engine, sel };
}

// Click Dictate, accept the notice the first time, and return the running engine.
function begin(t) {
  t.button.click();
  if (!t.notice.hidden) t.startBtn.click();
  return t.engine();
}

test('the button is hidden when the browser cannot dictate, and the page says nothing', () => {
  const t = setup({ win: { SpeechRecognition: undefined } });
  assert.equal(t.button.hidden, true);
  assert.equal(t.statusEl.textContent, '');
  assert.equal(t.alertEl.textContent, '');
  assert.equal(t.dictation.isListening(), false);
  const t2 = setup({ win: { isSecureContext: false } });
  assert.equal(t2.button.hidden, true);
  assert.equal(t2.alertEl.textContent, '');
});

test('the button shows when dictation is possible, and nothing starts by itself', () => {
  const t = setup();
  assert.equal(t.button.hidden, false);
  assert.equal(FakeEngine.all.length, 0);
  assert.equal(t.dictation.isListening(), false);
  assert.equal(t.notice.hidden, true);
  assert.equal(t.button.getAttribute('aria-pressed'), 'false');
  assert.equal(t.button.getAttribute('aria-label'), 'Dictate');
});

test('first use: a click opens the notice, focus goes to Start, and nothing listens until Start', () => {
  const t = setup();
  t.button.click();
  assert.equal(t.notice.hidden, false);
  assert.equal(t.doc.activeElement, t.startBtn);
  assert.equal(FakeEngine.all.length, 0);
  assert.equal(t.dictation.isListening(), false);
  t.startBtn.click();
  assert.equal(t.notice.hidden, true);
  assert.equal(FakeEngine.all.length, 1);
  assert.equal(t.engine().started, 1);
  assert.equal(t.dictation.isListening(), true);
  assert.equal(t.storage.m.get(KEY), '1');
});

test('the notice text is exactly the agreed words, once on Today and once on Notes', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const exact = "Dictation sends your voice to your browser's speech service: Google for Chrome, Apple for Safari. This site doesn't record or keep it. Start dictating?";
  assert.equal(text.split(exact).length - 1, 2);
});

test('Not now closes the notice, returns focus to the Dictate button and remembers nothing', () => {
  const t = setup();
  t.button.click();
  t.noBtn.click();
  assert.equal(t.notice.hidden, true);
  assert.equal(t.doc.activeElement, t.button);
  assert.equal(FakeEngine.all.length, 0);
  assert.equal(t.storage.m.has(KEY), false);
  t.button.click();
  assert.equal(t.notice.hidden, false, 'asks again next time');
});

test('Escape in the notice closes it and returns focus to the button', () => {
  const t = setup();
  t.button.click();
  let prevented = false;
  t.notice.dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(t.notice.hidden, true);
  assert.equal(t.doc.activeElement, t.button);
  assert.equal(prevented, true);
  assert.equal(FakeEngine.all.length, 0);
});

test('once chosen, later clicks start straight away (the choice is remembered on the device)', () => {
  const t = setup({ storage: memoryStorage({ [KEY]: '1' }) });
  t.button.click();
  assert.equal(t.notice.hidden, true);
  assert.equal(t.dictation.isListening(), true);
});

test('storage that throws falls back to memory: the notice is shown once per page load, never crashes', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const t = setup({ storage: throwing });
  t.button.click(); t.startBtn.click();
  t.dictation.stop();
  t.button.click();
  assert.equal(t.notice.hidden, true, 'memory remembers');
  assert.equal(t.dictation.isListening(), true);
  const t2 = setup({ storage: null });
  t2.button.click(); t2.startBtn.click();
  assert.equal(t2.dictation.isListening(), true);
});

test('only the single key is ever written, and only the value "1" (no personal data)', () => {
  const t = setup();
  begin(t).say([['my secret diary words', true]]);
  assert.deepEqual([...t.storage.m.entries()], [[KEY, '1']]);
});

test('the engine is configured for continuous speech with interim results, one alternative, the page language', () => {
  const t = setup({ win: { navigator: { language: 'fr-CA' } } });
  const e = begin(t);
  assert.equal(e.continuous, true);
  assert.equal(e.interimResults, true);
  assert.equal(e.maxAlternatives, 1);
  assert.equal(e.lang, 'fr-CA');
  const withLang = setup().doc;
  withLang.documentElement = { lang: 'de-DE' };
  const t2 = setup({ win: { navigator: {}, document: withLang } });
  assert.equal(begin(t2).lang, 'de-DE');
  const t3 = setup({ win: { navigator: {} } });
  assert.equal(begin(t3).lang, 'en-US');
});

test('listening state: pressed, labelled Stop dictating, status "Listening" in a polite status region', () => {
  const t = setup();
  begin(t);
  assert.equal(t.button.getAttribute('aria-pressed'), 'true');
  assert.equal(t.button.getAttribute('aria-label'), 'Stop dictating');
  assert.equal(t.statusEl.textContent, 'Listening');
  assert.equal(t.statusEl.hidden, false, 'live region stays in the page');
  assert.ok(t.button.className.split(' ').includes('is-live'));
});

test('interim words go to the preview only; the box is untouched', () => {
  const t = setup();
  t.area.value = 'Earlier.';
  const e = begin(t);
  e.say([['hello wor', false]]);
  assert.equal(t.previewEl.textContent, 'Hearing: hello wor');
  assert.equal(t.area.value, 'Earlier.');
  assert.equal(t.inputs.length, 0);
});

test('final words are inserted at the caret, an input event fires, the preview clears, the caret follows', () => {
  const t = setup();
  t.area.value = 'one three';
  t.area.dispatch('focus');
  t.sel(4);
  const e = begin(t);
  e.say([['two', true]]);
  assert.equal(t.area.value, 'one two three');
  assert.equal(t.area.selectionStart, 7);
  assert.equal(t.area.selectionEnd, 7);
  assert.deepEqual(t.inputs, ['one two three']);
  assert.equal(t.previewEl.textContent, '');
  e.say([['and', true]]);
  assert.equal(t.area.value, 'one two and three');
  assert.equal(t.inputs.length, 2);
});

test('a never-touched box gets the words at the end, not the start', () => {
  const t = setup();
  t.area.value = 'Draft from before.';
  t.sel(0);
  begin(t).say([['more', true]]);
  assert.equal(t.area.value, 'Draft from before. more');
});

test('a final result replaces the selection', () => {
  const t = setup();
  t.area.value = 'keep XXX keep';
  t.area.dispatch('focus');
  t.sel(5, 8);
  begin(t).say([['new', true]]);
  assert.equal(t.area.value, 'keep new keep');
});

test('a result with an interim part after a final part: final inserted, interim previewed', () => {
  const t = setup();
  const e = begin(t);
  e.say([['first bit', true], ['and then', false]]);
  assert.equal(t.area.value, 'first bit');
  assert.equal(t.previewEl.textContent, 'Hearing: and then');
});

test('earlier finals are not inserted twice when resultIndex moves on', () => {
  const t = setup();
  const e = begin(t);
  e.say([['alpha', true]], 0);
  e.say([['alpha', true], ['beta', true]], 1);
  assert.equal(t.area.value, 'alpha beta');
});

test('focus: refocuses the box only if it already had focus (no keyboard pops up on a phone)', () => {
  const t = setup();
  const e = begin(t);
  t.doc.activeElement = t.button;
  e.say([['one', true]]);
  assert.equal(t.doc.activeElement, t.button);
  t.doc.activeElement = t.area;
  e.say([['two', true]]);
  assert.equal(t.doc.activeElement, t.area);
});

test('the transcript is set as text: markup in the words stays plain text', () => {
  const t = setup();
  const e = begin(t);
  e.say([['<b>x</b> & <script>alert(1)</script>', false]]);
  assert.equal(t.previewEl.textContent, 'Hearing: <b>x</b> & <script>alert(1)</script>');
  assert.equal(t.previewEl.children.length, 0);
  e.say([['<b>x</b>', true]]);
  assert.equal(t.area.value, '<b>x</b>');
});

test('nothing is logged: no console output at all while dictating', () => {
  const seen = [];
  const keep = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { keep[k] = console[k]; console[k] = (...a) => seen.push([k, a]); }
  try {
    const t = setup();
    const e = begin(t);
    e.say([['private words', false]]);
    e.say([['private words', true]]);
    e.fail('network');
    t.dictation.stop();
  } finally { for (const k of Object.keys(keep)) console[k] = keep[k]; }
  assert.deepEqual(seen, []);
});

test('the source has no network calls, no logging, no recording and no storage of transcripts', () => {
  for (const f of ['../js/screens/dictation.js', '../js/lib/dictation.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|console\.|innerHTML|insertAdjacentHTML|MediaRecorder|getUserMedia|indexedDB|sessionStorage/, f);
  }
});

test('Stop: aborts the engine, drops its handlers, status "Stopped", button back to Dictate', () => {
  const t = setup();
  const e = begin(t);
  t.button.click();
  assert.equal(e.aborted, 1);
  assert.equal(e.onresult, null);
  assert.equal(e.onend, null);
  assert.equal(e.onerror, null);
  assert.equal(t.dictation.isListening(), false);
  assert.equal(t.button.getAttribute('aria-pressed'), 'false');
  assert.equal(t.button.getAttribute('aria-label'), 'Dictate');
  assert.equal(t.statusEl.textContent, 'Stopped');
  assert.equal(t.previewEl.textContent, '');
  assert.equal(t.button.className.split(' ').includes('is-live'), false);
});

test('Escape inside the box stops dictation', () => {
  const t = setup();
  const e = begin(t);
  t.area.dispatch('keydown', { key: 'Escape' });
  assert.equal(e.aborted, 1);
  assert.equal(t.dictation.isListening(), false);
});

test('Escape in the box does nothing when not dictating', () => {
  const t = setup();
  t.area.dispatch('keydown', { key: 'Escape' });
  assert.equal(t.statusEl.textContent, '');
});

test('clear() stops without leaving words behind: status, preview, alert and notice are emptied', () => {
  const t = setup();
  const e = begin(t);
  e.say([['hearing this', false]]);
  t.dictation.clear();
  assert.equal(e.aborted, 1);
  assert.equal(t.dictation.isListening(), false);
  assert.equal(t.statusEl.textContent, '');
  assert.equal(t.previewEl.textContent, '');
  assert.equal(t.alertEl.textContent, '');
  const t2 = setup();
  t2.button.click();
  t2.dictation.clear();
  assert.equal(t2.notice.hidden, true);
});

test('stops when the page is hidden and when it is closed (pagehide)', () => {
  const t = setup();
  const e = begin(t);
  t.doc.visibilityState = 'hidden';
  for (const f of t.doc.listeners.visibilitychange || []) f({});
  assert.equal(e.aborted, 1);
  assert.equal(t.dictation.isListening(), false);
  const t2 = setup();
  const e2 = begin(t2);
  for (const f of t2.wl.pagehide || []) f({});
  assert.equal(e2.aborted, 1);
});

test('a page that becomes visible again does not restart anything', () => {
  const t = setup();
  begin(t);
  t.doc.visibilityState = 'hidden';
  for (const f of t.doc.listeners.visibilitychange || []) f({});
  t.doc.visibilityState = 'visible';
  for (const f of t.doc.listeners.visibilitychange || []) f({});
  assert.equal(FakeEngine.all.length, 1);
  assert.equal(t.dictation.isListening(), false);
});

test('auto-restart: when the engine ends on its own the session carries on after a short wait', () => {
  const t = setup();
  const e = begin(t);
  e.say([['one', true]]);
  e.end();
  assert.equal(t.dictation.isListening(), true, 'still wanted');
  assert.equal(t.timers.q.length, 1);
  assert.equal(t.timers.q[0].ms, 250);
  t.timers.fire();
  assert.equal(FakeEngine.all.length, 2);
  const e2 = t.engine();
  assert.equal(e2.started, 1);
  assert.equal(t.statusEl.textContent, 'Listening');
  e2.say([['two', true]]);
  assert.equal(t.area.value, 'one two');
});

test('Stop during the wait cancels the restart', () => {
  const t = setup();
  const e = begin(t);
  e.end();
  t.dictation.stop();
  assert.equal(t.timers.q.length, 0);
  assert.equal(FakeEngine.all.length, 1);
});

test('no-speech restarts quietly: no error message', () => {
  const t = setup();
  const e = begin(t);
  e.fail('no-speech');
  e.end();
  assert.equal(t.alertEl.textContent, '');
  assert.equal(t.dictation.isListening(), true);
  t.timers.fire();
  assert.equal(t.alertEl.textContent, '');
  assert.equal(t.dictation.isListening(), true);
});

test('after 3 consecutive failed starts it gives up with a plain message and the mic is off', () => {
  const t = setup();
  FakeEngine.autoStart = false; // the engine never reports that it started
  const e = begin(t);
  e.end();                               // failure 1
  assert.equal(t.timers.q[0].ms, 250);
  t.timers.fire(); t.engine().end();     // failure 2
  assert.equal(t.timers.q[0].ms, 500);
  t.timers.fire(); t.engine().end();     // failure 3
  assert.equal(t.dictation.isListening(), false);
  assert.equal(t.timers.q.length, 0);
  assert.match(t.alertEl.textContent, /keyboard's microphone key/);
  assert.equal(t.statusEl.textContent, 'Stopped');
  assert.equal(FakeEngine.all.length, 3);
  assert.equal(FakeEngine.all.every((x) => !x.running), true);
});

test('start() throwing counts as a failed start and also gives up after 3', () => {
  const t = setup();
  FakeEngine.startThrows = 99;
  t.button.click(); t.startBtn.click();
  for (let i = 0; i < 5 && t.timers.q.length; i++) t.timers.fire();
  assert.equal(t.dictation.isListening(), false);
  assert.notEqual(t.alertEl.textContent, '');
  assert.equal(FakeEngine.all.length, 3);
});

test('a start that works resets the failure count', () => {
  const t = setup();
  FakeEngine.autoStart = false;
  const e = begin(t);
  e.end();
  t.timers.fire();
  const e2 = t.engine();
  e2.onstart({});            // this one did start
  e2.end();
  assert.equal(t.timers.q[0].ms, 250, 'back to the short wait');
});

test('after many silent stretches in a row it stops instead of listening forever', () => {
  const t = setup();
  let e = begin(t);
  for (let i = 0; i < 20 && t.dictation.isListening(); i++) {
    e.fail('no-speech'); e.end();
    if (t.timers.q.length) { t.timers.fire(); e = t.engine(); }
  }
  assert.equal(t.dictation.isListening(), false);
  assert.match(t.alertEl.textContent, /didn't hear/i);
});

test('speech between silences keeps it going', () => {
  const t = setup();
  let e = begin(t);
  for (let i = 0; i < 12; i++) {
    e.fail('no-speech'); e.end(); t.timers.fire(); e = t.engine();
    e.say([['hi', true]]);
  }
  assert.equal(t.dictation.isListening(), true);
});

for (const code of ['not-allowed', 'service-not-allowed']) {
  test(`error ${code}: plain message, stops, mic released, typed text kept`, () => {
    const t = setup();
    t.area.value = 'typed before';
    const e = begin(t);
    e.fail(code);
    assert.equal(t.alertEl.textContent, BLOCKED);
    assert.equal(t.dictation.isListening(), false);
    assert.equal(e.aborted, 1);
    assert.equal(t.area.value, 'typed before');
    assert.equal(t.timers.q.length, 0, 'no restart after a fatal error');
  });
}

test('error audio-capture, network and unknown each give their own plain message', () => {
  const msgs = new Set();
  for (const code of ['audio-capture', 'network', 'language-not-supported']) {
    const t = setup();
    t.area.value = 'kept';
    const e = begin(t);
    e.fail(code);
    assert.notEqual(t.alertEl.textContent, '');
    msgs.add(t.alertEl.textContent);
    assert.equal(t.dictation.isListening(), false);
    assert.equal(t.area.value, 'kept');
  }
  assert.equal(msgs.size, 3);
});

test('an aborted error (our own stop) shows nothing', () => {
  const t = setup();
  const e = begin(t);
  e.fail('aborted');
  assert.equal(t.alertEl.textContent, '');
});

test('starting again clears the old error', () => {
  const t = setup();
  const e = begin(t);
  e.fail('network');
  assert.notEqual(t.alertEl.textContent, '');
  t.button.click();
  assert.equal(t.alertEl.textContent, '');
  assert.equal(t.dictation.isListening(), true);
});

test('the status, preview and alert elements are never hidden, so announcements are made', () => {
  const t = setup();
  const e = begin(t);
  e.fail('network');
  for (const el of [t.statusEl, t.previewEl, t.alertEl]) assert.equal(el.hidden, false);
});

test('a second start while one is running does nothing extra', () => {
  const t = setup();
  begin(t);
  t.dictation.start();
  assert.equal(FakeEngine.all.length, 1);
});

test('stop() when not dictating is harmless and says nothing', () => {
  const t = setup();
  t.dictation.stop();
  assert.equal(t.statusEl.textContent, '');
});

test('late events from a stopped engine are ignored', () => {
  const t = setup();
  const e = begin(t);
  t.dictation.stop();
  e.say([['late words', true]]);
  e.end();
  assert.equal(t.area.value, '');
  assert.equal(t.timers.q.length, 0);
});

test('onChange is told the new value after an insert', () => {
  const seen = [];
  const t = setup({ opts: { onChange: (v) => seen.push(v) } });
  begin(t).say([['hello', true]]);
  assert.deepEqual(seen, ['hello']);
});
