// Small DOM helpers shared by the journal screens (Today, Look back, ...).
import { needsCollapse } from '../lib/today.js';
import { sendLabel, selectedTextIn } from '../lib/send.js';

export function makeEl(doc) {
  return (tag, className, text) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
}

// A friendly adapter message if there is one; otherwise a plain fallback.
export function messageOf(err, fallback) {
  return err instanceof Error && err.message ? err.message : fallback;
}

// Does the text run past the clamp? Measured when the browser can lay it out,
// guessed from the text otherwise.
function overflows(p, text) {
  if (typeof p.scrollHeight === 'number' && p.clientHeight > 0) return p.scrollHeight > p.clientHeight + 1;
  return needsCollapse(text);
}

// An entry's text that shows about 8 lines with Read more / Show less. `expanded`
// is a Set of ids the person has opened; it outlives a redraw. Text goes in with
// textContent only. Returns { p, more, remeasure } for the caller to place.
export function collapsibleText(doc, id, text, expanded) {
  const el = makeEl(doc);
  const open = expanded.has(id);
  const p = el('p', open ? 'td-text' : 'td-text td-clamp', text);
  const more = el('button', 'td-link td-more', open ? 'Show less' : 'Read more');
  more.type = 'button';
  more.hidden = !open;
  more.setAttribute('aria-expanded', String(open));
  more.addEventListener('click', () => {
    const nowOpen = !expanded.has(id);
    if (nowOpen) expanded.add(id); else expanded.delete(id);
    p.className = nowOpen ? 'td-text' : 'td-text td-clamp';
    more.textContent = nowOpen ? 'Show less' : 'Read more';
    more.setAttribute('aria-expanded', String(nowOpen));
  });
  return { p, more, remeasure() { if (!expanded.has(id)) more.hidden = !overflows(p, text); } };
}

// The "Send to him / Send to her" button under an entry. Pressing it opens the shared send dialog
// with the entry's words, or only the words the person had selected inside this entry (`entryEl` is the
// whole entry, so a selection that strays a little past the text is clipped to it). A phone can clear
// the selection as the finger lands, before the click, so it is also read when the press begins. On
// touch the order is pointerdown, pointerup, pointerout, pointerleave, mouse events, click: nothing in
// between may erase the capture. It is dropped at the next press, on cancel, and after 1.5 s.
const CAPTURE_MS = 1500;
export function entrySendButton(doc, { sheet, door, textEl, entryEl = textEl, text, when }) {
  const label = sendLabel(door);
  const b = makeEl(doc)('button', 'td-send', label);
  b.type = 'button';
  b.setAttribute('aria-label', `${label}: entry from ${when}`);
  let captured = '';
  let at = 0;
  const grab = () => { const t = selectedTextIn(doc, textEl, entryEl); if (t) { captured = t; at = Date.now(); } }; // an empty read never erases a good one
  b.addEventListener('pointerdown', () => { captured = ''; grab(); }); // a new press starts afresh
  for (const ev of ['mousedown', 'touchstart']) b.addEventListener(ev, grab);
  for (const ev of ['pointercancel', 'touchcancel']) b.addEventListener(ev, () => { captured = ''; });
  b.addEventListener('click', () => {
    const fresh = captured && Date.now() - at <= CAPTURE_MS ? captured : '';
    const picked = fresh || selectedTextIn(doc, textEl, entryEl);
    captured = '';
    sheet.open(text, b, picked);
  });
  return b;
}
