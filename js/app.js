import { MODE } from './config.js';
import { tickPath, dotPath } from './lib/sigil.js';
import { data } from './data/index.js';
import { gateFor } from './doors.js';
import { createSignIn } from './screens/signin.js';

// Duplicated in the inline pre-paint script in index.html; keep in sync.
const THEME_KEY = 'journal-theme';
const SCREENS = ['front', 'signin', 'gate', 'today', 'lookback', 'save', 'notes'];

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

// A message screen: the private-journal notice, and a stand-in for the journal
// screens that later tasks build. `signOut` shows the sign-out button.
function showGate(title, text, who, signOut) {
  document.getElementById('gate-title').textContent = title;
  document.getElementById('gate-text').textContent = text;
  document.getElementById('gate-signout').hidden = !signOut;
  showScreen('gate', who);
}

function openDoor(door, signIn) {
  const session = data.currentSession();
  const gate = gateFor(door, session);
  if (gate === 'signin') {
    // Notes has no login of its own: offer Hers, with a link to His.
    if (door === 'notes') signIn.show('hers', 'notes');
    else signIn.show(door, door);
  } else if (gate === 'private') {
    showGate('This journal is private.', 'Only its owner can open it. Your own journal and the shared Notes are still yours to open.', session.door, true);
  } else {
    // Today, Look back, Save and Notes replace this stand-in in later tasks.
    showGate(`Signed in to ${session.door === 'hers' ? 'Hers' : 'His'}`, 'The journal screens arrive in the next build step.', session.door, true);
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
  const signIn = createSignIn({
    data,
    demo: MODE === 'demo',
    showScreen,
    onSignedIn: (who, returnTo) => openDoor(returnTo || who, signIn),
    onBack: () => showScreen('front'),
  });
  for (const link of document.querySelectorAll('a[data-door]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openDoor(link.dataset.door, signIn);
    });
  }
  document.getElementById('gate-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('front');
  });
  document.getElementById('gate-signout')?.addEventListener('click', async () => {
    await data.signOut();
    showScreen('front');
  });
  showScreen('front');
}

if (typeof document !== 'undefined') init();
