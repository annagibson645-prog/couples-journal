import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOOD_WORDS, moodWord, moodLabel, moonFraction, formatDateHeading, formatTime, entryWhen, wordCount, formatWordCount, needsCollapse } from '../js/lib/today.js';
import { dayKey } from '../js/lib/days.js';

test('moodWord gives the ten words in order', () => {
  assert.deepEqual(MOOD_WORDS, ['Very heavy', 'Heavy', 'Low', 'A bit low', 'Even', 'Steady', 'Mostly bright', 'Bright', 'Glowing', 'Full and light']);
  assert.equal(moodWord(1), 'Very heavy');
  assert.equal(moodWord(7), 'Mostly bright');
  assert.equal(moodWord(10), 'Full and light');
});

test('moodWord is empty for anything but an integer 1-10', () => {
  for (const bad of [0, 11, 5.5, NaN, null, undefined, '7', -1]) assert.equal(moodWord(bad), '');
});

test('moodLabel reads for a screen reader', () => {
  assert.equal(moodLabel(7), '7 of 10, mostly bright');
  assert.equal(moodLabel(1), '1 of 10, very heavy');
  assert.equal(moodLabel(10), '10 of 10, full and light');
});

test('moonFraction runs 0 (new) to 1 (full)', () => {
  assert.equal(moonFraction(1), 0);
  assert.equal(moonFraction(10), 1);
  assert.ok(Math.abs(moonFraction(5) - 4 / 9) < 1e-12);
});

test('formatDateHeading is weekday, day, month in local time', () => {
  assert.equal(formatDateHeading(new Date(2026, 10, 5, 23, 59)), 'Thursday, 5 November');
  assert.equal(formatDateHeading(new Date(2026, 0, 1, 0, 0)), 'Thursday, 1 January');
});

test('formatTime is a 12-hour local clock', () => {
  assert.equal(formatTime(new Date(2026, 10, 5, 0, 5).getTime()), '12:05 am');
  assert.equal(formatTime(new Date(2026, 10, 5, 9, 41).getTime()), '9:41 am');
  assert.equal(formatTime(new Date(2026, 10, 5, 12, 0).getTime()), '12:00 pm');
  assert.equal(formatTime(new Date(2026, 10, 5, 23, 30).getTime()), '11:30 pm');
});

test('entryWhen says Today for today and a short date for earlier days', () => {
  const now = new Date(2026, 10, 5, 12, 0);
  const today = dayKey(now);
  const late = new Date(2026, 10, 5, 23, 30);
  assert.equal(entryWhen({ day: dayKey(late), createdAt: late.getTime() }, today), 'Today, 11:30 pm');
  const earlier = new Date(2026, 10, 2, 8, 15);
  assert.equal(entryWhen({ day: dayKey(earlier), createdAt: earlier.getTime() }, today), 'Monday 2 November, 8:15 am');
});

test('wordCount counts whitespace-separated words', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('   \n\t '), 0);
  assert.equal(wordCount('one'), 1);
  assert.equal(wordCount('  a  b\nc\td '), 4);
  assert.equal(wordCount('word '.repeat(50000)), 50000);
});

test('formatWordCount: singular, plural, thousands separator', () => {
  assert.equal(formatWordCount(0), '0 words');
  assert.equal(formatWordCount(1), '1 word');
  assert.equal(formatWordCount(2), '2 words');
  assert.equal(formatWordCount(1284), '1,284 words');
  assert.equal(formatWordCount(1234567), '1,234,567 words');
});

test('needsCollapse: short text no, long or many-lined text yes', () => {
  assert.equal(needsCollapse('A short note.'), false);
  assert.equal(needsCollapse('x'.repeat(2000)), true);
  assert.equal(needsCollapse('a\n'.repeat(9)), true);
  assert.equal(needsCollapse('a\n'.repeat(3)), false);
});
