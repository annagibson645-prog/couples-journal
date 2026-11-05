// Turns the person's moods and entries into one list of days for the export
// formats. Pure: no DOM, no storage. Entry text is never altered.
import { dayKey } from './days.js';
import { isValidScore } from './moodlogic.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

// Local HH:MM from epoch milliseconds; '' when the time is unusable.
function hhmm(ms) {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

// moods: Record<'YYYY-MM-DD', {score, note?}>; entries: Array<{day, text, createdAt}> in any order.
// Returns Array<{ day, score|null, note|null, entries: [{time, text}] }>, oldest day first,
// one item for every day that has a mood or an entry.
export function buildExportModel(moods, entries) {
  const days = new Map();
  const get = (day) => {
    if (!days.has(day)) days.set(day, { day, score: null, note: null, entries: [], at: [] });
    return days.get(day);
  };
  for (const [day, m] of Object.entries(moods || {})) {
    if (!DAY_RE.test(day) || !m || !isValidScore(m.score)) continue;
    const item = get(day);
    item.score = m.score;
    item.note = typeof m.note === 'string' && m.note.trim() ? m.note : null;
  }
  for (const e of entries || []) {
    if (!e || typeof e.text !== 'string') continue;
    const at = Number(e.createdAt);
    // An entry is never dropped for a bad day key: file it under its local date.
    const day = DAY_RE.test(e.day) ? e.day : (Number.isFinite(at) ? dayKey(new Date(at)) : null);
    if (!day) continue;
    const item = get(day);
    item.entries.push({ time: hhmm(at), text: e.text, at });
  }
  return [...days.values()]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((d) => ({
      day: d.day,
      score: d.score,
      note: d.note,
      entries: d.entries
        .map((x, i) => ({ x, i }))
        .sort((p, q) => (p.x.at - q.x.at) || (p.i - q.i))
        .map(({ x }) => ({ time: x.time, text: x.text })),
    }));
}
