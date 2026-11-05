// Save your journal: PDF (through the browser's print window), Word, Markdown,
// plain text, and a JSON backup under Advanced. Everything is built in the
// browser from the data the adapter returns for the signed-in person only.
import { buildExportModel } from '../lib/exportmodel.js';
import { toMarkdown, toText, toJson, toPrintHtml, toDocxBytes, exportTitle, exportFileName, exportBaseName } from '../lib/formats.js';

const MIME = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// How each button is wired: its id, what to call it, what to try instead, how to make it.
const FORMATS = {
  pdf: { id: 'sv-pdf', label: 'PDF', instead: 'Word or Markdown', ready: 'Your print window is open. Choose Save as PDF.' },
  docx: { id: 'sv-docx', label: 'Word', instead: 'Markdown or Plain text', ready: 'Your Word file is ready.' },
  md: { id: 'sv-md', label: 'Markdown', instead: 'Plain text or Word', ready: 'Your Markdown file is ready.' },
  txt: { id: 'sv-txt', label: 'Plain text', instead: 'Markdown or Word', ready: 'Your plain text file is ready.' },
  json: { id: 'sv-json', label: 'The backup file', instead: 'a readable format such as Markdown', ready: 'Your backup file is ready.' },
};

// The file for one format, from the model. `date` is today.
function makeFile(kind, model, who, date) {
  const title = exportTitle(who);
  const name = exportFileName(who, kind, date);
  if (kind === 'md') return { name, type: MIME.md, data: toMarkdown(model, title, date) };
  if (kind === 'txt') return { name, type: MIME.txt, data: toText(model, title, date) };
  if (kind === 'json') return { name, type: MIME.json, data: toJson(model) };
  return { name, type: MIME.docx, data: toDocxBytes(model, title, date) };
}

// Saves a file through a Blob and a download link. The object URL is revoked
// a little later, once the browser has had time to start reading it.
export function defaultDownload(file, { document: doc = globalThis.document, url = globalThis.URL, setTimer = globalThis.setTimeout } = {}) {
  const blob = new Blob([file.data], { type: file.type });
  const href = url.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = href;
  a.download = file.name;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.appendChild(a);
  try {
    a.click();
  } finally {
    setTimer(() => {
      if (a.parentNode ?? a.parent) doc.body.removeChild(a);
      url.revokeObjectURL(href);
    }, 4000);
  }
}

// Opens the browser's print window on a hidden frame holding the document, so
// the person can choose "Save as PDF". Resolves once the document is loaded
// and printing has been asked for; rejects if it never loads. Focus goes back
// to `returnFocusTo` once the print window closes.
export function defaultPrint(html, title, returnFocusTo, { document: doc = globalThis.document, setTimer = globalThis.setTimeout } = {}) {
  return new Promise((resolve, reject) => {
    const frame = doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('title', 'Print preview');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (frame.parentNode) frame.parentNode.removeChild(frame);
      doc.title = previousTitle;
      // The frame took focus to print; give it back to the button that was used.
      if (opener && opener.isConnected !== false && opener.focus) opener.focus();
    };
    const previousTitle = doc.title;
    const opener = returnFocusTo || doc.activeElement;
    const giveUp = setTimer(() => { cleanup(); reject(new Error('The print window did not load.')); }, 15000);
    frame.addEventListener('load', () => {
      if (done) return;
      clearTimeout(giveUp);
      const w = frame.contentWindow;
      doc.title = title; // the suggested file name in "Save as PDF"
      w.addEventListener('afterprint', cleanup);
      resolve();
      setTimer(() => { try { w.focus(); w.print(); } catch (e) { cleanup(); } }, 50);
      setTimer(cleanup, 10 * 60 * 1000); // if no afterprint arrives (some phones)
    });
    frame.srcdoc = html;
    doc.body.appendChild(frame);
  });
}

// deps: { data, showScreen, rail?, document?, now?, download?, print? }
export function createExport({ data, showScreen, rail = { show() {} }, document: doc = globalThis.document, now = () => new Date(), download, print }) {
  const $ = (id) => doc.getElementById(id);
  const saveFile = download || ((f) => defaultDownload(f, { document: doc }));
  const printHtml = print || ((h, t, back) => defaultPrint(h, t, back, { document: doc }));
  let token = 0;
  let who = 'hers';
  let busy = false;

  function say(status, error) {
    $('sv-status').textContent = status || '';
    const e = $('sv-error');
    e.textContent = error || '';
    e.hidden = !error;
  }

  async function run(kind) {
    if (busy) return;
    busy = true;
    const f = FORMATS[kind];
    const t = token;
    say('', '');
    try {
      const [moods, entries] = await Promise.all([data.getMoods(), data.listEntries()]);
      if (t !== token) return; // signed out while preparing: save nothing
      const model = buildExportModel(moods, entries);
      const date = now();
      if (kind === 'pdf') {
        await printHtml(toPrintHtml(model, exportTitle(who), date), exportBaseName(who, date), $(f.id));
      } else {
        await saveFile(makeFile(kind, model, who, date));
      }
      if (t === token) say(f.ready, '');
    } catch (err) {
      if (t === token) say('', `${f.label} didn't work. Try ${f.instead}.`);
    } finally {
      if (t === token) {
        busy = false;
        $(f.id).focus(); // keep focus on the button that was used
      }
    }
  }

  for (const kind of Object.keys(FORMATS)) {
    $(FORMATS[kind].id).addEventListener('click', () => run(kind));
  }

  return {
    show(door) {
      who = door === 'his' ? 'his' : 'hers';
      token += 1;
      busy = false;
      say('', '');
      showScreen('save', who);
      rail.show(who, data);
      $('sv-title').focus();
    },
    // Wipe messages and stop any export still preparing (sign-out on a shared device).
    clear() {
      token += 1;
      busy = false;
      say('', '');
    },
  };
}
