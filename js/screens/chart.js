// Draws the 30-day mood chart as hand-made SVG (no library). The line breaks at
// days without a mood; every mood day gets a round dot. Beside the picture goes
// a visually hidden list of the same values, because a picture alone is no use
// to a screen reader.
import { chartGeometry, chartPaths, chartPoints, chartY, chartAriaLabel, chartListItems, CHART_H } from '../lib/chart.js';
import { formatDayShort } from '../lib/lookback.js';
import { makeEl } from './shared.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// host: the element to fill. series: moodSeries output, oldest first.
// width: how wide the chart is on screen, in pixels (default 700).
// Tapping a day's dot dispatches CustomEvent('daypick', { detail: { day } }) on host.
export function renderChart(host, series, { width = 700, document: doc = host.ownerDocument || globalThis.document } = {}) {
  const geo = chartGeometry(width);
  const el = makeEl(doc);
  const svgEl = (tag, attrs = {}, className) => {
    const e = doc.createElementNS(SVG_NS, tag);
    if (className) e.setAttribute('class', className);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const text = (t, attrs, className) => {
    const e = svgEl('text', attrs, className);
    e.textContent = t;
    return e;
  };

  const svg = svgEl('svg', { viewBox: `0 0 ${geo.width} ${CHART_H}`, role: 'img', 'aria-label': chartAriaLabel(series) }, 'ch-svg');
  for (const score of [10, 5, 1]) {
    const y = chartY(score).toFixed(1);
    svg.append(
      svgEl('line', { x1: geo.left, x2: geo.right, y1: y, y2: y }, score === 5 ? 'ch-grid ch-grid-mid' : 'ch-grid'),
      text(String(score), { x: geo.left - 8, y: (chartY(score) + 4).toFixed(1), 'text-anchor': 'end' }, 'ch-label'),
    );
  }
  const { line, area, dots } = chartPaths(series, geo);
  svg.append(
    svgEl('path', { d: area }, 'ch-area'),
    svgEl('path', { d: line }, 'ch-line'),
    svgEl('path', { d: dots }, 'ch-dots'),
  );
  if (series.length) {
    svg.append(
      text(formatDayShort(series[0].day), { x: geo.left, y: CHART_H - 4, 'text-anchor': 'start' }, 'ch-label'),
      text('Today', { x: geo.right, y: CHART_H - 4, 'text-anchor': 'end' }, 'ch-label'),
    );
  }
  // Generous invisible targets over each dot for a finger. Keyboard and screen
  // reader users have the calendar and the list instead.
  for (const p of chartPoints(series, geo)) {
    if (!p) continue;
    const hit = svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 12 }, 'ch-hit');
    hit.addEventListener('click', () => {
      if (host.dispatchEvent) host.dispatchEvent(new CustomEvent('daypick', { detail: { day: p.day } }));
    });
    svg.appendChild(hit);
  }

  const list = el('ul', 'sr-only');
  list.setAttribute('aria-label', 'Mood by day, last 30 days');
  for (const item of chartListItems(series)) list.appendChild(el('li', '', item));
  host.replaceChildren(svg, list);
}
