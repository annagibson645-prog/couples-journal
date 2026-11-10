// Dictation (speech to text) for a writing box, using the browser's own speech recognition.
//
// Privacy, in code: the browser's speech service hears the voice (Chrome sends audio to Google,
// Safari to Apple). This file never records audio, never makes a network call, never logs and never
// stores what was heard. The only place the words go is the box the person is writing in, as plain
// text (value / textContent). The one thing remembered is that the person chose Start on the notice,
// under the key below, on this device only; it holds no personal data.
//
// It never starts by itself. The first time, a notice explains who hears the voice and the person
// must press Start. It stops (and lets go of the microphone) on Stop, Escape, leaving the screen,
// sign-out, switching viewer, Reset sample data, a hidden page and pagehide.
import { speechSupport, insertAtCaret, describeError, restartDelay } from '../lib/dictation.js';

// Per device, not under the "journal-demo:" prefix, because that prefix is wiped at sign-out.
const OK_KEY = 'journal-dictation-ok';
const MAX_FAILED_STARTS = 3;   // in a row, then give up with a plain message
const MAX_SILENT_STRETCHES = 6; // quiet restarts in a row with nothing heard, then stop (never listen forever)
const COULD_NOT_START = "Dictation couldn't start. Please try again, or use your keyboard's microphone key.";
const HEARD_NOTHING = "We didn't hear anything, so dictation stopped. Tap the microphone to start again.";

function setClass(el, c, on) {
  const rest = String(el.className || '').split(' ').filter((x) => x && x !== c);
  if (on) rest.push(c);
  el.className = rest.join(' ');
}

// opts: { win, area, button, previewEl, statusEl, alertEl, notice, startBtn, noBtn, storage, onChange, setTimer, clearTimer }
//   notice / startBtn / noBtn: the first-use panel (hidden until needed) and its two buttons.
//   storage: localStorage-like (undefined = the window's own, null = none). Failures fall back to memory.
//   setTimer / clearTimer: for tests; default to the real timers.
export function createDictation({ win, area, button, previewEl, statusEl, alertEl, notice, startBtn, noBtn, storage, onChange, setTimer, clearTimer }) {
  const doc = win && win.document;
  const support = speechSupport(win);
  const setT = setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearT = clearTimer || ((id) => clearTimeout(id));
  if (!support.available) {
    // Say nothing: the phone keyboard's own microphone key still works.
    if (button) button.hidden = true;
    return { start() {}, stop() {}, clear() {}, isListening: () => false };
  }

  let store = storage;
  if (store === undefined) { try { store = win.localStorage; } catch (e) { store = null; } }
  let memoryOk = false;

  let wanted = false;        // the person asked for dictation and has not stopped it
  let rec = null;            // the live recognition object, or null
  let began = false;         // the current recognition object reported that it started
  let heardSomething = false; // words arrived since the last quiet stretch
  let sawSilence = false;    // the current object ended for no-speech
  let failures = 0;          // failed starts in a row
  let silent = 0;            // silent stretches in a row
  let timer = null;          // pending restart
  let placed = false;        // the caret was put somewhere by the person (or by us)

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
  // Let go of the current object: drop every handler first (so nothing it says afterwards reaches
  // us), then abort it so the browser's recording indicator goes away.
  function release() {
    if (timer !== null) { clearT(timer); timer = null; }
    const r = rec;
    rec = null;
    if (!r) return;
    for (const k of ['onstart', 'onaudiostart', 'onspeechstart', 'onresult', 'onerror', 'onend', 'onnomatch']) {
      try { r[k] = null; } catch (e) { /* ignore */ }
    }
    try { r.abort(); } catch (e) { /* already stopped */ }
  }

  function finish(status) {
    wanted = false;
    release();
    text(previewEl, '');
    text(statusEl, status);
    paint();
  }

  function giveUp(message) {
    text(alertEl, message);
    finish('Stopped');
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
    const Engine = win.SpeechRecognition || win.webkitSpeechRecognition;
    const mine = new Engine();
    began = false;
    sawSilence = false;
    heardSomething = false;
    mine.lang = pageLang();
    mine.continuous = true;
    mine.interimResults = true;
    mine.maxAlternatives = 1;
    const live = () => rec === mine;
    const started = () => {
      if (!live()) return;
      began = true;
      failures = 0;
      text(statusEl, 'Listening');
    };
    mine.onstart = started;
    mine.onaudiostart = started;
    mine.onspeechstart = started;
    mine.onresult = (ev) => {
      if (!live()) return;
      began = true;
      failures = 0;
      let finals = '';
      let interim = '';
      for (let i = ev.resultIndex || 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0] && r[0].transcript ? r[0].transcript : '';
        if (r.isFinal) finals += (finals ? ' ' : '') + t.trim(); else interim += t;
      }
      if (finals.trim()) { heardSomething = true; silent = 0; insert(finals); }
      const hearing = interim.trim();
      text(previewEl, hearing ? `Hearing: ${hearing}` : '');
    };
    mine.onerror = (ev) => {
      if (!live()) return;
      const code = ev && ev.error;
      if (code === 'aborted') return;
      const d = describeError(code);
      if (d.retry) { sawSilence = true; return; } // quiet: onend restarts it
      giveUp(d.message);
    };
    mine.onend = () => {
      if (!live()) return;
      rec = null; // this object is finished; handlers go with it
      for (const k of ['onstart', 'onaudiostart', 'onspeechstart', 'onresult', 'onerror', 'onend']) mine[k] = null;
      text(previewEl, '');
      if (!wanted) return;
      if (!began && !sawSilence) { failedStart(); return; }
      if (sawSilence && !heardSomething) {
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
      for (const k of ['onstart', 'onaudiostart', 'onspeechstart', 'onresult', 'onerror', 'onend']) mine[k] = null;
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
    text(alertEl, '');
    failures = 0;
    silent = 0;
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

  function stop() {
    if (!wanted) return;
    finish('Stopped');
  }

  // Everything off and emptied (leaving the screen, sign-out, viewer switch, reset).
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
  if (notice) {
    startBtn.addEventListener('click', () => { remember(); closeNotice(true); begin(); });
    noBtn.addEventListener('click', () => closeNotice(true));
    notice.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); closeNotice(true); }
    });
  }
  area.addEventListener('keydown', (e) => { if (e.key === 'Escape') stop(); });
  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') stop(); });
  if (win.addEventListener) win.addEventListener('pagehide', stop);

  return { start, stop, clear, isListening: () => wanted };
}
