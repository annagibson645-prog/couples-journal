// Pure helpers for the Notes screen. No DOM, no storage.
export const NOTE_MAX = 2000;
const SHOW_COUNT_UNDER = 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Calendar days between two dates, counted in local days (not 24-hour blocks, so a
// clock change cannot shift a note onto the wrong day).
function daysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

// "Today, 8:40", "Yesterday, 21:02", "3 Nov, 21:02", and with the year once it is
// from an earlier year: "25 Dec 2025, 9:00". Local time, 24-hour clock.
export function formatNoteTime(ms, nowMs = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const now = new Date(nowMs);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const ago = daysBetween(d, now);
  if (ago === 0) return `Today, ${time}`;
  if (ago === 1) return `Yesterday, ${time}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? `${date}, ${time}` : `${date} ${d.getFullYear()}, ${time}`;
}

// "" until fewer than 100 characters are left, then "99 left" ... "0 left", "3 over".
export function countLabel(text) {
  const left = NOTE_MAX - String(text || '').length;
  if (left >= SHOW_COUNT_UNDER) return '';
  return left >= 0 ? `${left} left` : `${-left} over`;
}

// Can this be sent? { ok: true } or { ok: false, reason: 'empty' | 'long' }.
export function checkNote(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > NOTE_MAX) return { ok: false, reason: 'long' };
  return { ok: true };
}

// Is this note written by the person who is signed in?
export function isOwn(note, door) {
  return (door === 'hers' || door === 'his') && !!note && note.authorDoor === door;
}

export function authorOf(note) {
  const a = note && note.authorDoor;
  return a === 'hers' || a === 'his' ? a : null;
}

// A copy, oldest first, so the newest note is at the bottom like a conversation.
// The adapters hand notes over newest first; equal times keep the reverse of that.
export function oldestFirst(notes) {
  return notes.slice().reverse().sort((a, b) => a.createdAt - b.createdAt);
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The local calendar day a time falls on, as a string to compare ('' for a bad time).
export function dayKey(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// The label on a day separator: "Today", "Yesterday", otherwise "31 October" (with the
// year only when it is not the current year). Local calendar days, like formatNoteTime.
export function dayLabel(ms, nowMs = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const now = new Date(nowMs);
  const ago = daysBetween(d, now);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  const date = `${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}
