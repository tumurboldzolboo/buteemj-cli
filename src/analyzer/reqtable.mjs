// PLAN15 D5 — стандарт бус шаардлагын хүснэгт (sources/*.md — docx/xlsx/pdf-ээс) → стандарт `requirements.md` мөр + IR холбоос.
// Багана: синонимоор (ID, Төрөл, Шаардлага, Эрэмбэ, Холбоос) — гараар дарж болно (`map`). Төрөл → Ө/П/Д/Дэ/Э/Т, эрэмбэ → 1–3 (MoSCoW, өндөр/дунд/бага …).
// Таньж чадаагүй утгыг текстээс таамаглаж `inferred`-д тэмдэглэнэ (IR-д assumed биш — эх нь бий; харин тайланд харуулна).
import { createHash } from 'node:crypto';
import { markdownTables, parseRequirements } from '../validator/parsers.mjs';
import { paragraphs, normalize } from './ir.mjs';
import { buildModel } from './model.mjs';
import { tag, vocabulary } from './cnl.mjs';

const str = (v) => String(v ?? '').trim();
const key = (s) => str(s).toLowerCase().replace(/[*_`"«»()[\].:]/g, '').replace(/\s+/g, ' ').trim();

export const COLUMNS = {
  id: ['id', '№', 'no', 'no.', '#', 'д/д', 'дд', 'дугаар', 'код', 'req id', 'шаардлагын дугаар', 'шаардлагын код', 'ref'],
  kind: ['төрөл', 'type', 'category', 'ангилал', 'шаардлагын төрөл', 'kind'],
  text: ['шаардлага', 'requirement', 'requirements', 'description', 'тайлбар', 'агуулга', 'текст', 'шаардлагын тайлбар', 'user story', 'функц', 'функционал шаардлага', 'шаардлагын агуулга', 'feature', 'тодорхойлолт'],
  priority: ['эрэмбэ', 'priority', 'ач холбогдол', 'чухал байдал', 'moscow', 'зэрэглэл', 'давуу байдал', 'чухлын зэрэг'],
  links: ['холбоос', 'link', 'links', 'trace', 'холбогдох', 'элемент', 'модуль', 'module', 'холбогдох элемент'],
};
export const KINDS = [
  ['Дэ', ['дэ', 'дэлгэц', 'ui', 'ux', 'screen', 'интерфейс', 'хэрэглэгчийн интерфейс', 'маягт', 'form']],
  ['Ө', ['ө', 'өгөгдөл', 'data', 'мэдээлэл', 'бүртгэл', 'entity', 'master data']],
  ['П', ['п', 'процесс', 'process', 'урсгал', 'workflow', 'бизнес процесс', 'ажлын урсгал']],
  ['Д', ['д', 'дүрэм', 'rule', 'business rule', 'бизнесийн дүрэм', 'нөхцөл', 'validation', 'шалгалт', 'тооцоо']],
  ['Э', ['э', 'эрх', 'permission', 'role', 'access', 'хандалт', 'эрхийн', 'security', 'аюулгүй байдал']],
  ['Т', ['т', 'тайлан', 'report', 'reporting', 'тайлагнал', 'dashboard']],
];
const PRIORITY = [
  ['1', /^(1|m|must|must have|заавал|өндөр|high|critical|чухал маш|нэн чухал|p1)$/],
  ['2', /^(2|s|should|should have|чухал|дунд|medium|normal|p2)$/],
  ['3', /^(3|c|w|could|could have|won'?t|хүсэлтэй|бага|low|nice to have|optional|p3|p4)$/],
];
// текстээс төрөл таамаглах (утгагүй/хоосон төрөлд)
const GUESS = [['Т', /тайлан|report/], ['Э', /эрх|хандах|зөвшөөр|permission/], ['Дэ', /дэлгэц|маягт|товч|харагдана|screen/], ['П', /батла|илгээ|шилж|процесс|урсгал|төлөв/], ['Ө', /бүртг|хадгал|талбар|мэдээлэл/]];

// хүснэгтийн толгой → {id, kind, text, priority, links} баганын индекс (−1 = алга); map: {text: 'Тайлбар', …} гараар
export function mapColumns(header, map = {}) {
  const H = header.map(key), out = {}, used = new Set();
  for (const [col, name] of Object.entries(map)) { const i = H.indexOf(key(name)); if (i >= 0) { out[col] = i; used.add(i); } }
  for (const pass of ['exact', 'contains']) for (const [col, syn] of Object.entries(COLUMNS)) {
    if (out[col] !== undefined) continue;
    // синонимын дарааллаар (эхнийх нь илүү тохиромжтой): «Шаардлага» ба «Тайлбар» хоёулаа байвал «Шаардлага»
    let i = -1;
    for (const s of syn) { i = H.findIndex((h, j) => !used.has(j) && (pass === 'exact' ? h === s : s.length > 2 && h.includes(s))); if (i >= 0) break; }
    if (i >= 0) { out[col] = i; used.add(i); }
  }
  for (const col of Object.keys(COLUMNS)) out[col] ??= -1;
  return out;
}
export function normKind(v, text) {
  const k = key(v);
  const hit = KINDS.find(([, syn]) => syn.includes(k)) ?? (k ? KINDS.find(([, syn]) => syn.some((s) => s.length > 2 && k.includes(s))) : null);
  if (hit) return { value: hit[0], inferred: false };
  const g = GUESS.find(([, re]) => re.test(str(text).toLowerCase()));
  return { value: g ? g[0] : 'Д', inferred: true };
}
export function normPriority(v) {
  const k = key(v);
  const hit = PRIORITY.find(([, re]) => re.test(k));
  return hit ? { value: hit[0], inferred: false } : { value: '2', inferred: true };
}

// эх файлын текст → [{index, header, map, rows: [{line, para, cells}]}] (шаардлагын текстийн багана таньсан хүснэгт л)
export function requirementTables(text, map = {}) {
  const ps = paragraphs(text);
  return markdownTables(text).map((t, index) => ({ index, header: t.header, headerLine: t.headerLine, map: mapColumns(t.header, map),
    rows: t.rows.filter((r) => r.cells.some(Boolean)).map((r) => ({ line: r.line, para: ps.find((p) => p.line === r.line)?.n ?? null, cells: r.cells })) }))
    .filter((t) => t.map.text >= 0);
}

const cellEsc = (s) => str(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
// files (багц), source (sources/x.md), opts {table: index|null, map} → {rows, requirements (шинэ текст), ir (шинэ IR текст), skipped, inferred, tables}
export function convertTable(files, source, opts = {}) {
  const text = files[source];
  if (typeof text !== 'string') throw new Error(`${source} алга`);
  const tables = requirementTables(text, opts.map ?? {});
  if (!tables.length) throw new Error(`${source}: шаардлагын текстийн багана (${COLUMNS.text.slice(0, 4).join(', ')} …) бүхий хүснэгт алга — --map=text=<баганын нэр>`);
  const pick = opts.table === undefined || opts.table === null ? tables : tables.filter((t) => t.index === Number(opts.table));
  if (!pick.length) throw new Error(`${source}: хүснэгт #${opts.table} алга (${tables.map((t) => `#${t.index}`).join(', ')})`);
  const REQ = opts.reqFile ?? 'requirements.md';
  const existing = parseRequirements(files[REQ] ?? '');
  const ids = new Set(existing.map((r) => r.id)), texts = new Map(existing.map((r) => [normalize(r.text), r.id]));
  const rnums = [...ids].map((id) => /^R(\d+)$/.exec(id)?.[1]).filter(Boolean);
  let n = Math.max(0, ...rnums.map(Number));
  const width = rnums.length ? Math.max(...rnums.map((x) => x.length)) : 2; // одоо байгаа хэв маяг (R07 / R042)
  // Холбоос хоосон бол текстээс загварын нэр (хүснэгт, төлөвийн машин, үүрэг) — таамаг
  const model = buildModel(files), V = vocabulary(model).filter((v) => ['table', 'role', 'state'].includes(v.kind));
  const suggest = (t) => [...new Set(tag(t, V).found.flatMap((f) => { const a = f.alts.find((x) => x.kind === 'table') ?? f.alts.find((x) => x.kind === 'state') ?? f.alts[0]; return a ? [a.kind === 'state' ? `${a.machine} [${a.name}]` : a.name] : []; }))].slice(0, 4);
  const rows = [], skipped = [], inferred = [];
  for (const t of pick) for (const r of t.rows) {
    const c = (col) => (t.map[col] >= 0 ? str(r.cells[t.map[col]]) : '');
    const body = c('text');
    if (!body) { skipped.push({ line: r.line, reason: 'шаардлагын текст хоосон', empty: r.para ? `${source}#¶${r.para}` : null }); continue; }
    const dup = texts.get(normalize(body));
    if (dup) { skipped.push({ line: r.line, reason: `аль хэдийн ${dup}`, id: dup, text: body, source: r.para ? `${source}#¶${r.para}` : null }); continue; }
    let id = c('id').replace(/\s+/g, '');
    if (!/^[\p{L}\p{N}_.-]{1,32}$/u.test(id) || ids.has(id) || /^\d+$/.test(id)) { // тоон дугаар (1, 2 …) нь багц дотор давхцах тул R-дугаар
      const old = id; id = `R${String(++n).padStart(width, '0')}`; while (ids.has(id)) id = `R${String(++n).padStart(width, '0')}`;
      if (old && !/^\d+$/.test(old)) inferred.push({ line: r.line, field: 'id', from: old, to: id });
    }
    ids.add(id); texts.set(normalize(body), id);
    const k = normKind(c('kind'), body), p = normPriority(c('priority'));
    if (k.inferred) inferred.push({ line: r.line, id, field: 'Төрөл', from: c('kind'), to: k.value });
    if (p.inferred) inferred.push({ line: r.line, id, field: 'Эрэмбэ', from: c('priority'), to: p.value });
    let links = c('links');
    if (!links) { const sg = suggest(body); if (sg.length) { links = sg.join(', '); inferred.push({ line: r.line, id, field: 'Холбоос', from: '', to: links }); } }
    rows.push({ id, kind: k.value, text: body, priority: p.value, links, source: r.para ? `${source}#¶${r.para}` : null, line: r.line });
  }
  // requirements.md
  const head = '| ID | Төрөл | Шаардлага | Эрэмбэ | Холбоос |\n|---|---|---|---|---|\n';
  const lines = rows.map((r) => `| ${r.id} | ${r.kind} | ${cellEsc(r.text)} | ${r.priority} | ${cellEsc(r.links)} |`);
  let req = files[REQ];
  if (!rows.length) req = req ?? null;
  else if (req === undefined || !existing.length) req = `${req && req.trim() ? `${req.trimEnd()}\n\n` : '# Шаардлага\n\n'}${head}${lines.join('\n')}\n`;
  else { // сүүлчийн шаардлагын мөрийн дараа
    const ls = req.split('\n'), last = Math.max(...existing.map((r) => r.line));
    ls.splice(last, 0, ...lines); req = ls.join('\n');
  }
  // IR: мөр бүр → requirement элемент, эх догол мөр, ишлэл = шаардлагын текст
  const IRF = 'sources/ir.json';
  let doc = { version: 1, items: [] };
  if (files[IRF] !== undefined) doc = JSON.parse(files[IRF]);
  const have = new Set((doc.items ?? []).map((x) => x.id));
  const KIND = { 'Ө': 'field', 'П': 'transition', 'Д': 'rule', 'Дэ': 'screen', 'Э': 'right', 'Т': 'report' };
  const linked = [...rows, ...skipped.filter((x) => x.id && x.source).map((x) => ({ id: x.id, kind: existing.find((e) => e.id === x.id)?.kind, text: x.text, source: x.source }))];
  const add = linked.filter((r) => r.source).map((r) => ({ id: `TBL-${createHash('sha256').update(`${r.source}\u0000${r.text}`).digest('hex').slice(0, 10)}`, kind: KIND[r.kind] ?? 'other',
    text: r.text, element: `requirement:${r.id}`, source: r.source, quote: r.text })).filter((x) => !have.has(x.id));
  const ign = new Set((doc.ignored ?? []).map((g) => g?.source));
  const addIgn = skipped.filter((x) => x.empty && !ign.has(x.empty)).map((x) => ({ source: x.empty, reason: 'шаардлагын текстгүй мөр (bj sources table)' }));
  const ir = add.length || addIgn.length ? `${JSON.stringify({ ...doc, version: 1, items: [...(doc.items ?? []), ...add], ...(addIgn.length || doc.ignored ? { ignored: [...(doc.ignored ?? []), ...addIgn] } : {}) }, null, 2)}\n` : files[IRF] ?? null;
  return { rows, requirements: req, ir, skipped, inferred, tables: pick.map((t) => ({ index: t.index, header: t.header, map: Object.fromEntries(Object.entries(t.map).map(([k, i]) => [k, i >= 0 ? t.header[i] : null])), rows: t.rows.length })) };
}
