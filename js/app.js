import { MODE } from './config.js';
import { tickPath, dotPath } from './lib/sigil.js';
import { data } from './data/index.js';
import { createDoors } from './open-door.js';
import { createBanner } from './screens/banner.js';
import { createSignIn } from './screens/signin.js';
import { createToday } from './screens/today.js';
import { createLookback } from './screens/lookback.js';
import { createExport } from './screens/export.js';
import { createNotes } from './screens/notes.js';
import { createRail } from './screens/rail.js';
import { createSendSheet } from './screens/send-sheet.js';
import { createRouter } from './router.js';
import { guarded } from './lib/fatal.js';

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

// A message screen: the private-journal notice. `signOut` shows the sign-out button.
function showGate(title, text, who, signOut) {
  document.getElementById('gate-title').textContent = title;
  document.getElementById('gate-text').textContent = text;
  document.getElementById('gate-signout').hidden = !signOut;
  showScreen('gate', who);
}

function init() {
  fillSigils();
  applyTheme(readTheme(), false);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  });
  const demo = MODE === 'demo';
  // One rail component, one instance per journal screen; sections share one router.
  const railFor = (current) => createRail({ host: document.querySelector(`[data-rail="${current}"]`), current, demo, onNavigate: (k) => router.navigate(k) });
  const rails = [railFor('today'), railFor('lookback'), railFor('save'), railFor('notes')];
  // One send dialog for Today and Look back. Its text is wiped wherever the screens wipe theirs.
  const sheet = createSendSheet({ data, doc: document, getViewerDoor: () => { const s = data.currentSession(); return s && s.door; } });
  const today = createToday({ data, showScreen, rail: rails[0], sheet });
  const lookback = createLookback({ data, showScreen, rail: rails[1], sheet, onNavigate: (k) => router.navigate(k) });
  const save = createExport({ data, showScreen, rail: rails[2] });
  // Switching the Notes viewer: save what the person leaving was writing, then wipe it from memory.
  const beforeSwitch = async () => {
    try { await today.leave(); } catch (e) { /* a draft must never block the switch */ }
    today.clear();
    lookback.clear();
    save.clear();
    sheet.clear();
  };
  const notes = createNotes({ data, showScreen, rail: rails[3], demo, beforeSwitch });
  const router = createRouter({ demo, data, today, lookback, save, notes, sheet, rails, showScreen, showGate });
  const signOut = router.signOut;
  let doors;
  // A door that fails to open shows a visible message with Reload instead of doing nothing.
  const open = guarded((door) => doors.openDoor(door));
  const signIn = createSignIn({
    data,
    demo,
    showScreen,
    onSignedIn: (who, returnTo) => open(returnTo || who),
    onBack: () => showScreen('front'),
  });
  doors = createDoors({ data, demo, today, lookback, save, notes, signIn, showGate });
  // Sample mode: Reset sample data wipes everything (the same path as a real sign-out), then shows the front page.
  const banner = createBanner({ onReset: signOut });
  banner.show(demo);
  for (const link of document.querySelectorAll('a[data-door]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      open(link.dataset.door);
    });
  }
  document.getElementById('gate-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('front');
  });
  document.getElementById('gate-signout')?.addEventListener('click', signOut);
  showScreen('front');
  // Tells the inline guard in index.html that the app is up (it hides any loading or error message).
  globalThis.__journalStarted = true;
}

if (typeof document !== 'undefined') init();
