// For the rare place that must build an HTML string. Prefer textContent for
// user text; entry and note text is always plain text.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => MAP[c]);
}
