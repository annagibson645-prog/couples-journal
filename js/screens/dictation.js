// Dictation (speech to text) for a writing box, using the browser's own speech recognition.
//
// Privacy, in code: the browser's speech service hears the voice (Chrome sends audio to Google,
// Safari to Apple). This file never records audio, never makes a network call, never logs and never
// stores what was heard. The only place the words go is the box the person is writing in, as plain
// text (value / textContent). The one thing remembered is that the person chose Start on the notice,
// under the key below, on this device only; it holds no personal data.
//
// It never starts by itself. The first time, a notice explains who hears the voice and the person
// must press Start.
//
// Two ways of stopping:
//  - GENTLE (the person's own Stop, Escape, Save entry / Leave note): the engine is asked to stop(),
//    so the last words are not thrown away. Final results keep arriving until it ends (or about 1.5 s
//    pass); an interim phrase still showing is inserted if no final came. Then the engine is released.
//  - IMMEDIATE (clear(): leaving the screen, sign-out, viewer switch, reset; a hidden page, pagehide,
//    errors, giving up): abort() at once, nothing inserted, nothing waited for.
// Either way the microphone is never left on.
import { speechSupport, insertAtCaret, describeError, restartDelay } from '../lib/dictation.js';

// Per device, not under the "journal-demo:" prefix, because that prefix is wiped at sign-out.
const OK_KEY = 'journal-dictation-ok';
const MAX_FAILED_STARTS = 3;    // in a row, then give up with a plain message
const MAX_SILENT_STRETCHES = 6; // engine ends with nothing heard, in a row, then stop (never listen forever)
const GRACE_MS = 1500;          // how long a gentle stop waits for the engine to finish
const COULD_NOT_START = "Dictation couldn't start. Please try again, or use your keyboard's microphone key.";
const HEARD_NOTHING = 'Dictation stopped because nothing was heard. Tap the microphone to start again.';
const PAUSED = 'Dictation paused. Tap the microphone to keep going.';
const TOO_LONG = 'Stopped: a note can hold 2,000 characters.';
const HANDLERS = ['onstart', 'onaudiostart', 'onspeechstart', 'onresult', 'onerror', 'onend', 'onnomatch'];

function setClass(el, c, on) {
  const rest = String(el.className || '').split(' ').filter((x) => x && x !== c);
  if (on) rest.push(c);
  el.className = rest.join(' ');
}

// opts: { win, area, button, previewEl, statusEl, alertEl, notice, startBtn, noBtn, storage, onChange, maxLength, setTimer, clearTimer }
//   notice / startBtn / noBtn: the first-use panel (hidden until needed) and its two buttons.
//   storage: localStorage-like (undefined = the window's own, null = none). Failures fall back to memory.
//   maxLength: stop (gently) when the box grows past this many characters.
//   setTimer / clearTimer: for tests; default to the real timers.
export function createDictation({ win, area, button, previewEl, statusEl, alertEl, notice, startBtn, noBtn, storage, onChange, maxLength, setTimer, clearTimer }) {
  const doc = win && win.document;
  const support = speechSupport(win);
  const setT = setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearT = clearTimer || ((id) => clearTimeout(id));
  if (!support.available) {
    // Say nothing: the phone keyboard's own microphone key still works.
    if (button) button.hidden = true;
    return { start() {}, stop() {}, finish: () => Promise.resolve(), clear() {}, isListening: () => false };
  }

  let store = storage;
  if (store === undefined) { try { store = win.localStorage; } catch (e) { store = null; } }
  let memoryOk = false;

  let wanted = false;         // the person asked for dictation and has not stopped it
  let stopping = false;       // a gentle stop is waiting for the engine to finish
  let rec = null;             // the live recognition object, or null
  let began = false;          // the current recognition object reported that it started
  let everBegan = false;      // some engine started since the person last pressed Dictate
  let heardSomething = false; // the current object produced words (final or interim)
  let sawSilence = false;     // the current object reported no-speech
  let sawAbort = false;       // the browser aborted the current object by itself
  let interimText = '';       // the interim phrase now showing in the preview
  let failures = 0;           // failed starts in a row
  let silent = 0;             // engine ends with nothing heard, in a row
  let aborts = 0;             // browser-initiated aborts in a row
  let timer = null;           // pending restart
  let graceTimer = null;      // pending end of a gentle stop
  let waiters = [];           // finish() promises waiting for the gentle stop
  let placed = false;         // the caret was put somewhere by the person (or by us)

  area.addEventListener('focus', () => { placed = true; });
  area.addEventListener('input', () => { placed = true; });

  const text = (el, v) => { if (el) el.textContent = v; };
  const confirmed = () => {
    if (memoryOk) return true;
    try { return !!store && store.getItem(OK_KEY) === '1'; } catch (e) { return false; }
  };
  const remember = () => {
    memoryOk = true;
    try { if (store) store.setItem(OK_KEY, '1'); } catch (e) { /* memory remembers for this visit */ }
  };

  function paint() {
    button.setAttribute('aria-pressed', String(wanted));
    button.setAttribute('aria-label', wanted ? 'Stop dictating' : 'Dictate');
    setClass(button, 'is-live', wanted);
  }

  function pageLang() {
    const attr = doc && doc.documentElement && doc.documentElement.lang;
    const nav = win.navigator && win.navigator.language;
    if (attr && nav && attr.indexOf('-') === -1 && nav.toLowerCase().split('-')[0] === attr.toLowerCase()) return nav; // "en" -> "en-GB"
    return attr || nav || 'en-US';
  }

  // --- the recognition object ---------------------------------------------------------------
  function drop(r) {
    for (const k of HANDLERS) {
      try { r[k] = null; } catch (e) { /* ignore */ }
    }
  }

  function wake() {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  }

  // Let go of the current object: drop every handler first (so nothing it says afterwards reaches
  // us), then abort it so the browser's recording indicator goes away.
  function release() {
    if (timer !== null) { clearT(timer); timer = null; }
    if (graceTimer !== null) { clearT(graceTimer); graceTimer = null; }
    stopping = false;
    interimText = '';
    const r = rec;
    rec = null;
    if (r) {
      drop(r);
      try { r.abort(); } catch (e) { /* already stopped */ }
    }
    wake();
  }

  // Immediate stop: no waiting, nothing more inserted.
  function abortNow(status) {
    wanted = false;
    release();
    text(previewEl, '');
    text(statusEl, status);
    paint();
  }

  function giveUp(message) {
    text(alertEl, message);
    abortNow('Stopped');
  }

  function place() {
    if (placed) return;
    placed = true;
    const n = area.value.length;
    try {
      if (area.setSelectionRange) area.setSelectionRange(n, n);
      else { area.selectionStart = n; area.selectionEnd = n; }
    } catch (e) { /* ignore */ }
  }

  function insert(heard) {
    const had = doc && doc.activeElement === area;
    const res = insertAtCaret(area.value, area.selectionStart, area.selectionEnd, heard);
    if (res.value === area.value) return;
    area.value = res.value;
    try {
      if (area.setSelectionRange) area.setSelectionRange(res.caret, res.caret);
      else { area.selectionStart = res.caret; area.selectionEnd = res.caret; }
    } catch (e) { /* ignore */ }
    // Setting .value does not fire input by itself; the word count, auto-grow and draft saving listen for it.
    const ev = typeof win.Event === 'function' ? new win.Event('input', { bubbles: true }) : { type: 'input' };
    area.dispatchEvent(ev);
    if (onChange) onChange(res.value);
    if (had) area.focus(); // only if it already had focus: never pop the keyboard up
    if (maxLength && res.value.length > maxLength && wanted) {
      text(alertEl, TOO_LONG);
      stop();
    }
  }

  // The gentle stop is over (the engine ended, or the grace period did): put in any interim phrase
  // that never became final, then let go of the engine.
  function settle() {
    if (!stopping) return;
    const rest = interimText;
    interimText = '';
    if (rest) insert(rest);
    text(previewEl, '');
    release();
  }

  // The person's own stop: ask the engine to finish, so the last words are not lost.
  function stop() {
    if (!wanted) return;
    wanted = false;
    if (timer !== null) { clearT(timer); timer = null; }
    text(statusEl, 'Stopped');
    paint();
    if (!rec) { release(); return; }
    stopping = true;
    try {
      rec.stop();
    } catch (e) {
      settle();
      return;
    }
    graceTimer = setT(() => { graceTimer = null; settle(); }, GRACE_MS);
  }

  // Resolves once dictation is fully stopped (the last words are in the box). Starts a gentle stop if
  // still listening; resolves at once when idle.
  function finish() {
    if (wanted) stop();
    if (!stopping) return Promise.resolve();
    return new Promise((resolve) => { waiters.push(resolve); });
  }

  function scheduleRestart() {
    timer = setT(() => {
      timer = null;
      if (wanted) launch();
    }, restartDelay(Math.max(0, failures - 1)));
  }

  function failedStart() {
    failures += 1;
    if (failures >= MAX_FAILED_STARTS) giveUp(COULD_NOT_START);
    else scheduleRestart();
  }

  function launch() {
    release(); // never two engines at once: the old one is aborted first
    const Engine = win.SpeechRecognition || win.webkitSpeechRecognition;
    const mine = new Engine();
    began = false;
    sawSilence = false;
    sawAbort = false;
    heardSomething = false;
    interimText = '';
    mine.lang = pageLang();
    mine.continuous = true;
    mine.interimResults = true;
    mine.maxAlternatives = 1;
    const live = () => rec === mine;
    const started = () => {
      if (!live()) return;
      began = true;
      everBegan = true;
      failures = 0;
      if (wanted) text(statusEl, 'Listening');
    };
    mine.onstart = started;
    mine.onaudiostart = started;
    mine.onspeechstart = started;
    mine.onresult = (ev) => {
      if (!live()) return;
      began = true;
      everBegan = true;
      failures = 0;
      let finals = '';
      let interim = '';
      for (let i = ev.resultIndex || 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0] && r[0].transcript ? r[0].transcript : '';
        if (r.isFinal) finals += (finals ? ' ' : '') + t.trim(); else interim += t;
      }
      interimText = interim.trim();
      if (finals.trim() || interimText) { heardSomething = true; silent = 0; aborts = 0; }
      text(previewEl, interimText ? `Hearing: ${interimText}` : '');
      if (finals.trim()) insert(finals);
    };
    mine.onerror = (ev) => {
      if (!live() || stopping) return;
      const code = ev && ev.error;
      if (code === 'aborted') { sawAbort = true; return; } // the browser did this, not us
      const d = describeError(code);
      if (d.retry) { sawSilence = true; return; } // quiet: onend restarts it
      // Refused after dictation had already begun (a restart with no tap, or a home-screen app): paused, not blocked.
      if (everBegan && (code === 'not-allowed' || code === 'service-not-allowed')) giveUp(PAUSED);
      else giveUp(d.message);
    };
    mine.onend = () => {
      if (!live()) return;
      if (stopping) { settle(); return; }
      rec = null; // this object is finished; handlers go with it
      drop(mine);
      text(previewEl, '');
      interimText = '';
      if (!wanted) return;
      if (sawAbort) {
        // The browser cut it off by itself: not a normal end. Back off, and give up after a few in a row.
        aborts += 1;
        if (aborts >= MAX_FAILED_STARTS) giveUp(COULD_NOT_START);
        else { failures = aborts; scheduleRestart(); }
        return;
      }
      if (!began && !sawSilence) { failedStart(); return; }
      if (!heardSomething) {
        silent += 1;
        if (silent >= MAX_SILENT_STRETCHES) { giveUp(HEARD_NOTHING); return; }
      }
      scheduleRestart();
    };
    rec = mine;
    try {
      mine.start();
    } catch (e) {
      rec = null;
      drop(mine);
      try { mine.abort(); } catch (e2) { /* nothing to stop */ }
      failedStart();
    }
  }

  // --- the first-use notice -----------------------------------------------------------------
  function noticeOpen() { return !!notice && !notice.hidden; }
  function openNotice() {
    notice.hidden = false;
    startBtn.focus();
  }
  function closeNotice(refocus) {
    if (!notice) return;
    notice.hidden = true;
    if (refocus) button.focus();
  }

  function begin() {
    if (stopping) settle(); // a gentle stop still finishing: put its words in, then start afresh
    text(alertEl, '');
    failures = 0;
    silent = 0;
    aborts = 0;
    everBegan = false;
    wanted = true;
    place();
    text(statusEl, 'Listening');
    paint();
    launch();
  }

  function start() {
    if (wanted || noticeOpen()) return;
    if (!confirmed()) { openNotice(); return; } // never starts without an explicit Start
    begin();
  }

  // Everything off and emptied (leaving the screen, sign-out, viewer switch, reset): immediate.
  function clear() {
    wanted = false;
    release();
    closeNotice(false);
    text(previewEl, '');
    text(statusEl, '');
    text(alertEl, '');
    placed = false;
    paint();
  }

  // --- wiring ---------------------------------------------------------------------------------
  button.hidden = false;
  paint();
  button.addEventListener('click', () => { if (wanted) stop(); else start(); });
  button.addEventListener('keydown', (e) => { if (e.key === 'Escape') stop(); });
  if (notice) {
    startBtn.addEventListener('click', () => { remember(); closeNotice(true); begin(); });
    noBtn.addEventListener('click', () => closeNotice(true));
    notice.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); closeNotice(true); }
    });
  }
  area.addEventListener('keydown', (e) => { if (e.key === 'Escape') stop(); });
  const hideNow = () => { if (wanted || stopping) abortNow('Stopped'); };
  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') hideNow(); });
  if (win.addEventListener) win.addEventListener('pagehide', hideNow);

  return { start, stop, finish, clear, isListening: () => wanted };
}
