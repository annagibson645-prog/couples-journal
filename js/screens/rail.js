// The left rail every journal screen shares: the person's sigil, their name
// and the section navigation. One component, so Today, Look back and the later
// screens cannot drift apart.
import { makeEl } from './shared.js';

export const SECTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'lookback', label: 'Look back' },
  { key: 'save', label: 'Save your journal' },
  { key: 'signout', label: 'Sign out' },
];
const LABEL = { hers: 'Hers', his: 'His' };

// host: the <aside class="rail"> to fill. current: the section this screen is.
// onNavigate(key) is called for any other section, including 'signout'.
export function createRail({ host, current, onNavigate, document: doc = globalThis.document }) {
  const el = makeEl(doc);
  const inner = el('div', 'rail-in');
  const sigil = el('div', 'rail-sigil');
  const name = el('p', 'name rail-name', '');
  const nav = el('nav', 'rail-nav');
  nav.setAttribute('aria-label', 'Sections');
  inner.append(el('div', 'glow'), sigil, el('span', 'kicker', 'Journal · Private'), name, nav);
  for (const s of SECTIONS) {
    const b = el('button', '', s.label);
    b.type = 'button';
    b.dataset.nav = s.key;
    if (s.key === current) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (s.key !== current) onNavigate(s.key);
    });
    nav.appendChild(b);
  }
  host.replaceChildren(inner);

  let token = 0;
  return {
    // Show this person's sigil and name. The name is their own if the journal
    // has one; the plain label stands otherwise or while it loads.
    async show(who, data) {
      const door = who === 'his' ? 'his' : 'hers';
      const t = ++token;
      const src = doc.querySelector(`.col-${door} .sigil`);
      sigil.replaceChildren();
      if (src) sigil.appendChild(src.cloneNode(true));
      name.textContent = LABEL[door];
      try {
        const members = await data.getMembers();
        const n = members && members.names && members.names[door];
        if (t === token && typeof n === 'string' && n) name.textContent = n;
      } catch (e) { /* the default label stands */ }
    },
    // Wipe the person's name and sigil (sign-out on a shared device).
    clear() {
      token += 1;
      sigil.replaceChildren();
      name.textContent = '';
    },
  };
}
