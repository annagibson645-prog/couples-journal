process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, zipStore, xmlEscape, buildDocx } from '../js/lib/docx.js';
import { toDocxBytes } from '../js/lib/formats.js';

// An independent reader: walks the central directory, then each local header,
// and checks CRC-32 and sizes. Returns { name: Buffer }.
function readZip(bytes) {
  const b = Buffer.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, 'end of central directory');
  const count = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOff = b.readUInt32LE(eocd + 16);
  assert.equal(cdOff + cdSize, eocd, 'central directory ends where EOCD begins');
  const out = {};
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const elen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const lho = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nlen);
    assert.equal(method, 0, 'stored');
    assert.equal(csize, usize);
    assert.equal(b.readUInt32LE(lho), 0x04034b50);
    const lnlen = b.readUInt16LE(lho + 26);
    const lelen = b.readUInt16LE(lho + 28);
    assert.equal(b.readUInt32LE(lho + 14), crc, 'local CRC matches central');
    const start = lho + 30 + lnlen + lelen;
    const data = b.subarray(start, start + usize);
    assert.equal(crc32(data), crc, `CRC-32 of ${name}`);
    assert.equal(zlib.crc32(data), crc, `node CRC-32 of ${name}`);
    out[name] = data;
    p += 46 + nlen + elen + clen;
  }
  assert.equal(p, cdOff + cdSize);
  return out;
}

test('crc32 matches the standard check value and node', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const big = new Uint8Array(100000).map((_, i) => (i * 31) & 255);
  assert.equal(crc32(big), zlib.crc32(Buffer.from(big)));
});

test('zipStore writes a zip a reader can walk, names and bytes intact', () => {
  const enc = new TextEncoder();
  const zip = zipStore([{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/b é.txt', data: enc.encode('日本語 \u{1F319}') }, { name: 'empty', data: new Uint8Array(0) }]);
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files), ['a.txt', 'dir/b é.txt', 'empty']);
  assert.equal(files['a.txt'].toString(), 'hello');
  assert.equal(files['dir/b é.txt'].toString(), '日本語 \u{1F319}');
  assert.equal(files.empty.length, 0);
});

test('xmlEscape escapes markup characters and strips characters XML 1.0 forbids', () => {
  assert.equal(xmlEscape('a & b < c > d "e" \'f\''), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
  assert.equal(xmlEscape('a\u0000b\u0008c\u000bd\u000ce\u001ff￾g￿h'), 'abcdefgh');
  assert.equal(xmlEscape('tab\tok \u{1F319} é'), 'tab\tok \u{1F319} é');
});

const MODEL = [
  { day: '2026-11-02', score: 4, note: 'Quiet <day> & "calm"', entries: [] },
  { day: '2026-11-05', score: 7, note: null, entries: [{ time: '09:05', text: 'First line \u{1F319}\nSecond <script>alert(1)</script> & more\n\n\tindented\u0001 end' }] },
];

test('docx: the required parts are present and every CRC verifies', () => {
  const files = readZip(toDocxBytes(MODEL, 'Hers journal', new Date(2026, 10, 5)));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml']) assert.ok(files[n], n);
  assert.match(files['[Content_Types].xml'].toString(), /wordprocessingml\.document\.main\+xml/);
  assert.match(files['_rels/.rels'].toString(), /word\/document\.xml/);
});

test('docx: document.xml is well-formed text, escaped, with paragraphs per line', () => {
  const files = readZip(toDocxBytes(MODEL, 'Hers journal', new Date(2026, 10, 5)));
  const xml = files['word/document.xml'].toString('utf8');
  assert.ok(xml.startsWith('<?xml'));
  assert.ok(xml.includes('Hers journal'));
  assert.ok(xml.includes('Thursday, 5 November 2026'));
  assert.ok(xml.includes('Mood: 7 of 10, mostly bright'));
  assert.ok(xml.includes('Quiet &lt;day&gt; &amp; &quot;calm&quot;') || xml.includes('Quiet &lt;day&gt; &amp; "calm"'));
  assert.ok(xml.includes('First line \u{1F319}'));
  assert.ok(xml.includes('Second &lt;script&gt;alert(1)&lt;/script&gt; &amp; more'));
  assert.ok(!xml.includes('<script'));
  assert.ok(!xml.includes('\u0001'));
  assert.ok(xml.includes('indented'));
  assert.ok(/end/.test(xml));
  // First line and second line are separate paragraphs, not one run.
  const paras = xml.match(/<w:p>/g).length + (xml.match(/<w:p /g) || []).length;
  assert.ok(paras >= 8);
});

test('docx: 12,000 and 50,000 character entries are present in full', () => {
  for (const len of [12000, 50000]) {
    const text = ('Word & \u{1F319} ' + 'y'.repeat(40) + ' ').repeat(Math.ceil(len / 50)).slice(0, len);
    const files = readZip(toDocxBytes([{ day: '2026-11-05', score: 6, note: null, entries: [{ time: '10:00', text }] }], 'Hers journal'));
    const xml = files['word/document.xml'].toString('utf8');
    assert.ok(xml.includes(text.replace(/&/g, '&amp;')), `${len} chars`);
  }
});

test('docx: empty model says No entries yet', () => {
  const files = readZip(toDocxBytes([], 'His journal'));
  assert.ok(files['word/document.xml'].toString('utf8').includes('No entries yet'));
});

test('buildDocx takes plain blocks', () => {
  const files = readZip(buildDocx([{ style: 'Heading1', text: 'Hi & bye' }, { text: 'body' }]));
  assert.ok(files['word/document.xml'].toString('utf8').includes('Hi &amp; bye'));
});
