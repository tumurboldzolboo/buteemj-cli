// PLAN15 E4 — эх баримт задлах (локал, сервер рүү илгээхгүй, гадны сангүй): docx / xlsx → Markdown (sources/*.md), md/txt — шууд.
// ZIP: stored/deflate (node:zlib). Хамгаалалт (cgi/src/integration/Xlsx.cpp-тэй ижил): zip64 ба шифрлэлт дэмжихгүй, нэг entry ≤ 30MB,
// нийт задлал ≤ 60MB, шахалтын харьцаа ≤ 200 (zip bomb). XML-ийг regex-ээр уншина — DTD/гадаад entity ачаалахгүй (зөвхөн 5 стандарт + тоон entity).
// PDF: pdfjs-dist@6.5.438 (PLAN15 [З] 2026-11-22) — хэрэгтэй үед л динамик ачаална (суугаагүй бол тодорхой алдаа); eval хаалттай, ≤ 30MB, ≤ 1000 хуудас.
import { inflateRawSync } from 'node:zlib';

const MAX_ENTRY = 30 * 1024 * 1024, MAX_TOTAL = 60 * 1024 * 1024, MAX_RATIO = 200;

// ---- ZIP
export function readZip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP биш');
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP-ийн төгсгөл (EOCD) алга');
  const count = b.readUInt16LE(eocd + 10), cdOff = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error('zip64 дэмжихгүй');
  const entries = new Map();
  let p = cdOff, total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-ийн төв лавлах эвдэрхий');
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString('utf8');
    p += 46 + nl + xl + cl;
    if (flags & 1) throw new Error('шифрлэгдсэн ZIP дэмжихгүй');
    if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) throw new Error('zip64 дэмжихгүй');
    if (name.endsWith('/')) continue;
    entries.set(name, { method, csize, usize, off });
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.usize > MAX_ENTRY) throw new Error(`${name}: ${MAX_ENTRY / 1048576}MB-аас их`);
    if (e.csize && e.usize / e.csize > MAX_RATIO) throw new Error(`${name}: шахалтын харьцаа ${MAX_RATIO}-аас их`);
    if (b.readUInt32LE(e.off) !== 0x04034b50) throw new Error(`${name}: local header эвдэрхий`);
    const start = e.off + 30 + b.readUInt16LE(e.off + 26) + b.readUInt16LE(e.off + 28);
    const raw = b.subarray(start, start + e.csize);
    let out;
    if (e.method === 0) out = Buffer.from(raw);
    else if (e.method === 8) out = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
    else throw new Error(`${name}: шахалтын арга ${e.method} дэмжихгүй`);
    total += out.length;
    if (total > MAX_TOTAL) throw new Error(`нийт задлал ${MAX_TOTAL / 1048576}MB-аас их`);
    return out.toString('utf8');
  };
  return { names: [...entries.keys()], read };
}

// ---- XML (хялбар)
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()]));
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : null; };
// дээд түвшний <tag>…</tag> блокууд (ижил нэртэй үүрлэлтийг тоолно)
function blocks(xml, tag) {
  const out = [], open = new RegExp(`<${tag}(?=[\\s>/])`, 'g');
  let m;
  while ((m = open.exec(xml))) {
    const gt = xml.indexOf('>', m.index);
    if (xml[gt - 1] === '/') { out.push({ start: m.index, end: gt + 1, xml: xml.slice(m.index, gt + 1) }); continue; }
    let depth = 1, i = gt + 1;
    const re = new RegExp(`<${tag}(?=[\\s>/])|</${tag}>`, 'g');
    re.lastIndex = i;
    let t;
    while (depth && (t = re.exec(xml))) {
      if (t[0].startsWith('</')) depth--;
      else { const g = xml.indexOf('>', t.index); if (xml[g - 1] !== '/') depth++; }
      i = re.lastIndex;
    }
    out.push({ start: m.index, end: i, xml: xml.slice(m.index, i) });
    open.lastIndex = i;
  }
  return out;
}
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const mdTable = (rows) => {
  const w = Math.max(0, ...rows.map((r) => r.length));
  if (!w) return [];
  const pad = (r) => [...r, ...Array(w - r.length).fill('')].map(cell);
  return [`| ${pad(rows[0]).join(' | ')} |`, `|${' --- |'.repeat(w)}`, ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)];
};

// ---- DOCX → Markdown: гарчиг (Heading N / Title), жагсаалт (numPr), хүснэгт; догол бүр хоосон мөрөөр тусгаарлагдана (ir.mjs paragraphs-тэй нийцнэ)
export function docxToMarkdown(buf) {
  const z = readZip(buf);
  const doc = z.read('word/document.xml');
  if (!doc) throw new Error('word/document.xml алга — docx биш');
  const styles = new Map();
  for (const s of blocks(z.read('word/styles.xml') ?? '', 'w:style')) {
    const id = attr(s.xml.slice(0, s.xml.indexOf('>') + 1), 'w:styleId');
    const nm = /<w:name\s+w:val="([^"]*)"/.exec(s.xml)?.[1] ?? '';
    const ol = /<w:outlineLvl\s+w:val="(\d)"/.exec(s.xml)?.[1];
    const lname = decode(nm).toLowerCase();
    if (id) styles.set(id, { name: lname, outline: ol === undefined ? null : Number(ol), list: /<w:numPr>/.test(s.xml) || /^(list (bullet|number)|list paragraph|жагсаалт)/.test(lname) });
  }
  const level = (pPr) => {
    const id = /<w:pStyle\s+w:val="([^"]*)"/.exec(pPr)?.[1];
    const direct = /<w:outlineLvl\s+w:val="(\d)"/.exec(pPr)?.[1];
    if (direct !== undefined) return Number(direct) + 1;
    if (!id) return 0;
    const st = styles.get(id);
    const name = st?.name ?? id.toLowerCase();
    if (name === 'title') return 1;
    const h = /^(?:heading|гарчиг)\s*(\d)$/.exec(name) ?? /^heading(\d)$/.exec(id.toLowerCase());
    if (h) return Math.min(6, Number(h[1]));
    return st?.outline !== null && st?.outline !== undefined ? st.outline + 1 : 0;
  };
  const ptext = (p) => decode((p.replace(/<w:(tab|br|cr)\b[^>]*\/>/g, '<w:t> </w:t>').replace(/<w:delText\b[^>]*>[^<]*<\/w:delText>/g, '')
    .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).replace(/\s+/g, ' ').trim();
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  const tbls = blocks(body, 'w:tbl');
  const out = [];
  const paras = (seg) => {
    for (const p of blocks(seg, 'w:p')) {
      const t = ptext(p.xml);
      if (!t) continue;
      const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p.xml)?.[0] ?? '';
      const lv = level(pPr);
      const sid = /<w:pStyle\s+w:val="([^"]*)"/.exec(pPr)?.[1];
      out.push(lv ? `${'#'.repeat(lv)} ${t}` : /<w:numPr>/.test(pPr) || styles.get(sid)?.list ? `- ${t}` : t, '');
    }
  };
  let at = 0;
  for (const t of tbls) {
    paras(body.slice(at, t.start));
    const rows = blocks(t.xml.slice(t.xml.indexOf('>') + 1), 'w:tr').map((r) => blocks(r.xml, 'w:tc').map((c) => blocks(c.xml, 'w:p').map((p) => ptext(p.xml)).filter(Boolean).join(' ')))
      .filter((r) => r.some(Boolean));
    if (rows.length) out.push(...mdTable(rows), '');
    at = t.end;
  }
  paras(body.slice(at));
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---- XLSX → Markdown: sheet бүр «## <нэр>» + хүснэгт (эхний мөр — толгой); хоосон мөр алгасна
export function xlsxToMarkdown(buf) {
  const z = readZip(buf);
  const wb = z.read('xl/workbook.xml');
  if (!wb) throw new Error('xl/workbook.xml алга — xlsx биш');
  const rels = new Map();
  for (const r of (z.read('xl/_rels/workbook.xml.rels') ?? '').match(/<Relationship\b[^>]*>/g) ?? []) rels.set(attr(r, 'Id'), attr(r, 'Target'));
  const shared = blocks(z.read('xl/sharedStrings.xml') ?? '', 'si').map((s) => decode((s.xml.match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  const col = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const out = [];
  for (const s of wb.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = attr(s, 'name') ?? 'Sheet', rid = attr(s, 'r:id');
    let target = rels.get(rid) ?? '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = z.read(target);
    if (!xml) continue;
    const rows = [];
    for (const r of blocks(xml, 'row')) {
      const row = [];
      for (const c of blocks(r.xml, 'c')) {
        const head = c.xml.slice(0, c.xml.indexOf('>') + 1), t = attr(head, 't');
        const v = /<v>([^<]*)<\/v>/.exec(c.xml)?.[1];
        const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? decode((c.xml.match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, '')).join(''))
          : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : decode(v ?? '');
        row[col(attr(head, 'r') ?? `${String.fromCharCode(65 + row.length)}`)] = val;
      }
      const filled = Array.from(row, (x) => x ?? '');
      if (filled.some((x) => String(x).trim())) rows.push(filled);
    }
    if (!rows.length) continue;
    out.push(`## ${name}`, '', ...mdTable(rows), '');
  }
  return `${out.join('\n').trim()}\n`;
}

// ---- PDF → Markdown (текст давхаргаас; скан зураг — OCR-гүй тул текстгүй): мөрийг y-ээр, догол мөрийг босоо зайгаар,
// гарчгийг үсгийн өндрөөр (≥ 1.3 × голч, богино мөр), жагсаалтыг тэмдгээр (•, ●, ▪, -, –, 1. 1)) таньна; хуудасны дугаар мөрийг хасна
export const PDFJS = 'pdfjs-dist/legacy/build/pdf.mjs';
const MAX_PDF = 30 * 1024 * 1024, MAX_PAGES = 1000;
export async function pdfToMarkdown(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('PDF биш');
  if (b.length > MAX_PDF) throw new Error(`PDF ${MAX_PDF / 1048576}MB-аас их`);
  let pdfjs;
  try { const spec = PDFJS; pdfjs = await import(spec); }
  catch { throw new Error('PDF: pdfjs-dist суугаагүй (`npm i pdfjs-dist@6.5.438`; Node ≥ 22.13) — эсвэл текст болгож .txt-ээр нэмнэ'); }
  const task = pdfjs.getDocument({ data: new Uint8Array(b), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, stopAtErrors: false });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) throw new Error(`PDF ${doc.numPages} хуудас (≤ ${MAX_PAGES})`);
    const lines = []; // {text, h, y, page}
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let cur = null;
      const push = () => { if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.replace(/\s+/g, ' ').trim() }); cur = null; };
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform?.[5] ?? 0, h = Math.abs(it.height || it.transform?.[3] || 0);
        if (cur && Math.abs(cur.y - y) > Math.max(2, Math.min(cur.h || h, h || cur.h) * 0.5)) push();
        if (!cur) cur = { text: '', h, y, page: n };
        cur.text += it.str; cur.h = Math.max(cur.h, h);
        if (it.hasEOL) push();
      }
      push();
      page.cleanup();
    }
    const hs = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
    const body = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
    const out = [];
    let para = null, prev = null;
    const flush = () => { if (para) out.push(para.text, ''); para = null; };
    for (const l of lines) {
      if (/^\d{1,4}$/.test(l.text) || /^(page|хуудас)\s*\d+(\s*(\/|of)\s*\d+)?$/i.test(l.text)) continue; // хуудасны дугаар
      const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
      const bullet = /^([•●▪◦‣∙·]|[-–—]\s|\d{1,3}[.)]\s)/.exec(l.text);
      const heading = body && l.h >= body * 1.3 && l.text.length <= 120;
      if (heading) { flush(); out.push(`${l.h >= body * 1.8 ? '#' : '##'} ${l.text}`, ''); prev = l; continue; }
      if (bullet) { flush(); para = { text: `- ${l.text.replace(/^([•●▪◦‣∙·]\s*|[-–—]\s+|\d{1,3}[.)]\s+)/, '')}` }; prev = l; continue; }
      const lh = Math.max(l.h, prev?.h ?? 0) || body || 10;
      if (para && gap <= lh * 1.6) {
        // мөрийн төгсгөлийн тасархай (үг-\nүг): дараагийн мөр жижиг үсгээр эхэлбэл тасархайг хасаж нийлүүлнэ
        if (/\p{L}-$/u.test(para.text) && /^\p{Ll}/u.test(l.text)) para.text = para.text.slice(0, -1) + l.text;
        else para.text += ` ${l.text}`;
      }
      else { flush(); para = { text: l.text }; }
      prev = l;
    }
    flush();
    const md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!md) throw new Error('PDF-д текст давхарга алга (скан зураг байж магадгүй — OCR дэмжихгүй)');
    return `${md}\n`;
  } finally { await task.destroy(); }
}

// async: PDF-ийг оролцуулна
export async function extractSourceAsync(name, buf) {
  if (String(name).toLowerCase().endsWith('.pdf')) return { kind: 'pdf', markdown: await pdfToMarkdown(buf) };
  return extractSource(name, buf);
}

// файлын нэр + байт → {markdown, kind} (sync — PDF-д extractSourceAsync)
export function extractSource(name, buf) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'docx') return { kind: 'docx', markdown: docxToMarkdown(buf) };
  if (ext === 'xlsx') return { kind: 'xlsx', markdown: xlsxToMarkdown(buf) };
  if (ext === 'md' || ext === 'txt') return { kind: ext, markdown: Buffer.from(buf).toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n') };
  if (ext === 'pdf') throw new Error('PDF: extractSourceAsync ашиглана');
  throw new Error(`«.${ext}» дэмжихгүй (docx, xlsx, pdf, md, txt)`);
}
