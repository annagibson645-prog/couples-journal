// Pure helpers for sending part of a journal entry to the other person. The words are
// COPIED into Notes; the entry itself never changes. No storage, no network.
import { NOTE_MAX } from './notes.js';

// What the dialog starts with: the person's selection when it is real text from this entry,
// otherwise the whole entry.
export function initialSendText(entryText, selectedText) {
  const entry = typeof entryText === 'string' ? entryText : '';
  const picked = typeof selectedText === 'string' ? selectedText.trim() : '';
  return picked && entry.includes(picked) ? picked : entry;
}

// UTF-16 length, exactly like the Notes composer. Only text that fits the note limit can go.
export function sendState(text, limit = NOTE_MAX) {
  const t = typeof text === 'string' ? text : '';
  const count = t.length;
  const over = count > limit;
  const empty = !t.trim();
  return { count, over, empty, canSend: !over && !empty };
}

export function sendLabel(door) {
  return door === 'his' ? 'Send to her' : 'Send to him';
}

// The little label on a note in Notes. `authorDoor` is the AUTHOR of the note, not the viewer.
export function sourceLabel(authorDoor) {
  if (authorDoor === 'hers') return 'From her journal';
  if (authorDoor === 'his') return 'From his journal';
  return '';
}

export function formatCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// The text the person has selected inside `node` (an entry's text). `scope` is the whole entry
// (date line, text, buttons). A selection that runs a little past the text but stays inside the same
// entry is clipped to the text; one that is outside the text, or reaches another entry, gives ''.
// Never throws: no selection support just means ''.
export function selectedTextIn(doc, node, scope = node) {
  try {
    const sel = doc && typeof doc.getSelection === 'function' ? doc.getSelection() : null;
    if (!sel || !sel.rangeCount || sel.isCollapsed) return '';
    const range = sel.getRangeAt(0);
    const a = range.startContainer;
    const b = range.endContainer;
    if (!scope.contains(a) || !scope.contains(b)) return '';
    if (node.contains(a) && node.contains(b)) return String(sel);
    if (!range.intersectsNode(node)) return '';
    const r = range.cloneRange();
    if (!node.contains(a)) r.setStart(node, 0);
    if (!node.contains(b)) r.setEnd(node, node.childNodes.length);
    return String(r);
  } catch (e) {
    return '';
  }
}
