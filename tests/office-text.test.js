import { describe, expect, it } from 'vitest';
import { officeText } from '../src/lib/office-text.js';

// Minimal ZIP writer: entries stored (method 0) or deflated (method 8).
async function deflate(bytes) {
  const s = new Response(bytes).body.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function zip(files, { compress = true } = {}) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = compress ? await deflate(raw) : raw;
    const nameB = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, compress ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameB.length, true);
    locals.push(new Uint8Array(local.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, compress ? 8 : 0, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

describe('office text', () => {
  it('reads Word paragraphs, entities included', async () => {
    const z = await zip({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Revenue grew </w:t></w:r><w:r><w:t>40% &amp; churn fell</w:t></w:r></w:p><w:p><w:r><w:t>Runway: 9 months</w:t></w:r></w:p></w:body></w:document>` });
    expect(await officeText(file('memo.docx', z))).toBe('Revenue grew 40% & churn fell\nRunway: 9 months');
  });

  it('reads slides in order with speaker notes, stored or deflated', async () => {
    for (const compress of [true, false]) {
      const slide = (t) => `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
      const z = await zip({
        'ppt/slides/slide10.xml': slide('Ask: £2m'),
        'ppt/slides/slide2.xml': slide('Traction'),
        'ppt/notesSlides/notesSlide2.xml': `<p:notes ${A}><a:p><a:r><a:t>ARR £480k, 12% MoM</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>`,
      }, { compress });
      expect(await officeText(file('deck.pptx', z))).toBe('Slide 2\nTraction\nSpeaker notes: ARR £480k, 12% MoM\n\nSlide 10\nAsk: £2m');
    }
  });

  it('reads every sheet with shared and inline strings', async () => {
    const z = await zip({
      'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="P&amp;L" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Revenue</t></si><si><r><t>Burn</t></r><r><t> rate</t></r></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>120000</v></c></row><row><c t="s"><v>1</v></c><c t="inlineStr"><is><t>-40k</t></is></c></row><row><c/></row></sheetData></worksheet>',
    });
    expect(await officeText(file('model.xlsx', z))).toBe('Sheet: P&L\nRevenue\t120000\nBurn rate\t-40k');
  });

  it('ignores formats it does not read', async () => {
    expect(await officeText(file('old.doc', new Uint8Array(4)))).toBe('');
  });
});
