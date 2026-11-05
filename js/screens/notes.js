// Notes screen: little letters between the two of them. A composer and a feed,
// oldest at the top and newest at the bottom, like a conversation. The signed-in
// person's own notes sit on the right (with Delete); the other person's on the left.
// Every piece of user text goes in with textContent.
import { NOTE_MAX, formatNoteTime, countLabel, checkNote, isOwn, authorOf, oldestFirst } from '../lib/notes.js';
import { makeEl, messageOf } from './shared.js';

const LABEL = { hers: 'Hers', his: 'His' };
const EMPTY_FEED = 'No notes yet. Leave the first one.';
const EMPTY_TEXT = 'Write a few words first, then leave the note.';
const TOO_LONG = 'A note can be up to 2,000 characters. Please make this one a little shorter.';
const NEAR_BOTTOM = 40; // px from the end that still counts as "at the newest"

// deps: { data, showScreen, rail?, document?, now?, demo?, beforeSwitch? }
// `demo` (sample mode) adds the viewer switch: one button that signs in as the other person.
// `beforeSwitch` is awaited first so the app can save and wipe what the person leaving typed.
// `rail` is the shared left rail (js/screens/rail.js). Navigation lives in the rail
// and the router; the router calls leave() on the way out and clear() on sign-out.
export function createNotes({ data, showScreen, rail = { show() {} }, document: doc = globalThis.document, now = () => new Date(), demo = false, beforeSwitch = async () => {} }) {
  const el = makeEl(doc);
  const $ = (id) => doc.getElementById(id);
  let viewer = 'hers';
  let names = { hers: LABEL.hers, his: LABEL.his };
  let token = 0;            // bumps on show/leave/clear so late replies are ignored
  let unsubscribe = null;
  let list = [];            // notes, oldest first
  let known = null;         // ids already drawn; null until the first delivery
  let confirming = null;    // id of the note showing "Delete this note?"
  let buttons = new Map();  // `${id}:${kind}` -> the button, to place focus after a redraw

  // --- status --------------------------------------------------------------
  function setError(msg) {
    const e = $('nt-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }
  function announce(msg) { $('nt-live').textContent = msg || ''; }

  function updateCount() {
    const label = countLabel($('nt-text').value);
    $('nt-count').textContent = label;
    $('nt-count').hidden = !label;
  }

  // --- scrolling -----------------------------------------------------------
  function atBottom() {
    const f = $('nt-feed');
    if (typeof f.scrollHeight !== 'number' || typeof f.scrollTop !== 'number') return true;
    return f.scrollHeight - f.scrollTop - (f.clientHeight || 0) <= NEAR_BOTTOM;
  }
  function scrollToNewest() {
    const f = $('nt-feed');
    if (typeof f.scrollHeight === 'number') f.scrollTop = f.scrollHeight;
    $('nt-new').hidden = true;
  }

  // --- drawing the feed ----------------------------------------------------
  // A redraw throws away the button that had focus, so remember which one it was.
  function focusedKey() {
    const a = doc.activeElement;
    return a && a.dataset && a.dataset.noteId ? `${a.dataset.noteId}:${a.dataset.kind}` : null;
  }

  // `focusKey` ('id:kind') names the freshly drawn button to focus; by default the
  // one that already had focus keeps it. The reader's scroll position is kept.
  function render(focusKey = focusedKey()) {
    const feed = $('nt-feed');
    const top = feed.scrollTop;
    const ul = $('nt-list');
    ul.replaceChildren();
    buttons = new Map();
    if (confirming && !list.some((n) => n.id === confirming)) confirming = null;
    $('nt-empty').hidden = list.length > 0;
    const nowMs = now().getTime();
    for (const n of list) {
      const own = isOwn(n, viewer);
      const by = authorOf(n);
      const when = formatNoteTime(n.createdAt, nowMs);
      const li = el('li', `nt-note ${own ? 'nt-own' : 'nt-other'}${by ? ` nt-by-${by}` : ''}`);
      const meta = el('div', 'nt-meta');
      const dot = el('span', 'nt-dot');
      dot.setAttribute('aria-hidden', 'true');
      meta.append(dot, el('span', 'nt-who', by ? names[by] : ''), el('span', 'nt-when', when));
      if (own) {
        if (confirming === n.id) {
          meta.appendChild(el('span', 'nt-confirm-q', 'Delete this note?'));
          const yes = action(n.id, 'yes', 'Yes, delete', 'td-link td-danger', () => removeNote(n.id, yes));
          const keep = action(n.id, 'keep', 'Keep it', 'td-link', () => { confirming = null; render(`${n.id}:delete`); });
          meta.append(yes, keep);
        } else {
          const del = action(n.id, 'delete', 'Delete', 'td-link', () => { confirming = n.id; render(`${n.id}:yes`); });
          del.setAttribute('aria-label', `Delete your note from ${when}`);
          meta.appendChild(del);
        }
      }
      li.append(meta, el('p', 'nt-text', n.text));
      ul.appendChild(li);
    }
    if (typeof top === 'number') feed.scrollTop = top;
    const target = focusKey && buttons.get(focusKey);
    if (target) target.focus();
  }

  function action(id, kind, label, cls, onClick) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.dataset.noteId = id;
    b.dataset.kind = kind;
    b.addEventListener('click', onClick);
    buttons.set(`${id}:${kind}`, b);
    return b;
  }

  // A delivery from the adapter (first load, a note from the other person, a delete).
  function onNotes(raw) {
    const wasAtBottom = atBottom();
    const next = oldestFirst(Array.isArray(raw) ? raw : []);
    const fresh = known === null ? [] : next.filter((n) => !known.has(n.id));
    const first = known === null;
    known = new Set(next.map((n) => n.id));
    list = next;
    render();
    if (first || wasAtBottom && fresh.length || fresh.some((n) => isOwn(n, viewer))) scrollToNewest();
    else if (fresh.length) $('nt-new').hidden = false;
  }

  // --- actions -------------------------------------------------------------
  let sending = false;      // a note is on its way: ignore a second press
  async function send() {
    if (sending) return;
    const box = $('nt-text');
    const raw = box.value;
    setError('');
    announce('');
    const check = checkNote(raw);
    if (!check.ok) {
      setError(check.reason === 'long' ? TOO_LONG : EMPTY_TEXT);
      box.focus();
      return;
    }
    const tk = token;
    const btn = $('nt-send');
    btn.disabled = true;
    sending = true;
    try {
      await data.addNote(raw.trim());
      if (tk !== token) return;
      box.value = '';
      updateCount();
      scrollToNewest();
      announce('Note left');
    } catch (err) {
      // The words stay in the box so nothing typed is lost.
      if (tk === token) setError(messageOf(err, 'Could not leave your note. Please try again.'));
    }
    sending = false;
    if (tk === token) {
      btn.disabled = false;
      box.focus();
    }
  }

  async function removeNote(id, btn) {
    const tk = token;
    // The neighbouring note of mine that takes this one's place for focus.
    const mine = list.filter((n) => isOwn(n, viewer));
    const at = mine.findIndex((n) => n.id === id);
    const neighbour = mine[at + 1] || mine[at - 1] || null;
    btn.disabled = true;
    setError('');
    announce('');
    try {
      await data.deleteNote(id);
      if (tk !== token) return;
      confirming = null;
      announce('Note deleted');
      const del = neighbour && buttons.get(`${neighbour.id}:delete`);
      if (del) del.focus(); else $('nt-text').focus();
    } catch (err) {
      if (tk !== token) return;
      btn.disabled = false;
      btn.focus();
      setError(messageOf(err, 'Could not delete that note.'));
    }
  }

  // Stop listening and ignore anything still on its way.
  function teardown() {
    token += 1;
    sending = false;
    const stop = unsubscribe;
    unsubscribe = null;
    if (stop) { try { stop(); } catch (e) { /* already stopped */ } }
  }

  function resetView() {
    list = [];
    known = null;
    confirming = null;
    buttons = new Map();
    names = { hers: LABEL.hers, his: LABEL.his };
    $('nt-list').replaceChildren();
    $('nt-empty').hidden = true;
    $('nt-text').value = '';
    updateCount();
    $('nt-send').disabled = false;
    $('nt-new').hidden = true;
    setError('');
    announce('');
  }

  // --- wiring --------------------------------------------------------------
  $('nt-text').setAttribute('maxlength', String(NOTE_MAX));
  $('nt-empty').textContent = EMPTY_FEED;
  $('nt-new').textContent = 'New note';
  $('nt-send').addEventListener('click', send);
  $('nt-text').addEventListener('input', () => { updateCount(); setError(''); });
  $('nt-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!e.repeat) send(); }
  });
  $('nt-new').addEventListener('click', scrollToNewest);
  $('nt-feed').addEventListener('scroll', () => { if (atBottom()) $('nt-new').hidden = true; });

  // --- viewer switch (sample mode) -----------------------------------------
  function updateSwitch() {
    const sw = $('nt-switch');
    if (!sw) return;
    sw.hidden = !demo;
    const other = viewer === 'his' ? 'hers' : 'his';
    sw.textContent = `Seen from ${LABEL[viewer]}. Switch to ${LABEL[other]}`;
  }

  // Listen for notes as the current viewer, then look up the names.
  async function subscribe(tk) {
    try {
      const stop = data.listenNotes((notes) => { if (tk === token) onNotes(notes); });
      if (tk === token) unsubscribe = stop; else stop();
    } catch (err) {
      setError(messageOf(err, 'Could not open the notes.'));
      return;
    }
    try {
      const members = await data.getMembers();
      if (tk !== token) return;
      for (const k of ['hers', 'his']) {
        const n = members && members.names && members.names[k];
        if (typeof n === 'string' && n) names[k] = n;
      }
      render();
    } catch (e) { /* the plain labels stand */ }
  }

  let switching = false;
  async function switchViewer() {
    if (!demo) return;
    if (switching) return;
    switching = true;
    const tk = token;
    const next = viewer === 'his' ? 'hers' : 'his';
    try {
      setError('');
      await beforeSwitch(); // the person leaving: draft saved, typed text wiped
      if (tk !== token) return;
      await data.signIn(next); // never signOut: that would wipe the sample data
      if (tk !== token) return;
      teardown(); // one listener at a time
      resetView(); // typed text never crosses over
      viewer = next;
      updateSwitch();
      const mine = token;
      const done = subscribe(mine);
      announce(`Now seen from ${LABEL[next]}`);
      $('nt-switch').focus();
      await done;
    } catch (err) {
      if (tk === token) setError(messageOf(err, 'Could not switch. Please try again.'));
    } finally {
      switching = false;
    }
  }
  if ($('nt-switch')) { $('nt-switch').type = 'button'; $('nt-switch').addEventListener('click', switchViewer); }

  return {
    async show(door) {
      viewer = door === 'his' ? 'his' : 'hers';
      teardown();
      resetView();
      switching = false;
      const tk = token;
      rail.show('notes', data);
      updateSwitch();
      showScreen('notes', 'notes');
      $('nt-title').focus();
      await subscribe(tk);
    },
    // The app calls this before moving to another screen.
    leave: teardown,
    // Sign-out on a shared device: stop listening and wipe everything shown or typed.
    clear() {
      teardown();
      resetView();
    },
  };
}
