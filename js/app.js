import { MODE } from './config.js';
import { tickPath, dotPath } from './lib/sigil.js';

// Duplicated in the inline pre-paint script in index.html; keep in sync.
const THEME_KEY = 'journal-theme';
const SCREENS = ['front', 'signin', 'today', 'lookback', 'save', 'notes'];

// Show one screen container (id "screen-<name>") and hide the rest.
// Screens that don't exist yet are skipped. `who` sets the accent colours.
export function showScreen(name, who) {
  for (const s of SCREENS) {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = s !== name;
  }
  if (who) document.body.dataset.who = who;
  else delete document.body.dataset.who;
}

function fillSigils() {
  for (const el of document.querySelectorAll('path[data-sigil]')) {
    const n = Number(el.dataset.n);
    const kind = el.dataset.sigil;
    el.setAttribute('d', kind === 'dots' ? dotPath(n) : tickPath(n, kind === 'tick-long'));
  }
}

function readTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch (e) { /* storage unavailable */ }
  return 'dark';
}

function applyTheme(theme, save) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }
  if (save) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  }
}

function init() {
  fillSigils();
  applyTheme(readTheme(), false);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  });
  const banner = document.getElementById('sample-banner');
  if (banner) banner.hidden = MODE !== 'demo';
  showScreen('front');
}

if (typeof document !== 'undefined') init();
