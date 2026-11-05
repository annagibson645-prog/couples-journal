// A tiny .docx writer with no dependency. A .docx is a zip of a few XML files;
// this writes the zip with the STORE method (no compression) and its own CRC-32.
// Pure: bytes in, bytes out.

const enc = new TextEncoder();

// --- CRC-32 (the zip/PNG polynomial) ---------------------------------------
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- zip, STORE ------------------------------------------------------------
// files: Array<{ name: string, data: Uint8Array }> -> Uint8Array
const DOS_TIME = 0;
const DOS_DATE = (46 << 9) | (11 << 5) | 5; // a fixed date (2026-11-05) keeps output reproducible

export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // version needed
    local.setUint16(6, 0x0800, true);   // flags: names are UTF-8
    local.setUint16(8, 0, true);        // method 0 = stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);          // version made by
    cd.setUint16(6, 20, true);          // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// --- XML -------------------------------------------------------------------
// Characters XML 1.0 cannot hold: control characters except tab, LF and CR,
// and U+FFFE / U+FFFF. Everything else (emoji, any script) goes through as UTF-8.
const ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function xmlEscape(s) {
  return String(s ?? '').replace(ILLEGAL, '').replace(/[&<>"']/g, (c) => XML[c]);
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// One run of text; tabs become real tab elements.
function runs(text) {
  return String(text).split('\t')
    .map((seg) => `<w:r><w:t xml:space="preserve">${xmlEscape(seg)}</w:t></w:r>`)
    .join('<w:r><w:tab/></w:r>');
}

// blocks: Array<{ text: string, style?: 'Title'|'Heading1'|'Heading2'|'Muted' }>.
// A block's text may hold newlines; each line becomes its own paragraph.
function documentXml(blocks) {
  const body = [];
  for (const b of blocks) {
    const style = b.style ? `<w:pPr><w:pStyle w:val="${b.style}"/></w:pPr>` : '';
    for (const line of String(b.text ?? '').split(/\r\n|\r|\n/)) {
      body.push(`<w:p>${style}${line === '' ? '' : runs(line)}</w:p>`);
    }
  }
  return `${HEAD}<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const style = (id, name, rpr, ppr = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:rPr>${rpr}</w:rPr></w:style>`;

const STYLES = `${HEAD}<w:styles ${NS}>`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + style('Title', 'Title', '<w:i/><w:sz w:val="52"/><w:szCs w:val="52"/>', '<w:spacing w:after="80"/>')
  + style('Heading1', 'heading 1', '<w:b/><w:sz w:val="30"/><w:szCs w:val="30"/>', '<w:keepNext/><w:spacing w:before="360" w:after="60"/><w:outlineLvl w:val="0"/>')
  + style('Heading2', 'heading 2', '<w:i/><w:color w:val="666666"/><w:sz w:val="22"/><w:szCs w:val="22"/>', '<w:keepNext/><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="1"/>')
  + style('Muted', 'Muted', '<w:i/><w:color w:val="555555"/>')
  + '</w:styles>';

const CONTENT_TYPES = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// blocks -> the bytes of a .docx file.
export function buildDocx(blocks) {
  const file = (name, text) => ({ name, data: enc.encode(text) });
  return zipStore([
    file('[Content_Types].xml', CONTENT_TYPES),
    file('_rels/.rels', ROOT_RELS),
    file('word/document.xml', documentXml(blocks)),
    file('word/_rels/document.xml.rels', DOC_RELS),
    file('word/styles.xml', STYLES),
  ]);
}
