// Text from Office files (.docx, .pptx, .xlsx) in the browser, so the agents
// can read pitch decks, memos and models. These formats are ZIP archives of
// XML: this reads the archive with the browser's own DecompressionStream and
// parses the XML with DOMParser. No library, nothing uploaded for parsing.
// Legacy binary formats (.doc, .ppt, .xls) are not supported.

const MAX_CHARS = 400000;
const MAX_ROWS = 5000;

// ---------------------------------------------------------------------------
// ZIP

async function inflate(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Map of entry name -> () => Promise<Uint8Array>. */
export function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error(`Unsupported compression in ${name}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function xml(entries, name) {
  const get = entries.get(name);
  if (!get) return null;
  return new DOMParser().parseFromString(new TextDecoder().decode(await get()), 'application/xml');
}

const byTag = (node, tag) => Array.from(node.getElementsByTagName(tag));
const num = (s) => Number((s.match(/(\d+)\.xml$/) || [])[1] || 0);

// ---------------------------------------------------------------------------
// Formats

function paragraphs(doc, para, run) {
  return byTag(doc, para).map((p) => byTag(p, run).map((t) => t.textContent).join('')).filter((t) => t.trim());
}

async function docx(entries) {
  const out = [];
  const body = await xml(entries, 'word/document.xml');
  if (body) out.push(...paragraphs(body, 'w:p', 'w:t'));
  for (const name of [...entries.keys()].filter((n) => /^word\/(footnotes|endnotes)\.xml$/.test(n))) {
    const doc = await xml(entries, name);
    if (doc) out.push(...paragraphs(doc, 'w:p', 'w:t'));
  }
  return out.join('\n');
}

async function pptx(entries) {
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out = [];
  for (const name of slides) {
    const n = num(name);
    const slide = await xml(entries, name);
    const text = slide ? paragraphs(slide, 'a:p', 'a:t') : [];
    const notesDoc = await xml(entries, `ppt/notesSlides/notesSlide${n}.xml`);
    // Speaker notes often carry the numbers the slide only hints at. Drop the
    // slide-number placeholder that every notes page repeats.
    const notes = notesDoc ? paragraphs(notesDoc, 'a:p', 'a:t').filter((t) => t.trim() !== String(n)) : [];
    if (!text.length && !notes.length) continue;
    out.push(`Slide ${n}\n${text.join('\n')}${notes.length ? `\nSpeaker notes: ${notes.join(' ')}` : ''}`);
  }
  return out.join('\n\n');
}

async function xlsx(entries) {
  const shared = [];
  const ss = await xml(entries, 'xl/sharedStrings.xml');
  if (ss) byTag(ss, 'si').forEach((si) => shared.push(byTag(si, 't').map((t) => t.textContent).join('')));
  const wb = await xml(entries, 'xl/workbook.xml');
  const rels = await xml(entries, 'xl/_rels/workbook.xml.rels');
  const target = {};
  if (rels) byTag(rels, 'Relationship').forEach((r) => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const sheets = wb ? byTag(wb, 'sheet').map((s) => {
    const t = target[s.getAttribute('r:id')] || '';
    return { name: s.getAttribute('name'), path: t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}` };
  }) : [];
  const out = [];
  let rowsLeft = MAX_ROWS;
  for (const sheet of sheets) {
    const doc = await xml(entries, sheet.path);
    if (!doc || rowsLeft <= 0) continue;
    const lines = [];
    for (const row of byTag(doc, 'row')) {
      if (rowsLeft <= 0) break;
      const cells = byTag(row, 'c').map((c) => {
        const type = c.getAttribute('t');
        if (type === 'inlineStr') return byTag(c, 't').map((t) => t.textContent).join('');
        const v = byTag(c, 'v')[0];
        if (!v) return '';
        return type === 's' ? (shared[Number(v.textContent)] ?? '') : v.textContent;
      });
      if (cells.some((x) => String(x).trim())) { lines.push(cells.join('\t')); rowsLeft -= 1; }
    }
    if (lines.length) out.push(`Sheet: ${sheet.name}\n${lines.join('\n')}`);
  }
  return out.join('\n\n');
}

const READERS = { docx, pptx, xlsx };

export const officeKinds = Object.keys(READERS);

/** Text from a .docx, .pptx or .xlsx file; '' for anything else. */
export async function officeText(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  const read = READERS[ext];
  if (!read) return '';
  const entries = readZip(await file.arrayBuffer());
  return (await read(entries)).slice(0, MAX_CHARS);
}
