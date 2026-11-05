process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportModel } from '../js/lib/exportmodel.js';

const at = (d, h = 9, m = 5) => new Date(2026, 10, d, h, m).getTime();
const entry = (id, d, text, h, m) => ({ id, day: `2026-11-${String(d).padStart(2, '0')}`, text, createdAt: at(d, h, m) });

test('merges mood-only, entry-only and both-kinds days, oldest first', () => {
  const moods = { '2026-11-05': { score: 7, note: 'Steady.' }, '2026-11-02': { score: 4 } };
  const entries = [entry('c', 5, 'five', 21, 30), entry('b', 3, 'three', 8, 0)]; // newest first, like the adapter
  const m = buildExportModel(moods, entries);
  assert.deepEqual(m.map((d) => d.day), ['2026-11-02', '2026-11-03', '2026-11-05']);
  assert.deepEqual(m[0], { day: '2026-11-02', score: 4, note: null, entries: [] });
  assert.deepEqual(m[1], { day: '2026-11-03', score: null, note: null, entries: [{ time: '08:00', text: 'three' }] });
  assert.deepEqual(m[2], { day: '2026-11-05', score: 7, note: 'Steady.', entries: [{ time: '21:30', text: 'five' }] });
});

test('several entries on one day read oldest first, with local HH:MM', () => {
  const entries = [entry('b', 5, 'later', 23, 59), entry('a', 5, 'earlier', 0, 7)];
  const m = buildExportModel({}, entries);
  assert.deepEqual(m[0].entries, [{ time: '00:07', text: 'earlier' }, { time: '23:59', text: 'later' }]);
});

test('invalid moods are left out, blank notes become null, entry text is untouched', () => {
  const text = '  # keep <script>x</script> \u{1F319}\n\n  indented  ';
  const m = buildExportModel(
    { '2026-11-01': { score: 11, note: 'bad' }, '2026-11-02': { score: 5, note: '   ' }, '2026-11-03': null },
    [entry('a', 4, text, 9, 0)],
  );
  assert.deepEqual(m.map((d) => d.day), ['2026-11-02', '2026-11-04']);
  assert.equal(m[0].note, null);
  assert.equal(m[1].entries[0].text, text);
});

test('an entry with an unusable day key is kept, filed under its local date', () => {
  const m = buildExportModel({}, [{ id: 'x', day: 'bogus', text: 'kept', createdAt: at(6, 10, 0) }]);
  assert.deepEqual(m.map((d) => d.day), ['2026-11-06']);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(buildExportModel({}, []), []);
  assert.deepEqual(buildExportModel(null, undefined), []);
});
