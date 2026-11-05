// The export formats. Each is a pure function of the export model (see
// exportmodel.js). Entry text is written exactly as the person wrote it; only
// the formats that have a markup syntax (print HTML, Word XML) escape it.
import { formatDayLong } from './lookback.js';
import { moodLabel } from './today.js';
import { dayKey } from './days.js';
import { escapeText } from './escape.js';
import { buildDocx } from './docx.js';

export const EMPTY_MESSAGE = 'No entries yet. Write one on Today and it will appear here.';

export function exportTitle(who) {
  return who === 'his' ? 'His journal' : 'Hers journal';
}

// "hers-journal-2026-11-05"
export function exportBaseName(who, date) {
  return `${who === 'his' ? 'his' : 'hers'}-journal-${dayKey(date)}`;
}

// "hers-journal-2026-11-05.md"
export function exportFileName(who, ext, date) {
  return `${exportBaseName(who, date)}.${String(ext).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

const savedOn = (generated) => (generated ? `Saved on ${formatDayLong(dayKey(generated))}` : '');
const moodLine = (d) => (d.score === null ? '' : `Mood: ${moodLabel(d.score)}`);
const noteLine = (d) => (d.note ? `Note: ${d.note}` : '');

// Markdown. Headings per day, entry text verbatim underneath.
export function toMarkdown(model, title, generated) {
  const out = [`# ${title}`];
  const saved = savedOn(generated);
  if (saved) out.push('', saved);
  if (!model.length) return `${out.concat(['', EMPTY_MESSAGE]).join('\n')}\n`;
  for (const d of model) {
    out.push('', `## ${formatDayLong(d.day)}`);
    const facts = [moodLine(d), noteLine(d)].filter(Boolean);
    if (facts.length) out.push('', facts.join('  \n'));
    for (const e of d.entries) out.push('', e.time ? `### ${e.time}` : '###', '', e.text);
  }
  return `${out.join('\n')}\n`;
}

// Plain text. Same order, no markup characters of our own.
export function toText(model, title, generated) {
  const out = [title, '='.repeat(Math.min(40, [...title].length))];
  const saved = savedOn(generated);
  if (saved) out.push(saved);
  if (!model.length) return `${out.concat(['', EMPTY_MESSAGE]).join('\n')}\n`;
  for (const d of model) {
    const heading = formatDayLong(d.day);
    out.push('', heading, '-'.repeat(Math.min(40, heading.length)));
    for (const f of [moodLine(d), noteLine(d)]) if (f) out.push(f);
    for (const e of d.entries) out.push('', e.time ? `[${e.time}]` : '[ ]', e.text);
  }
  return `${out.join('\n')}\n`;
}

// JSON backup: for safekeeping, not reading.
export function toJson(model) {
  const doc = { format: 'journal-backup', version: 1, days: model };
  if (!model.length) doc.note = EMPTY_MESSAGE;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// A complete, print-ready HTML document. Every piece of text goes through
// escapeText, so entry text such as "<script>" prints as text.
const PRINT_CSS = `
@page { margin: 22mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0 auto; max-width: 42rem; padding: 2rem 1.25rem; color: #1b1b1b; background: #fff;
  font: 12pt/1.6 Georgia, 'Times New Roman', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', serif; }
h1 { margin: 0 0 .15em; font-size: 26pt; font-style: italic; font-weight: 400; line-height: 1.1; }
.saved { margin: 0 0 1.6em; color: #555; font-style: italic; }
.day { margin: 0 0 1.4em; }
h2 { margin: 1.6em 0 .2em; padding-bottom: .15em; border-bottom: 1px solid #bbb; font-size: 15pt; font-weight: 700;
  break-after: avoid; page-break-after: avoid; }
.facts { margin: 0 0 .5em; color: #444; font-style: italic; break-after: avoid; page-break-after: avoid; }
.facts p { margin: 0; }
.entry { margin: .8em 0 0; }
.time { margin: 0; color: #666; font: 9pt/1.4 'Courier New', monospace; letter-spacing: .08em; break-after: avoid; page-break-after: avoid; }
.text { margin: .15em 0 0; white-space: pre-wrap; overflow-wrap: anywhere; orphans: 3; widows: 3; }
.empty { font-style: italic; color: #555; }
@media print { body { max-width: none; padding: 0; } }
`;

export function toPrintHtml(model, title, generated) {
  const saved = savedOn(generated);
  const parts = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(title)}</title>`,
    `<style>${PRINT_CSS}</style></head><body>`,
    `<h1>${escapeText(title)}</h1>`,
  ];
  if (saved) parts.push(`<p class="saved">${escapeText(saved)}</p>`);
  if (!model.length) parts.push(`<p class="empty">${escapeText(EMPTY_MESSAGE)}</p>`);
  for (const d of model) {
    parts.push(`<section class="day"><h2>${escapeText(formatDayLong(d.day))}</h2>`);
    const facts = [moodLine(d), noteLine(d)].filter(Boolean);
    if (facts.length) parts.push(`<div class="facts">${facts.map((f) => `<p>${escapeText(f)}</p>`).join('')}</div>`);
    for (const e of d.entries) {
      parts.push('<article class="entry">');
      if (e.time) parts.push(`<p class="time">${escapeText(e.time)}</p>`);
      parts.push(`<p class="text">${escapeText(e.text)}</p></article>`);
    }
    parts.push('</section>');
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

// Word: the same content as blocks for the small in-repo .docx writer.
export function toDocxBytes(model, title, generated) {
  const blocks = [{ style: 'Title', text: title }];
  const saved = savedOn(generated);
  if (saved) blocks.push({ style: 'Muted', text: saved });
  if (!model.length) blocks.push({ text: EMPTY_MESSAGE });
  for (const d of model) {
    blocks.push({ style: 'Heading1', text: formatDayLong(d.day) });
    for (const f of [moodLine(d), noteLine(d)]) if (f) blocks.push({ style: 'Muted', text: f });
    for (const e of d.entries) {
      if (e.time) blocks.push({ style: 'Heading2', text: e.time });
      blocks.push({ text: e.text });
    }
  }
  return buildDocx(blocks);
}
