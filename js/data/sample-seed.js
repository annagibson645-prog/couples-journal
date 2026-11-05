// Invented sample content for demo mode. Nothing here is real; never add real
// journal text to this repository. Dates are relative to `today` so the sample
// always looks recent.
import { dayKey } from '../lib/days.js';

const HERS_SCORES = [6, 7, 5, 4, 6, 7, 8, 7, 6, 5, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 6, 5, 7, 8, 7, 6, 8, 9, 8, 7];
const HIS_SCORES = [5, 5, 6, 7, 6, 4, 3, 4, 5, 6, 7, 7, 8, 6, 5, 5, 6, 7, 8, 8, 7, 6, 5, 6, 7, 7, 8, 7, 6, 8];
const HERS_NOTES = { 0: 'Slow morning, good tea.', 10: 'Rough sleep, short fuse.', 16: 'The walk by the water helped.' };
const HIS_NOTES = { 0: 'Steady day.', 6: 'Deadline stress.', 12: 'Finally fixed the shelf.' };

const HERS_ENTRIES = [
  [1, 21, 'Made soup from the sample recipe and let the windows fog up. A quiet evening is underrated.'],
  [4, 9, 'Sample entry: tried to write for ten minutes without stopping. It mostly worked.'],
  [9, 22, 'Sample entry: a long day, but the sunset over the rooftops made up for it.'],
];
const HIS_ENTRIES = [
  [2, 20, 'Sample entry: went for a run before work and felt like a person afterwards.'],
  [5, 8, 'Sample entry: planning the weekend. Maybe the market, maybe nothing at all.'],
  [11, 23, 'Sample entry: finished the book. Already missing the characters.'],
];
const NOTES = [
  [0, 18, 'hers', 'Sample note: there is soup in the fridge if you are hungry.'],
  [1, 12, 'his', 'Sample note: thinking of you. Back by six.'],
  [3, 9, 'hers', 'Sample note: can we pick a film for Friday?'],
  [5, 20, 'his', 'Sample note: that was a lovely evening. Thank you.'],
];

function at(today, daysAgo, hour) {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, 0, 0);
}

function moodsFor(scores, notes, today) {
  const out = {};
  scores.forEach((score, i) => {
    const d = at(today, i, 12);
    out[dayKey(d)] = notes[i] ? { score, note: notes[i] } : { score };
  });
  return out;
}

function entriesFor(prefix, rows, today) {
  return rows.map(([ago, hour, text], i) => {
    const d = at(today, ago, hour);
    return { id: `${prefix}-seed-${i}`, day: dayKey(d), text, createdAt: d.getTime() };
  });
}

// today: a Date. Returns { hers: {moods, entries}, his: {moods, entries}, notes }.
export function buildSeed(today = new Date()) {
  return {
    hers: { moods: moodsFor(HERS_SCORES, HERS_NOTES, today), entries: entriesFor('hers', HERS_ENTRIES, today) },
    his: { moods: moodsFor(HIS_SCORES, HIS_NOTES, today), entries: entriesFor('his', HIS_ENTRIES, today) },
    notes: NOTES.map(([ago, hour, authorDoor, text], i) => ({
      id: `note-seed-${i}`, authorDoor, text, createdAt: at(today, ago, hour).getTime(),
    })),
  };
}
