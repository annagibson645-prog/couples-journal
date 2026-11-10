// The "Send to him / Send to her" dialog. It COPIES chosen words from a journal entry into the
// shared Notes; the entry itself is never touched. One dialog serves Today and Look back.
//
// A modal dialog: labelled by its title, focus moves into the textarea, Tab stays inside, Escape and
// Cancel close it and give focus back to the button that opened it, and the rest of the page is inert
// while it is open (the `inert` attribute where supported, aria-hidden plus the focus trap elsewhere).
// On phones it is a bottom sheet (see css/journal.css). The words live only in the textarea: nothing
// is saved as a draft, and clear() wipes them (sign-out, leaving a screen, switching viewer).
// Every piece of text goes in with textContent / value, never as markup.
import { NOTE_MAX } from '../lib/notes.js';
import { sendState, sendLabel, initialSendText, formatCount } from '../lib/send.js';
import { makeEl, messageOf } from './shared.js';

const OVER = `That is over ${formatCount(NOTE_MAX)} characters. Delete some words to send it.`;
const EMPTY = 'There is nothing to send yet. Add some words first.';
const FAILED = 'Could not send that. Please try again.';
const TAKE_BACK = 'You can take it back later from Notes.';

// deps: { data, doc?, getViewerDoor(), onSent?(id) }
// open(entryText, triggerEl, selectedText?)  close()  clear()
export function createSendSheet({ data, document: docDep, doc: docAlt, getViewerDoor, onSent }) {
  const doc = docAlt || docDep || globalThis.document;
  const el = makeEl(doc);
  let isOpen = false;
  let sending = false;
  let gen = 0;            // bumps on open/clear so a late reply from an old session is ignored
  let trigger = null;     // the button that opened the dialog; gets focus back
  let saved = [];         // [{ el, hidden, hadInert }] page regions made inert while open

  // --- the elements --------------------------------------------------------
  const root = el('div', 'sd-root');
  root.id = 'send-sheet';
  const live = el('p', 'sd-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const scrim = el('div', 'sd-scrim');
  scrim.hidden = true;
  const dialog = el('div', 'sd-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const title = el('h2', 'sd-title');
  title.id = 'sd-title';
  const intro = el('p', 'sd-intro');
  intro.id = 'sd-intro';
  dialog.setAttribute('aria-labelledby', 'sd-title');
  dialog.setAttribute('aria-describedby', 'sd-intro');
  const label = el('label', 'sd-label', 'What will be sent');
  label.htmlFor = 'sd-area';
  label.setAttribute('for', 'sd-area');
  const area = el('textarea', 'sd-area');
  area.id = 'sd-area';
  area.setAttribute('spellcheck', 'true');
  area.setAttribute('autocomplete', 'off');
  area.setAttribute('aria-describedby', 'sd-count sd-limit');
  const meta = el('div', 'sd-meta');
  const count = el('span', 'sd-count');
  count.id = 'sd-count';
  meta.append(count, el('span', 'sd-takeback', TAKE_BACK));
  const limit = el('p', 'sd-limit');
  limit.id = 'sd-limit';
  limit.setAttribute('role', 'status'); // changes only when the state changes, not on every key
  const err = el('p', 'sd-error');
  err.setAttribute('role', 'alert');
  err.hidden = true;
  const buttons = el('div', 'sd-buttons');
  const cancel = el('button', 'sd-cancel', 'Cancel');
  cancel.type = 'button';
  const send = el('button', 'si-go sd-send', 'Send to Notes');
  send.type = 'button';
  buttons.append(cancel, send);
  dialog.append(title, intro, label, area, meta, limit, err, buttons);
  scrim.appendChild(dialog);
  root.append(live, scrim);
  doc.body.appendChild(root);

  // --- state shown ---------------------------------------------------------
  function showError(msg) {
    err.textContent = msg || '';
    err.hidden = !msg;
  }

  // Counter, the reason Send is off (if it is), and the button itself. Never touches the
  // textarea's value, so the person's cursor stays where it is.
  function refresh() {
    const st = sendState(area.value);
    count.textContent = `${formatCount(st.count)} of ${formatCount(NOTE_MAX)} characters`;
    limit.textContent = st.over ? OVER : st.empty ? EMPTY : '';
    send.disabled = sending || !st.canSend;
  }

  // --- the rest of the page ------------------------------------------------
  function lockPage() {
    saved = [];
    for (const node of Array.from(doc.body.children || [])) {
      if (node === root) continue;
      saved.push({ node, hidden: node.getAttribute('aria-hidden'), inert: node.getAttribute('inert') });
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }
    doc.documentElement?.classList?.add('sd-lock');
  }
  function unlockPage() {
    for (const s of saved) {
      if (s.inert === null) s.node.removeAttribute('inert'); else s.node.setAttribute('inert', s.inert);
      if (s.hidden === null) s.node.removeAttribute('aria-hidden'); else s.node.setAttribute('aria-hidden', s.hidden);
    }
    saved = [];
    doc.documentElement?.classList?.remove('sd-lock');
  }

  // On phones the on-screen keyboard can cover a bottom sheet; follow the visible part of the screen.
  const win = doc.defaultView;
  const vv = win && win.visualViewport;
  const vp = vv || win; // what tells us the visible size changed
  function fit() {
    const h = vv ? vv.height : (win && win.innerHeight) || 0;
    if (!h) return;
    if (vv) {
      scrim.style.top = `${vv.offsetTop}px`;
      scrim.style.bottom = 'auto';
      scrim.style.height = `${vv.height}px`;
    }
    // The visible height sizes the textarea in CSS (short screens, keyboard up, landscape).
    if (scrim.style.setProperty) scrim.style.setProperty('--sd-vh', `${h}px`);
  }
  function unfit() {
    scrim.style.top = '';
    scrim.style.bottom = '';
    scrim.style.height = '';
    if (scrim.style.removeProperty) scrim.style.removeProperty('--sd-vh');
  }
  // Focus somehow outside (an older browser without `inert`): bring it back in.
  function onFocusIn(e) {
    if (isOpen && e && e.target && dialog.contains && !dialog.contains(e.target)) area.focus();
  }

  // --- open and close ------------------------------------------------------
  function hide(giveBack) {
    isOpen = false;
    scrim.hidden = true;
    unlockPage();
    unfit();
    doc.removeEventListener?.('focusin', onFocusIn);
    if (vp) { vp.removeEventListener('resize', fit); if (vv) vv.removeEventListener('scroll', fit); }
    const back = trigger;
    trigger = null;
    if (!giveBack) return;
    if (back && back.isConnected !== false) { back.focus(); return; }
    // The entry list redrew and the opener is gone: land on the screen's heading, not on <body>.
    const heading = doc.querySelector ? doc.querySelector('main:not([hidden]) h1') : null;
    if (heading) heading.focus();
  }

  function open(entryText, triggerEl, selectedText) {
    if (isOpen) hide(false);
    gen += 1;
    sending = false;
    trigger = triggerEl || null;
    const door = getViewerDoor();
    const who = door === 'his' ? 'her' : 'him';
    title.textContent = sendLabel(door);
    intro.textContent = `Keep only the words you want ${who} to read, then send. They appear in Notes, where only the two of you can see them. Your journal stays private, and the original entry doesn't change.`;
    live.textContent = '';
    showError('');
    area.value = initialSendText(entryText, selectedText);
    refresh();
    lockPage();
    scrim.hidden = false;
    isOpen = true;
    doc.addEventListener?.('focusin', onFocusIn);
    if (vp) { vp.addEventListener('resize', fit); if (vv) vv.addEventListener('scroll', fit); }
    fit();
    area.focus();
    // Start reading from the top, even for a very long entry.
    if (typeof area.setSelectionRange === 'function') { try { area.setSelectionRange(0, 0); } catch (e) { /* not supported here */ } }
    area.scrollTop = 0;
  }

  function close() {
    if (!isOpen) return;
    hide(true);
    area.value = ''; // cancelled words do not linger in the hidden page
    refresh();
  }

  // Wipe the words (sign-out, leaving a screen, switching viewer). Focus is not moved: the screen is going away.
  function clear() {
    gen += 1;
    sending = false;
    area.value = '';
    showError('');
    limit.textContent = '';
    live.textContent = '';
    if (isOpen) hide(false);
    refresh();
  }

  // --- sending -------------------------------------------------------------
  async function doSend() {
    if (!isOpen || sending) return;
    if (!sendState(area.value).canSend) { refresh(); area.focus(); return; }
    const mine = gen;
    const door = getViewerDoor();
    sending = true;
    send.disabled = true;
    showError('');
    let id;
    try {
      id = await data.addNote(area.value.trim(), { source: 'entry' });
    } catch (e) {
      if (mine !== gen) return;
      sending = false;
      refresh();
      showError(messageOf(e, FAILED)); // the words stay as they are
      send.focus();
      return;
    }
    if (mine !== gen) return;
    sending = false;
    hide(true);
    area.value = '';
    refresh();
    live.textContent = `Sent to ${door === 'his' ? 'her' : 'him'}. It's in Notes.`;
    if (onSent) onSent(id);
  }

  // --- wiring --------------------------------------------------------------
  const focusables = () => [area, cancel, send].filter((b) => !b.disabled);
  area.addEventListener('input', () => { showError(''); refresh(); });
  send.addEventListener('click', doSend);
  cancel.addEventListener('click', () => { if (!sending) close(); });
  root.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!sending) close();
    } else if (e.key === 'Tab') {
      const f = focusables();
      const i = f.indexOf(doc.activeElement);
      if (!f.length) { e.preventDefault(); return; }
      if (e.shiftKey) {
        if (i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      } else if (i === -1 || i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!e.repeat) doSend();
    }
  });
  // A click on the dim area outside the dialog does nothing: a stray tap must not throw words away.

  return { open, close, clear };
}
