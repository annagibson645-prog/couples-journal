// Pure maths for the 30-day mood chart: where points go and what to say about
// them. No DOM. The drawing itself is js/screens/chart.js.
import { moodWord } from './today.js';
import { formatDayShort } from './lookback.js';

export const CHART_H = 190;
export const CHART_TOP = 20;     // y of score 10
export const CHART_BOTTOM = 170; // y of score 1
const LEFT = 30;
const RIGHT_MARGIN = 10;

const f = (x) => x.toFixed(1);

// Geometry for a chart `width` units wide (the width the browser actually
// gives it, so text stays a readable size on a phone).
export function chartGeometry(width = 700) {
  const w = Math.max(240, Math.round(width));
  return { width: w, height: CHART_H, left: LEFT, right: w - RIGHT_MARGIN, top: CHART_TOP, bottom: CHART_BOTTOM };
}

export function chartY(score) {
  return CHART_BOTTOM - ((score - 1) / 9) * (CHART_BOTTOM - CHART_TOP);
}

// One entry per series day: { x, y, day, score }, or null for a day without a mood.
export function chartPoints(series, geo = chartGeometry()) {
  const n = series.length;
  return series.map((p, i) => {
    if (p.score === null || p.score === undefined) return null;
    const x = n > 1 ? geo.left + (i * (geo.right - geo.left)) / (n - 1) : (geo.left + geo.right) / 2;
    return { x, y: chartY(p.score), day: p.day, score: p.score };
  });
}

// Runs of consecutive days that have a mood. Gaps split the line.
function runs(points) {
  const out = [];
  let cur = [];
  for (const p of points) {
    if (p) cur.push(p);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

// SVG path data: `line` joins only neighbouring days (a gap breaks it),
// `area` fills under each such run, `dots` marks every day with a mood
// (zero-length segments with round caps), so a lone day is still visible.
export function chartPaths(series, geo = chartGeometry()) {
  const points = chartPoints(series, geo);
  let line = '';
  let area = '';
  for (const run of runs(points)) {
    if (run.length < 2) continue;
    const pts = run.map((p) => `${f(p.x)} ${f(p.y)}`);
    line += `M${pts.join('L')}`;
    area += `M${pts.join('L')}L${f(run[run.length - 1].x)} ${CHART_BOTTOM}L${f(run[0].x)} ${CHART_BOTTOM}Z`;
  }
  let dots = '';
  for (const p of points) if (p) dots += `M${f(p.x)} ${f(p.y)}l0 0`;
  return { line, area, dots };
}

// Screen-reader sentence for the whole chart.
export function chartAriaLabel(series, { unavailable = false } = {}) {
  if (unavailable) return 'Mood chart unavailable';
  const base = 'Mood line chart for the last 30 days';
  let last = null;
  for (const p of series) if (p.score !== null && p.score !== undefined) last = p;
  if (!last) return `${base}; no moods recorded yet`;
  const isLatest = last === series[series.length - 1];
  return `${base}; most recent mood ${last.score} of 10${isLatest ? '' : `, on ${formatDayShort(last.day)}`}`;
}

// The point closest to x (sideways distance only), or null when none is within
// maxDist. `points` is chartPoints output (null for gap days). One tap handler
// on the whole chart uses this, so crowded dots on a phone cannot open the wrong day.
export function nearestPoint(points, x, maxDist) {
  let best = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (!p) continue;
    const d = Math.abs(p.x - x);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best && bestDist <= maxDist ? best : null;
}

// "5 November: 7 of 10, mostly bright" for each day that has a mood, oldest first.
export function chartListItems(series) {
  return series
    .filter((p) => p.score !== null && p.score !== undefined)
    .map((p) => `${formatDayShort(p.day)}: ${p.score} of 10, ${moodWord(p.score).toLowerCase()}`);
}
