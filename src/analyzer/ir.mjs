// PLAN15 E — эх баримтын IR (`sources/ir.json`): догол мөрийн хуваалт, ишлэлийн хэвийн болголт, элементийн шалгалт, хамралт.
// Эх баримт = `sources/` доторх .md/.txt (E4: docx/xlsx/pdf → энд текстээр). Сервер эдгээрийг ноорогт хадгалж, задлахгүй.
import { parseElement } from './questions.mjs';

export const IR_FILE = 'sources/ir.json';
export const isSource = (f) => /^sources\/.+\.(md|txt)$/i.test(f);
const str = (v) => String(v ?? '').trim();

// текст → догол мөр [{n, line, text, section}]: хоосон мөрөөр тусгаарласан блок; жагсаалтын мөр бүр, хүснэгтийн өгөгдлийн мөр бүр тусдаа;
// гарчиг (#) нь хэсэг (section), догол мөр биш; код (```), <!-- --> алгасна
export function paragraphs(text) {
  const out = [];
  let section = '', cur = null, fence = false, comment = false, tableRow = 0;
  const flush = () => { if (cur && str(cur.text)) out.push({ ...cur, text: str(cur.text), n: out.length + 1 }); cur = null; };
  const ls = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  ls.forEach((raw, i) => {
    const line = i + 1, t = raw.trim();
    if (/^(```|~~~)/.test(t)) { flush(); fence = !fence; return; }
    if (fence) return;
    if (comment) { if (t.includes('-->')) comment = false; return; }
    if (t.startsWith('<!--')) { flush(); if (!t.includes('-->')) comment = true; return; }
    if (!t) { flush(); tableRow = 0; return; }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { flush(); section = h[2].trim(); tableRow = 0; return; }
    if (t.startsWith('|')) {
      flush();
      if (/^\|[\s:|-]+\|?$/.test(t)) return; // тусгаарлагч
      tableRow++;
      if (tableRow === 1 && /^\|[\s:|-]+\|?$/.test(str(ls[i + 1]))) return; // толгой мөр
      out.push({ n: out.length + 1, line, section, text: t.replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).map((c) => str(c).replace(/\\\|/g, '|')).filter(Boolean).join(' · ') });
      return;
    }
    tableRow = 0;
    if (/^([-*+]|\d+[.)])\s+/.test(t)) { flush(); cur = { line, section, text: t.replace(/^([-*+]|\d+[.)])\s+/, '') }; return; }
    if (cur) cur.text += ` ${t}`;
    else cur = { line, section, text: t };
  });
  flush();
  return out;
}

// ишлэл харьцуулах хэвийн хэлбэр: NFKC, жижиг үсэг, хашилт/онцлох тэмдэг хасна, зураас нэгтгэнэ, ө/ү-ийн латин ба бусад хувилбар, үл үзэгдэх тэмдэгт, хоосон зай
export function normalize(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[öőθɵӧ]/g, 'ө').replace(/[üűӱ]/g, 'ү').replace(/ё/g, 'е')
    .replace(/[«»“”„‟"'’‘‚`*_]/g, '')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ').trim();
}

const SRC = /^(.+)#¶([1-9][0-9]*)$/;
export function parseSource(s) { const m = SRC.exec(str(s)); return m ? { file: m[1], n: Number(m[2]) } : null; }

// эх баримтууд: {файл: [догол мөр]}
export function sourceUnits(model) {
  const o = {};
  for (const f of model.files) if (isSource(f)) o[f] = paragraphs(model.source[f]);
  return o;
}

// sources/ir.json → {doc, error}
export function loadIr(model) {
  const t = model.source[IR_FILE];
  if (typeof t !== 'string') return { doc: null };
  try { return { doc: JSON.parse(t) }; } catch (e) { return { doc: null, error: String(e.message ?? e) } ; }
}
// JSON-ийн зам → мөр (ойролцоо: `"id": "<id>"`-ийн мөр)
export function irLine(model, id) {
  const ls = String(model.source[IR_FILE] ?? '').split('\n');
  const i = ls.findIndex((l) => l.includes(`"${id}"`));
  return i >= 0 ? i + 1 : 0;
}

// загварын элемент байгаа эсэх (бусад төрөл — шалгахгүй, true)
export function elementExists(model, el) {
  const e = parseElement(el);
  const machine = (n) => model.machines.find((m) => m.name === n);
  switch (e.kind) {
    case 'table': return model.tables.has(e.table);
    case 'column': return !!model.tables.get(e.table)?.columns.some((c) => c.name === e.column);
    case 'machine': return !!machine(e.machine);
    case 'state': return !!machine(e.machine)?.states.some((s) => s.name === e.state);
    case 'transition': return !!machine(e.machine)?.transitions.some((t) => t.caption === e.caption && (!e.from || t.from === e.from));
    case 'role': return model.roles.some((r) => r.role?.toLowerCase() === str(e.name).toLowerCase());
    case 'requirement': return model.requirements.some((r) => r.id === e.name);
    case 'file': return model.files.includes(e.name.replace(/#.*$/, ''));
    default: return true;
  }
}

// хамралт (E3): догол мөр бүр ≥ 1 IR элементэд эсвэл ignored-д
export function irCoverage(model) {
  const units = sourceUnits(model);
  const files = Object.keys(units);
  if (!files.length) return null;
  const { doc } = loadIr(model);
  const cited = new Set(), ign = new Set();
  for (const it of doc?.items ?? []) { const s = parseSource(it?.source); if (s) cited.add(`${s.file}#${s.n}`); }
  for (const g of doc?.ignored ?? []) { const s = parseSource(g?.source); if (s) ign.add(`${s.file}#${s.n}`); }
  let total = 0, covered = 0, ignored = 0;
  const uncovered = [];
  for (const f of files) for (const u of units[f]) {
    total++;
    const k = `${f}#${u.n}`;
    if (cited.has(k)) covered++;
    else if (ign.has(k)) ignored++;
    else uncovered.push({ file: f, n: u.n, line: u.line, section: u.section, text: u.text });
  }
  const denom = total - ignored;
  return { files, total, covered, ignored, ratio: denom ? covered / denom : 1, uncovered, hasIr: !!doc };
}
