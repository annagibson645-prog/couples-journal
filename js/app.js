import { MODE } from './config.js';
import { tickPath, dotPath } from './lib/sigil.js';
import { data } from './data/index.js';
import { gateFor } from './doors.js';
import { createSignIn } from './screens/signin.js';
import { createToday } from './screens/today.js';
import { createLookback } from './screens/lookback.js';
import { createRail } from './screens/rail.js';

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

// A message screen: the private-journal notice, and a stand-in for the screens
// later tasks build. `signOut` shows the sign-out button; `toToday` a way back to Today.
function showGate(title, text, who, signOut, toToday) {
  document.getElementById('gate-title').textContent = title;
  document.getElementById('gate-text').textContent = text;
  document.getElementById('gate-signout').hidden = !signOut;
  document.getElementById('gate-today').hidden = !toToday;
  showScreen('gate', who);
}

function openDoor(door, signIn, today) {
  const session = data.currentSession();
  const gate = gateFor(door, session);
  if (gate === 'signin') {
    // Notes has no login of its own: offer Hers, with a link to His.
    if (door === 'notes') signIn.show('hers', 'notes');
    else signIn.show(door, door);
  } else if (gate === 'private') {
    showGate('This journal is private.', 'Only its owner can open it. Your own journal and the shared Notes are still yours to open.', session.door, true);
  } else if (door === 'notes') {
    // Notes replaces this stand-in in a later task.
    showGate('Notes', 'The shared Notes arrive in the next build step.', session.door, true, true);
  } else {
    today.show(session.door);
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
  // One rail component, one instance per journal screen; sections share one router.
  const railFor = (current) => createRail({ host: document.querySelector(`[data-rail="${current}"]`), current, onNavigate: navigate });
  const rails = [railFor('today'), railFor('lookback')];
  const today = createToday({ data, showScreen, rail: rails[0] });
  const lookback = createLookback({ data, showScreen, rail: rails[1], onNavigate: navigate });
  function navigate(name) {
    today.leave(); // saves a draft that was still waiting
    if (name === 'signout') { signOut(); return; }
    const session = data.currentSession();
    if (!session) { showScreen('front'); return; }
    if (name === 'today') today.show(session.door);
    else if (name === 'lookback') lookback.show(session.door);
    else if (name === 'save') {
      // Save your journal replaces this stand-in in a later task.
      showGate('Save your journal', 'This part of the journal arrives in the next build step.', session.door, true, true);
    }
  }
  async function signOut() {
    today.clear();
    lookback.clear();
    for (const r of rails) r.clear();
    try { await data.signOut(); } finally { showScreen('front'); }
  }
  const signIn = createSignIn({
    data,
    demo: MODE === 'demo',
    showScreen,
    onSignedIn: (who, returnTo) => openDoor(returnTo || who, signIn, today),
    onBack: () => showScreen('front'),
  });
  for (const link of document.querySelectorAll('a[data-door]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openDoor(link.dataset.door, signIn, today);
    });
  }
  document.getElementById('gate-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('front');
  });
  document.getElementById('gate-signout')?.addEventListener('click', signOut);
  document.getElementById('gate-today')?.addEventListener('click', () => {
    const s = data.currentSession();
    if (s) today.show(s.door);
    else showScreen('front');
  });
  showScreen('front');
}

if (typeof document !== 'undefined') init();
