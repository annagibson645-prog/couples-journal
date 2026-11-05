// Small DOM helpers shared by the journal screens (Today, Look back, ...).
import { needsCollapse } from '../lib/today.js';

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
