// Pure helpers for the Look back screen: calendar month moves, day labels and
// the mood tint. No DOM, no storage.
import { MONTHS, WEEKDAYS, moodWord } from './today.js';

// 'YYYY-MM-DD' -> local Date at midnight.
export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "5 November"
export function formatDayShort(key) {
  const d = parseDayKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// "Thursday, 5 November 2026"
export function formatDayLong(key) {
  const d = parseDayKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Move a (year, month 1-12) pair by whole months, across year boundaries.
export function shiftMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 };
}

// "November 2026"
export function monthTitle(year, month) {
  return `${MONTHS[month - 1]} ${year}`;
}

export function monthOfDay(key) {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}

// Calendar cell tint: how strongly the accent colour fills the day. Brighter
// mood means stronger. Up to 7 stays light enough for the normal text colour;
// from 8 the fill is strong enough for the on-accent text colour. The gap
// between the two is deliberate, so both always have readable contrast.
export function tintAlpha(score) {
  const a = score <= 7 ? 0.16 + (score - 1) * 0.07 : 0.85 + (score - 8) * 0.06;
  return Math.round(a * 100) / 100;
}

// Cells at 8 and above use the on-accent text colour.
export function isStrongTint(score) {
  return score >= 8;
}

// Screen-reader label for a calendar cell: "5 November, mostly bright".
export function cellLabel(key, score, isToday = false) {
  const base = formatDayShort(key);
  const mood = score ? moodWord(score).toLowerCase() : 'no mood';
  return `${base}, ${mood}${isToday ? ', today' : ''}`;
}

export function entriesForDay(entries, key) {
  return (entries || []).filter((e) => e.day === key);
}
