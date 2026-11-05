process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExport, defaultDownload } from '../js/screens/export.js';
import { buildExportModel } from '../js/lib/exportmodel.js';
import { toMarkdown, toText, toJson, toPrintHtml } from '../js/lib/formats.js';
import { makeSaveDom } from './helpers/fake-dom.js';

const NOW = () => new Date(2026, 10, 5, 12, 0);
const at = (d, h) => new Date(2026, 10, d, h, 0).getTime();
const MOODS = { '2026-11-05': { score: 7, note: 'Steady.' }, '2026-11-02': { score: 4 } };
const ENTRIES = [{ id: 'a', day: '2026-11-05', text: '# kept <script> \u{1F319}', createdAt: at(5, 9) }];

function setup({ moods = MOODS, entries = ENTRIES, data = {}, download, print } = {}) {
  const doc = makeSaveDom();
  const downloads = [];
  const prints = [];
  const shown = [];
  const rails = [];
  const api = { getMoods: async () => moods, listEntries: async () => entries, ...data };
  const screen = createExport({
    data: api, document: doc, now: NOW,
    showScreen: (...a) => shown.push(a),
    rail: { show: (...a) => rails.push(a) },
    download: download || ((f) => { downloads.push(f); }),
    print: print || ((h, t) => { prints.push([h, t]); }),
  });
  return { doc, screen, $: (id) => doc.byId[id], downloads, prints, shown, rails };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
async function press(ctx, id) { ctx.$(id).click(); await settle(); await settle(); }
const MODEL = buildExportModel(MOODS, ENTRIES);

test('show opens the screen with the rail and puts focus on the heading', async () => {
  const c = setup();
  await c.screen.show('his');
  assert.deepEqual(c.shown[0], ['save', 'his']);
  assert.equal(c.rails[0][0], 'his');
  assert.equal(c.doc.activeElement, c.$('sv-title'));
  assert.equal(c.$('sv-error').hidden, true);
});

test('Markdown: builds the file from the adapter data and downloads it', async () => {
  const c = setup();
  await c.screen.show('hers');
  await press(c, 'sv-md');
  assert.equal(c.downloads.length, 1);
  const f = c.downloads[0];
  assert.equal(f.name, 'hers-journal-2026-11-05.md');
  assert.match(f.type, /^text\/markdown/);
  assert.equal(f.data, toMarkdown(MODEL, 'Hers journal', NOW()));
  assert.equal(c.$('sv-status').textContent, 'Your Markdown file is ready.');
  assert.equal(c.$('sv-error').hidden, true);
  assert.equal(c.doc.activeElement, c.$('sv-md'));
});

test('Plain text and the backup file use their own formatters', async () => {
  const c = setup();
  await c.screen.show('his');
  await press(c, 'sv-txt');
  await press(c, 'sv-json');
  assert.equal(c.downloads[0].name, 'his-journal-2026-11-05.txt');
  assert.equal(c.downloads[0].data, toText(MODEL, 'His journal', NOW()));
  assert.equal(c.downloads[1].name, 'his-journal-2026-11-05.json');
  assert.equal(c.downloads[1].data, toJson(MODEL));
  assert.equal(c.$('sv-status').textContent, 'Your backup file is ready.');
});

test('Word: downloads .docx bytes (a zip)', async () => {
  const c = setup();
  await c.screen.show('hers');
  await press(c, 'sv-docx');
  const f = c.downloads[0];
  assert.equal(f.name, 'hers-journal-2026-11-05.docx');
  assert.match(f.type, /wordprocessingml\.document/);
  assert.ok(f.data instanceof Uint8Array);
  assert.equal(f.data[0], 0x50); assert.equal(f.data[1], 0x4b); // "PK"
  assert.equal(c.$('sv-status').textContent, 'Your Word file is ready.');
  assert.equal(c.doc.activeElement, c.$('sv-docx'));
});

test('PDF: hands the print-ready HTML to the print window, nothing is downloaded', async () => {
  const c = setup();
  await c.screen.show('hers');
  await press(c, 'sv-pdf');
  assert.equal(c.downloads.length, 0);
  assert.equal(c.prints.length, 1);
  assert.equal(c.prints[0][0], toPrintHtml(MODEL, 'Hers journal', NOW()));
  assert.equal(c.prints[0][1], 'hers-journal-2026-11-05');
  assert.equal(c.$('sv-status').textContent, 'Your print window is open. Choose Save as PDF.');
  assert.equal(c.doc.activeElement, c.$('sv-pdf'));
});

test('an empty journal still gives a file that says there is nothing yet', async () => {
  const c = setup({ moods: {}, entries: [] });
  await c.screen.show('hers');
  await press(c, 'sv-txt');
  assert.match(c.downloads[0].data, /No entries yet/);
});

test('failure names the format and suggests another; never crashes; focus stays', async () => {
  const c = setup({ download: () => { throw new Error('blocked'); } });
  await c.screen.show('hers');
  await press(c, 'sv-docx');
  assert.equal(c.$('sv-error').hidden, false);
  assert.equal(c.$('sv-error').textContent, "Word didn't work. Try Markdown or Plain text.");
  assert.equal(c.$('sv-status').textContent, '');
  assert.equal(c.doc.activeElement, c.$('sv-docx'));
  await press(c, 'sv-md');
  assert.equal(c.$('sv-error').textContent, "Markdown didn't work. Try Plain text or Word.");
});

test('a failing print window and a failing data read are reported the same way', async () => {
  const c = setup({ print: () => { throw new Error('popup blocked'); } });
  await c.screen.show('hers');
  await press(c, 'sv-pdf');
  assert.match(c.$('sv-error').textContent, /^PDF didn't work\. Try Word or Markdown\.$/);
  const d = setup({ data: { listEntries: async () => { throw new Error('offline'); } } });
  await d.screen.show('hers');
  await press(d, 'sv-txt');
  assert.equal(d.$('sv-error').textContent, "Plain text didn't work. Try Markdown or Word.");
  assert.equal(d.downloads.length, 0);
});

test('a later success clears an earlier error', async () => {
  let fail = true;
  const c = setup({ download: (f) => { if (fail) throw new Error('x'); c.downloads.push(f); } });
  await c.screen.show('hers');
  await press(c, 'sv-md');
  assert.equal(c.$('sv-error').hidden, false);
  fail = false;
  await press(c, 'sv-md');
  assert.equal(c.$('sv-error').hidden, true);
  assert.equal(c.downloads.length, 1);
});

test('a second press while one export is running is ignored', async () => {
  const c = setup();
  await c.screen.show('hers');
  c.$('sv-md').click();
  c.$('sv-md').click();
  await settle(); await settle();
  assert.equal(c.downloads.length, 1);
});

test('clear (sign-out) drops messages and stops an export that is still preparing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = setup({ data: { listEntries: async () => { await gate; return ENTRIES; } } });
  await c.screen.show('hers');
  c.$('sv-md').click();
  c.screen.clear();
  release();
  await settle(); await settle();
  assert.equal(c.downloads.length, 0);
  assert.equal(c.$('sv-status').textContent, '');
  assert.equal(c.$('sv-error').hidden, true);
});

test('defaultDownload makes a Blob link, clicks it, and revokes the object URL afterwards', () => {
  const calls = [];
  const doc = makeSaveDom();
  const link = doc.createElement('a');
  link.click = () => calls.push(['click', link.href, link.download, doc.body.children.includes(link)]);
  doc.createElement = () => link;
  const timers = [];
  defaultDownload({ name: 'x.md', type: 'text/markdown;charset=utf-8', data: 'héllo' }, {
    document: doc,
    url: { createObjectURL: (b) => { calls.push(['create', b.size, b.type]); return 'blob:abc'; }, revokeObjectURL: (u) => calls.push(['revoke', u]) },
    setTimer: (fn) => timers.push(fn),
  });
  assert.deepEqual(calls[0], ['create', 6, 'text/markdown;charset=utf-8']);
  assert.deepEqual(calls[1], ['click', 'blob:abc', 'x.md', true]);
  assert.equal(calls.length, 2); // not revoked yet: the browser is still reading it
  timers[0]();
  assert.deepEqual(calls[2], ['revoke', 'blob:abc']);
  assert.equal(doc.body.children.includes(link), false);
});
