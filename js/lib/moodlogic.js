// Mood series and month calendar. Pure: no DOM, no storage.
import { dayKey } from './days.js';

export function isValidScore(n) {
  return Number.isInteger(n) && n >= 1 && n <= 10;
}

// Accepts [{day, score}] or a map { 'YYYY-MM-DD': score | {score} }.
// Returns Map<day, score> holding valid scores only.
function scoreMap(moods) {
  const out = new Map();
  const entries = Array.isArray(moods)
    ? moods.map((m) => [m && m.day, m && m.score])
    : Object.entries(moods || {}).map(([day, v]) => [day, v !== null && typeof v === 'object' ? v.score : v]);
  for (const [day, score] of entries) {
    if (typeof day === 'string' && isValidScore(score)) out.set(day, score);
  }
  return out;
}

// 'YYYY-MM-DD' -> local Date at midnight (day arithmetic via setDate is DST-safe).
function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// One point per day from `from` to `to` inclusive; score is null where no mood.
export function moodSeries(moods, from, to) {
  const scores = scoreMap(moods);
  const series = [];
  const end = parseDay(to);
  for (let d = parseDay(from); d <= end; d.setDate(d.getDate() + 1)) {
    const day = dayKey(d);
    series.push({ day, score: scores.has(day) ? scores.get(day) : null });
  }
  return series;
}

// Weeks of 7 cells, Monday first. `month` is 1-12. Padding cells have day: null.
export function buildCalendar(year, month, moods) {
  const scores = scoreMap(moods);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon = 0
  const cells = Array.from({ length: lead }, () => ({ day: null, score: null }));
  for (let d = 1; d <= daysInMonth; d++) {
    const day = dayKey(new Date(year, month - 1, d));
    cells.push({ day, score: scores.has(day) ? scores.get(day) : null });
  }
  while (cells.length % 7) cells.push({ day: null, score: null });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
