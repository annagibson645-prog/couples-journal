// Pure helpers for the Today screen: mood words and local-time formatting.
// No DOM, no storage. Names are spelled out so output never depends on locale.
import { isValidScore } from './moodlogic.js';

export const MOOD_WORDS = ['Very heavy', 'Heavy', 'Low', 'A bit low', 'Even', 'Steady', 'Mostly bright', 'Bright', 'Glowing', 'Full and light'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Word for a mood score, or '' when the score is not an integer 1-10.
export function moodWord(score) {
  return isValidScore(score) ? MOOD_WORDS[score - 1] : '';
}

// Screen-reader label for a moon button: "7 of 10, mostly bright".
export function moodLabel(score) {
  return `${score} of 10, ${moodWord(score).toLowerCase()}`;
}

// Fraction of the moon that is lit, for moonPath: 1 is new (0), 10 is full (1).
export function moonFraction(score) {
  return (score - 1) / 9;
}

// "Thursday, 5 November" in local time.
export function formatDateHeading(date) {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// "9:41 am" in local time, from epoch milliseconds.
export function formatTime(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

// "Today, 11:30 pm" or "Monday 2 November, 8:15 am". `todayKey` is dayKey(new Date()).
export function entryWhen(entry, todayKey) {
  const time = formatTime(entry.createdAt);
  if (entry.day === todayKey) return `Today, ${time}`;
  const d = new Date(entry.createdAt);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}
