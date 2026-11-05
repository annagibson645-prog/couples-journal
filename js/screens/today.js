// Today screen: mood moons, optional few words, the writing box and the list of
// this person's entries. Every piece of user text goes in with textContent.
import { moonPath } from '../lib/sigil.js';
import { dayKey } from '../lib/days.js';
import { moodWord, moodLabel, moonFraction, formatDateHeading, entryWhen } from '../lib/today.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LABEL = { hers: 'Hers', his: 'His' };
const NOTHING_TO_SAVE = 'There is nothing to save yet. Write a few words first, then save.';
const SAVED = 'Saved on this device, then synced';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A friendly adapter message if there is one; otherwise a plain fallback.
function messageOf(err, fallback) {
  return err instanceof Error && err.message ? err.message : fallback;
}

// deps: { data, showScreen, onNavigate(name), onSignOut() }
export function createToday({ data, showScreen, onNavigate, onSignOut }) {
  const $ = (id) => document.getElementById(id);
  let who = 'hers';
  let score = null;          // the mood last saved (or loaded) for today
  let savedNote = '';        // the few words last saved (or loaded) for today
  let day = dayKey(new Date());
  let token = 0;             // bumps on show/clear so late replies are ignored
  let confirming = null;     // id of the entry showing "Delete this entry?"
  let entries = [];

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
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 38 38');
      svg.setAttribute('aria-hidden', 'true');
      const ring = document.createElementNS(SVG_NS, 'circle');
      for (const [k, v] of [['cx', 19], ['cy', 19], ['r', 17], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-opacity', '.55']]) ring.setAttribute(k, v);
      const lit = document.createElementNS(SVG_NS, 'path');
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
    const t = token;
    const previous = score;
    clearStatus();
    showMood(n);
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
      setError(messageOf(err, 'Could not save your mood.'));
    }
  }

  // The few words save as the mood's note. They need a mood to belong to, so
  // until a moon is chosen the words simply wait in the field.
  async function saveNote() {
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
  function renderEntries() {
    const list = $('td-list');
    list.replaceChildren();
    $('td-empty').hidden = entries.length > 0;
    const today = dayKey(new Date());
    for (const entry of entries) {
      const li = el('li', 'td-entry');
      li.appendChild(el('p', 'td-when', entryWhen(entry, today)));
      li.appendChild(el('p', 'td-text', entry.text));
      const actions = el('div', 'td-entry-actions');
      if (confirming === entry.id) {
        actions.appendChild(el('span', 'td-confirm-q', 'Delete this entry?'));
        const yes = el('button', 'td-link td-danger', 'Yes, delete');
        yes.type = 'button';
        yes.addEventListener('click', () => removeEntry(entry.id, yes));
        const keep = el('button', 'td-link', 'Keep it');
        keep.type = 'button';
        keep.addEventListener('click', () => { confirming = null; renderEntries(); });
        actions.append(yes, keep);
      } else {
        const del = el('button', 'td-link', 'Delete');
        del.type = 'button';
        del.setAttribute('aria-label', `Delete the entry from ${entryWhen(entry, today)}`);
        del.addEventListener('click', () => { confirming = entry.id; renderEntries(); });
        actions.appendChild(del);
      }
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  async function loadEntries(t) {
    const list = await data.listEntries();
    if (t !== token) return false;
    entries = list;
    renderEntries();
    return true;
  }

  async function removeEntry(id, btn) {
    const t = token;
    btn.disabled = true;
    clearStatus();
    try {
      await data.deleteEntry(id);
      if (t !== token) return;
      confirming = null;
      await loadEntries(t);
    } catch (err) {
      if (t !== token) return;
      btn.disabled = false;
      setError(messageOf(err, 'Could not delete that entry.'));
    }
  }

  async function saveEntry() {
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
    try {
      await data.addEntry(text);
      if (t !== token) return;
      box.value = '';
      await loadEntries(t);
      if (t === token) setSaved();
    } catch (err) {
      // The words stay in the box so nothing typed is lost.
      if (t === token) setError(messageOf(err, 'Could not save your entry.'));
    } finally {
      btn.disabled = false;
    }
  }

  // --- rail ----------------------------------------------------------------
  function setSigil() {
    const src = document.querySelector(`.col-${who} .sigil`);
    const host = $('td-sigil');
    host.replaceChildren();
    if (src) host.appendChild(src.cloneNode(true));
  }

  async function setName() {
    const t = token;
    $('td-name').textContent = LABEL[who];
    try {
      const members = await data.getMembers();
      const name = members && members.names && members.names[who];
      if (t === token && typeof name === 'string' && name) $('td-name').textContent = name;
    } catch (e) { /* the default label stands */ }
  }

  function resetView() {
    token += 1;
    score = null;
    savedNote = '';
    confirming = null;
    entries = [];
    $('td-text').value = '';
    $('td-note').value = '';
    $('td-list').replaceChildren();
    $('td-empty').hidden = true;
    showMood(null);
    clearStatus();
  }

  // --- wiring --------------------------------------------------------------
  buildMoons();
  $('td-save').addEventListener('click', saveEntry);
  $('td-note').addEventListener('blur', saveNote);
  $('td-note').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveNote(); }
  });
  for (const id of ['td-text', 'td-note']) $(id).addEventListener('input', () => { $('td-status').hidden = true; });
  for (const a of document.querySelectorAll('#td-nav a[data-nav]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const to = a.dataset.nav;
      if (to === 'signout') onSignOut();
      else if (to !== 'today') onNavigate(to);
    });
  }

  return {
    async show(door) {
      who = door === 'his' ? 'his' : 'hers';
      resetView();
      const t = token;
      day = dayKey(new Date());
      $('td-date').textContent = formatDateHeading(new Date());
      setSigil();
      showScreen('today', who);
      $('td-date').focus();
      setName();
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
        await loadEntries(t);
      } catch (err) {
        if (t === token) setError(messageOf(err, 'Could not open your journal.'));
      }
    },
    // Wipe everything typed or shown (sign-out on a shared device).
    clear: resetView,
  };
}
