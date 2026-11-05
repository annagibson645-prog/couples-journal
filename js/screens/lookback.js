// Look back: the last 30 days as a line, a month calendar tinted by mood, and
// the chosen day's mood, words and entries (read-only). Every piece of user
// text goes in with textContent.
import { moonPath } from '../lib/sigil.js';
import { dayKey } from '../lib/days.js';
import { moodSeries, buildCalendar, isValidScore } from '../lib/moodlogic.js';
import { moodWord, moonFraction, entryWhen } from '../lib/today.js';
import { shiftMonth, monthTitle, monthOfDay, tintAlpha, isStrongTint, cellLabel, entriesForDay, entryCounts, formatDayLong } from '../lib/lookback.js';
import { renderChart } from './chart.js';
import { makeEl, messageOf, collapsibleText } from './shared.js';

const SPAN = 30; // days in the chart, ending today
const CHOOSE = 'Choose a day to see its mood and what you wrote.';
const NO_MOODS = 'No moods yet. Choose a moon on Today and it will appear here.';
const NO_MOODS_BUT_ENTRIES = 'No moods yet. Choose a moon on Today and it will appear here. Days with entries are still open in the calendar.';
const COULD_NOT_OPEN = "We couldn't open your journal just now. Please try again.";

// deps: { data, showScreen, rail?, onNavigate(name), document?, now? }
export function createLookback({ data, showScreen, rail = { show() {} }, onNavigate, document: doc = globalThis.document, now = () => new Date() }) {
  const el = makeEl(doc);
  const $ = (id) => doc.getElementById(id);
  let token = 0;       // bumps on show/clear so late replies are ignored
  let moods = {};
  let entries = [];
  let year = 0;
  let month = 0;
  let selected = null; // 'YYYY-MM-DD' or null
  let loaded = false;
  let failed = false;
  let lastWho = 'hers';
  let counts = new Map(); // day -> number of entries
  let cellByDay = new Map();
  let rows = [];       // collapsible entry texts on screen
  const expanded = new Set();

  const validMoods = () => Object.fromEntries(Object.entries(moods || {}).filter(([, m]) => m && isValidScore(m.score)));
  const today = () => dayKey(now());
  const current = () => { const d = now(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };

  function setError(msg) {
    const e = $('lb-error');
    e.textContent = msg || '';
    e.hidden = !msg;
    $('lb-retry').hidden = !msg;
  }
  // A day can be opened if it has a mood or at least one entry.
  const hasContent = (day) => !!(validMoods()[day]) || (counts.get(day) || 0) > 0;

  // --- chart ---------------------------------------------------------------
  function drawChart() {
    const end = now();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (SPAN - 1));
    const host = $('lb-chart');
    const w = host.clientWidth;
    renderChart(host, moodSeries(validMoods(), dayKey(start), dayKey(end)), { width: w > 0 ? w : 700, unavailable: failed, document: doc });
  }

  // --- calendar ------------------------------------------------------------
  function drawCalendar() {
    const mine = validMoods();
    const grid = $('lb-grid');
    grid.replaceChildren();
    cellByDay = new Map();
    const t = today();
    for (const week of buildCalendar(year, month, mine)) {
      for (const cell of week) {
        if (!cell.day) { grid.appendChild(el('span', 'cl-blank')); continue; }
        const isToday = cell.day === t;
        const has = cell.score !== null;
        const n = counts.get(cell.day) || 0;
        const open = has || n > 0;
        const b = el('button', '', String(Number(cell.day.slice(8))));
        b.type = 'button';
        b.dataset.day = cell.day;
        b.setAttribute('aria-label', cellLabel(cell.day, cell.score, isToday, n));
        if (open) {
          if (has) b.style.background = `rgba(var(--accrgb), ${tintAlpha(cell.score)})`;
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => select(cell.day));
        } else {
          b.disabled = true;
        }
        b.className = ['cl', has ? 'cl-has' : (open ? 'cl-only' : 'cl-none'), has && isStrongTint(cell.score) ? 'cl-strong' : '', isToday ? 'cl-today' : ''].filter(Boolean).join(' ');
        cellByDay.set(cell.day, b);
        grid.appendChild(b);
      }
    }
    $('lb-month').textContent = monthTitle(year, month);
    const c = current();
    // aria-disabled, not disabled: a disabled button would drop keyboard focus.
    $('lb-next').setAttribute('aria-disabled', String(year * 12 + month >= c.year * 12 + c.month));
  }

  function markSelected() {
    for (const [day, b] of cellByDay) {
      if (b.disabled) continue;
      const on = day === selected;
      b.setAttribute('aria-pressed', String(on));
      b.className = b.className.split(' ').filter((c) => c !== 'cl-sel').concat(on ? ['cl-sel'] : []).join(' ');
    }
  }

  // --- the chosen day ------------------------------------------------------
  function drawDay() {
    const raw = selected && moods[selected];
    const mood = raw && isValidScore(raw.score) ? raw : null;
    const mine = selected ? entriesForDay(entries, selected) : [];
    const ok = !!selected && (!!mood || mine.length > 0);
    $('lb-day-prompt').hidden = ok;
    $('lb-day-body').hidden = !ok;
    $('lb-day-prompt').textContent = CHOOSE;
    rows = [];
    $('lb-day-entries').replaceChildren();
    if (!ok) return;
    $('lb-day-name').textContent = formatDayLong(selected);
    // A day with entries but no mood says so, with no moon.
    $('lb-day-mood').hidden = !mood;
    $('lb-day-nomood').hidden = !!mood;
    if (mood) {
      $('lb-day-path').setAttribute('d', moonPath(moonFraction(mood.score)));
      $('lb-day-word').textContent = `${moodWord(mood.score)}.`;
    } else {
      $('lb-day-word').textContent = '';
    }
    const note = mood && typeof mood.note === 'string' ? mood.note.trim() : '';
    $('lb-day-note').textContent = note;
    $('lb-day-note').hidden = !note;
    $('lb-day-empty').hidden = mine.length > 0;
    const t = today();
    for (const entry of mine) {
      const li = el('li', 'td-entry');
      li.appendChild(el('p', 'td-when', entryWhen(entry, t)));
      const text = collapsibleText(doc, entry.id, entry.text, expanded);
      li.append(text.p, text.more);
      rows.push(text);
      $('lb-day-entries').appendChild(li);
    }
    for (const r of rows) r.remeasure();
  }

  function select(day) {
    selected = day;
    markSelected();
    drawDay();
  }

  function goToMonth(y, m) {
    year = y;
    month = m;
    selected = null;
    drawCalendar();
    drawDay();
  }

  // Today's mood if there is one, else the most recent day with a mood this month.
  function initialSelection() {
    const t = today();
    if (hasContent(t)) return t;
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const all = new Set([...Object.keys(validMoods()), ...counts.keys()]);
    const days = [...all].filter((d) => d.startsWith(prefix)).sort();
    return days.length ? days[days.length - 1] : null;
  }

  function render() {
    drawChart();
    drawCalendar();
    selected = loaded ? initialSelection() : null;
    markSelected();
    drawDay();
    const noMoods = Object.keys(validMoods()).length === 0;
    $('lb-empty').hidden = !loaded || !noMoods;
    $('lb-empty-text').textContent = counts.size ? NO_MOODS_BUT_ENTRIES : NO_MOODS;
  }

  function resetView() {
    token += 1;
    moods = {};
    entries = [];
    selected = null;
    loaded = false;
    failed = false;
    counts = new Map();
    rows = [];
    cellByDay = new Map();
    expanded.clear();
    setError('');
    $('lb-empty').hidden = true;
    $('lb-chart').replaceChildren();
    $('lb-grid').replaceChildren();
    $('lb-month').textContent = '';
    $('lb-day-prompt').hidden = false;
    $('lb-day-body').hidden = true;
    $('lb-day-name').textContent = '';
    $('lb-day-word').textContent = '';
    $('lb-day-note').textContent = '';
    $('lb-day-entries').replaceChildren();
  }

  // --- wiring --------------------------------------------------------------
  $('lb-prev').addEventListener('click', () => { const m = shiftMonth(year, month, -1); goToMonth(m.year, m.month); });
  $('lb-next').addEventListener('click', () => {
    if ($('lb-next').getAttribute('aria-disabled') === 'true') return; // nothing after this month
    const m = shiftMonth(year, month, 1); goToMonth(m.year, m.month); });
  $('lb-retry').addEventListener('click', () => api.show(lastWho));
  $('lb-empty-today').addEventListener('click', () => onNavigate('today'));
  $('lb-chart').addEventListener('daypick', (e) => {
    const day = e && e.detail && e.detail.day;
    if (!day || !hasContent(day)) return;
    const m = monthOfDay(day);
    if (m.year !== year || m.month !== month) goToMonth(m.year, m.month);
    select(day);
  });
  // Redraw the chart to the new width, and recheck which entries run long.
  globalThis.addEventListener?.('resize', () => {
    if (!loaded) return;
    drawChart();
    for (const r of rows) r.remeasure();
  });
  doc.fonts?.ready?.then(() => { for (const r of rows) r.remeasure(); });

  const api = {
    async show(door) {
      const who = door === 'his' ? 'his' : 'hers';
      lastWho = who;
      resetView();
      const t = token;
      const c = current();
      year = c.year;
      month = c.month;
      showScreen('lookback', who);
      rail.show(who, data);
      $('lb-title').focus();
      try {
        const [m, e] = await Promise.all([data.getMoods(), data.listEntries()]);
        if (t !== token) return;
        moods = m || {};
        entries = e || [];
        counts = entryCounts(entries);
        loaded = true;
        render();
      } catch (err) {
        if (t !== token) return;
        moods = {};
        entries = [];
        loaded = false;
        failed = true;
        setError(messageOf(err, COULD_NOT_OPEN));
        render();
      }
    },
    // Wipe everything shown (sign-out on a shared device).
    clear: resetView,
  };
  return api;
}
