// Today screen: mood moons, optional few words, the writing box and the list of
// this person's entries. Every piece of user text goes in with textContent.
import { moonPath } from '../lib/sigil.js';
import { dayKey } from '../lib/days.js';
import { moodWord, moodLabel, moonFraction, formatDateHeading, entryWhen, wordCount, formatWordCount } from '../lib/today.js';
import { makeEl, messageOf, collapsibleText } from './shared.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NOTHING_TO_SAVE = 'There is nothing to save yet. Write a few words first, then save.';
const SAVED = 'Saved on this device, then synced';
const REFRESH_FAILED = "Saved, but we couldn't refresh the list. Reopen Today to see it.";

// deps: { data, showScreen, rail?, document?, now?, debounceMs? }
// `rail` is the shared left rail (js/screens/rail.js); it owns navigation, so
// the app calls leave() before moving away from Today.
// `document` and `now` default to the real ones; tests pass stand-ins.
export function createToday({ data, showScreen, rail = { show() {} }, document: doc = globalThis.document, now = () => new Date(), debounceMs = 600 }) {
  const el = makeEl(doc);
  const $ = (id) => doc.getElementById(id);
  let who = 'hers';
  let score = null;          // the mood last saved (or loaded) for today
  let savedNote = '';        // the few words last saved (or loaded) for today
  let day = dayKey(now());
  let token = 0;             // bumps on show/clear so late replies are ignored
  let confirming = null;     // id of the entry showing "Delete this entry?"
  let entries = [];
  let draftTimer = null;     // pending debounced draft save
  const expanded = new Set(); // ids of long entries opened with Read more
  let rows = [];             // { entry, p, more } for the entries on screen

  // --- status area ---------------------------------------------------------
  function setError(msg) {
    const e = $('td-error');
    e.textContent = msg || '';
    e.hidden = !msg;
    if (msg) $('td-status').hidden = true;
  }
  // Shown only straight after something really saved.
  function setSaved() {
    setError('');
    const s = $('td-status');
    s.textContent = SAVED;
    s.hidden = false;
  }
  function clearStatus() {
    $('td-status').hidden = true;
    setError('');
  }

  // A new calendar day since the screen was shown: start the mood afresh and
  // refresh the heading and the "Today" labels.
  function syncDay() {
    const d = dayKey(now());
    if (d === day) return;
    day = d;
    score = null;
    savedNote = '';
    $('td-date').textContent = formatDateHeading(now());
    showMood(null);
    updateHint();
    renderEntries();
  }

  // Words typed before any moon is chosen wait in the field; say so.
  function updateHint() {
    $('td-hint').hidden = !(score === null && $('td-note').value.trim());
  }

  // --- writing box: word count, growth, draft -----------------------------
  function updateCount() {
    $('td-count').textContent = formatWordCount(wordCount($('td-text').value));
  }
  // Grow with the text; CSS max-height caps it and the box then scrolls.
  function autoGrow() {
    const box = $('td-text');
    if (!box.style) return;
    box.style.height = 'auto';
    box.style.height = box.scrollHeight > 0 ? `${box.scrollHeight + 2}px` : '';
  }
  function cancelDraft() {
    if (draftTimer !== null) { clearTimeout(draftTimer); draftTimer = null; }
  }
  // Storage problems are the adapter's to absorb; anything else is ignored
  // too, because a draft must never nag.
  // Returns a promise that always resolves, so a caller can wait for the write.
  function writeDraft(text) {
    try { return Promise.resolve(data.saveDraft(text)).catch(() => {}); } catch (e) { return Promise.resolve(); }
  }
  // Save now if a save is waiting (leaving the screen, closing the page).
  function flushDraft() {
    if (draftTimer === null) return Promise.resolve();
    cancelDraft();
    return writeDraft($('td-text').value);
  }
  function scheduleDraft() {
    cancelDraft();
    draftTimer = setTimeout(() => { draftTimer = null; writeDraft($('td-text').value); }, debounceMs);
  }

  // --- moons ---------------------------------------------------------------
  function buildMoons() {
    const host = $('td-moons');
    host.replaceChildren();
    for (let n = 1; n <= 10; n++) {
      const b = el('button', 'td-moon');
      b.type = 'button';
      b.dataset.score = String(n);
      b.setAttribute('aria-label', moodLabel(n));
      b.setAttribute('aria-pressed', 'false');
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 38 38');
      svg.setAttribute('aria-hidden', 'true');
      const ring = doc.createElementNS(SVG_NS, 'circle');
      for (const [k, v] of [['cx', 19], ['cy', 19], ['r', 17], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-opacity', '.55']]) ring.setAttribute(k, v);
      const lit = doc.createElementNS(SVG_NS, 'path');
      lit.setAttribute('d', moonPath(moonFraction(n)));
      lit.setAttribute('fill', 'currentColor');
      svg.append(ring, lit);
      b.appendChild(svg);
      b.addEventListener('click', () => chooseMood(n));
      host.appendChild(b);
    }
  }

  function showMood(n) {
    for (const b of $('td-moons').children) b.setAttribute('aria-pressed', String(Number(b.dataset.score) === n));
    $('td-word').textContent = n ? `${moodWord(n)}.` : 'Choose the moon that fits.';
  }

  async function chooseMood(n) {
    syncDay();
    const t = token;
    const previous = score;
    clearStatus();
    showMood(n);
    $('td-hint').hidden = true;
    const note = $('td-note').value.trim();
    try {
      await data.saveMood(day, n, note);
      if (t !== token) return;
      score = n;
      savedNote = note;
      setSaved();
    } catch (err) {
      if (t !== token) return;
      showMood(previous);
      updateHint();
      setError(messageOf(err, 'Could not save your mood.'));
    }
  }

  // The few words save as the mood's note. They need a mood to belong to, so
  // until a moon is chosen the words simply wait in the field.
  async function saveNote() {
    syncDay();
    const note = $('td-note').value.trim();
    if (score === null || note === savedNote) return;
    const t = token;
    try {
      await data.saveMood(day, score, note);
      if (t !== token) return;
      savedNote = note;
      setSaved();
    } catch (err) {
      if (t !== token) return;
      setError(messageOf(err, 'Could not save your words.'));
    }
  }

  // --- entries -------------------------------------------------------------
  function remeasure() {
    for (const r of rows) r.remeasure();
  }

  // `focus` ({ id, kind: 'yes' | 'delete' }) says which freshly drawn button to
  // focus, because redrawing the list throws away the one that had focus.
  function renderEntries(focus) {
    const list = $('td-list');
    list.replaceChildren();
    rows = [];
    $('td-empty').hidden = entries.length > 0;
    const today = dayKey(now());
    let toFocus = null; // focus only once attached: a detached element cannot take it
    for (const entry of entries) {
      const li = el('li', 'td-entry');
      li.appendChild(el('p', 'td-when', entryWhen(entry, today)));
      const text = collapsibleText(doc, entry.id, entry.text, expanded);
      li.append(text.p, text.more);
      rows.push(text);
      const actions = el('div', 'td-entry-actions');
      if (confirming === entry.id) {
        actions.appendChild(el('span', 'td-confirm-q', 'Delete this entry?'));
        const yes = el('button', 'td-link td-danger', 'Yes, delete');
        yes.type = 'button';
        yes.addEventListener('click', () => removeEntry(entry.id, yes));
        const keep = el('button', 'td-link', 'Keep it');
        keep.type = 'button';
        keep.addEventListener('click', () => { confirming = null; renderEntries({ id: entry.id, kind: 'delete' }); });
        actions.append(yes, keep);
        if (focus && focus.id === entry.id && focus.kind === 'yes') toFocus = yes;
      } else {
        const del = el('button', 'td-link', 'Delete');
        del.type = 'button';
        del.setAttribute('aria-label', `Delete the entry from ${entryWhen(entry, today)}`);
        del.addEventListener('click', () => { confirming = entry.id; renderEntries({ id: entry.id, kind: 'yes' }); });
        actions.appendChild(del);
        if (focus && focus.id === entry.id && focus.kind === 'delete') toFocus = del;
      }
      li.appendChild(actions);
      list.appendChild(li);
    }
    remeasure();
    if (toFocus) toFocus.focus();
  }

  async function loadEntries(t, focus) {
    const list = await data.listEntries();
    if (t !== token) return false;
    entries = list;
    renderEntries(focus);
    return true;
  }

  async function removeEntry(id, btn) {
    const t = token;
    const index = entries.findIndex((e) => e.id === id);
    btn.disabled = true;
    clearStatus();
    try {
      await data.deleteEntry(id);
      if (t !== token) return;
      confirming = null;
      // Focus the entry that took its place, else the one before, else the heading.
      const after = entries.filter((e) => e.id !== id);
      const next = after[index] || after[index - 1];
      await loadEntries(t, next ? { id: next.id, kind: 'delete' } : null);
      if (t === token && !next) $('td-entries-title').focus();
    } catch (err) {
      if (t !== token) return;
      btn.disabled = false;
      btn.focus();
      setError(messageOf(err, 'Could not delete that entry.'));
    }
  }

  async function saveEntry() {
    syncDay();
    const box = $('td-text');
    const text = box.value;
    clearStatus();
    if (!text.trim()) {
      setError(NOTHING_TO_SAVE);
      box.focus();
      return;
    }
    const t = token;
    const btn = $('td-save');
    btn.disabled = true;
    let saved = false;
    try {
      await data.addEntry(text);
      if (t !== token) return;
      saved = true;
      cancelDraft();
      box.value = '';
      updateCount();
      autoGrow();
      writeDraft('');
    } catch (err) {
      // The words stay in the box so nothing typed is lost.
      if (t === token) setError(messageOf(err, 'Could not save your entry.'));
    }
    if (saved) {
      // The entry IS saved; a failed refresh is a different, smaller problem.
      try {
        await loadEntries(t);
        if (t === token) setSaved();
      } catch (err) {
        if (t === token) setError(REFRESH_FAILED);
      }
    }
    if (t === token) {
      btn.disabled = false;
      box.focus();
    }
  }

  function resetView() {
    token += 1;
    score = null;
    savedNote = '';
    confirming = null;
    entries = [];
    cancelDraft();
    expanded.clear();
    rows = [];
    $('td-text').value = '';
    updateCount();
    autoGrow();
    $('td-note').value = '';
    $('td-list').replaceChildren();
    $('td-empty').hidden = true;
    showMood(null);
    clearStatus();
    $('td-hint').hidden = true;
    $('td-save').disabled = false;
  }

  // --- wiring --------------------------------------------------------------
  buildMoons();
  $('td-save').addEventListener('click', saveEntry);
  $('td-note').addEventListener('blur', saveNote);
  $('td-note').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveNote(); }
  });
  for (const id of ['td-text', 'td-note']) $(id).addEventListener('input', () => { $('td-status').hidden = true; });
  $('td-note').addEventListener('input', updateHint);
  $('td-text').addEventListener('input', () => { updateCount(); autoGrow(); scheduleDraft(); });
  // Closing or reloading the page: save a waiting draft straight away.
  globalThis.addEventListener?.('pagehide', flushDraft);
  doc.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'hidden') flushDraft(); });
  globalThis.addEventListener?.('resize', remeasure);
  doc.fonts?.ready?.then(remeasure);
  return {
    async show(door) {
      who = door === 'his' ? 'his' : 'hers';
      await flushDraft(); // a draft still waiting from before is saved, then restored below
      resetView();
      const t = token;
      day = dayKey(now());
      $('td-date').textContent = formatDateHeading(now());
      rail.show(who, data);
      showScreen('today', who);
      $('td-date').focus();
      try {
        const draft = await data.getDraft();
        if (t === token && typeof draft === 'string' && !$('td-text').value) {
          $('td-text').value = draft;
          updateCount();
          autoGrow();
        }
      } catch (e) { /* no draft to restore is fine */ }
      try {
        const moods = await data.getMoods();
        if (t !== token) return;
        const today = moods[day];
        if (today && Number.isInteger(today.score)) {
          score = today.score;
          savedNote = today.note || '';
          $('td-note').value = savedNote;
          showMood(score);
        }
        updateHint();
        await loadEntries(t);
      } catch (err) {
        if (t === token) setError(messageOf(err, 'Could not open your journal.'));
      }
    },
    // Called by the app before it moves to another screen: save a waiting draft.
    leave: flushDraft,
    // Wipe everything typed or shown (sign-out on a shared device).
    clear: resetView,
  };
}
