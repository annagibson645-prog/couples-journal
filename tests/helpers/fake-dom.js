// The smallest DOM stand-in the Today screen needs: elements by id, children,
// textContent, hidden/disabled/value, listeners, click and focus. No dependency.
export class El {
  constructor(doc, tag) {
    this.doc = doc; this.tag = tag; this.className = ''; this.children = []; this.listeners = {};
    this.attrs = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    this.type = ''; this.style = {}; this.parent = null; this.root = false;
  }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...n) { for (const c of n) this.appendChild(c); }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  replaceChildren(...n) { for (const c of this.children) c.parent = null; this.children = []; this._text = ''; for (const c of n) this.appendChild(c); }
  get isConnected() { for (let e = this; e; e = e.parent) if (e.root) return true; return false; }
  cloneNode() { return new El(this.doc, this.tag); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  dispatch(t, ev = {}) { for (const f of this.listeners[t] || []) f({ preventDefault() {}, ...ev }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  // Like a browser: a detached element cannot take focus.
  focus() { if (this.isConnected) this.doc.activeElement = this; }
  find(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.find(pred, out); } return out; }
  byClass(cls) { return this.find((c) => c.className.split(' ').includes(cls)); }
}

const IDS = ['td-sigil', 'td-name', 'td-date', 'td-moons', 'td-word', 'td-note', 'td-text', 'td-save', 'td-status',
  'td-error', 'td-hint', 'td-count', 'td-list', 'td-empty', 'td-entries-title'];

export function makeDom() {
  const doc = { activeElement: null, byId: {}, nav: [] };
  doc.createElement = (t) => new El(doc, t);
  doc.createElementNS = (_ns, t) => new El(doc, t);
  doc.getElementById = (id) => doc.byId[id] || null;
  doc.querySelector = () => null;
  doc.querySelectorAll = () => doc.nav;
  for (const id of IDS) { doc.byId[id] = new El(doc, 'x'); doc.byId[id].root = true; }
  for (const n of ['today', 'lookback', 'save', 'signout']) {
    const b = new El(doc, 'button'); b.dataset.nav = n; doc.nav.push(b);
  }
  return doc;
}
