// PLAN15 A3 — DMN шийдвэрийн хүснэгтийн хамрах хүрээ (`*.dmn`): давхцал (UNIQUE), цоорхой, далдлагдсан дүрэм (FIRST).
// Нүдний дүрэм серверийнхтэй ижил (cgi/src/decision/Decision.cpp `entryToExpression`): `-`/хоосон — дурын; таслалаар «эсвэл»; `null`;
// `not(…)`; `<= >= != == < > =` + литерал; муж `[a..b] (a..b) [a..b) (a..b] ]a..b[`; бусад — тэнцүү.
// Арга нь яг (exhaustive): оролт бүрийн домэйныг нүднүүдийн бүх литерал хилээр элементар хэсэгт хуваана (хил бүр, хоёр хилийн
// дундах цэг, хамгийн бага/их хилээс цааш; текстэд литерал бүр + «бусад»; boolean-д true/false). Хэсэг бүрт нүд бүр нэгэн жигд үнэн эсвэл худал тул
// төлөөлөгч утгуудын бүх хослолыг шалгах нь бүх утгыг шалгахтай тэнцүү. Сервер мөн ижил аргаар (D3, хэрэгжүүлсний дараа засварлагчид) шалгадаг —
// энэ нь зохиох үед (сервергүй) гаргана. Литерал биш хилтэй (`> record.Хязгаар`) нүд байвал тэр хүснэгтийг шинжлэхгүй (DMN-NOT-ANALYZED).
// `null` оролтыг шалгахгүй (сервер ч шалгадаггүй). Default output DMN файлаас импортлогддоггүй — цоорхой = `null` гаралт.
import { ref } from '../model.mjs';

const MAX_COMBOS = 20000;
const decode = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : ''; };
const textOf = (xml) => { const m = /<text>([\s\S]*?)<\/text>/.exec(xml ?? ''); return m ? decode(m[1]).trim() : ''; };

// DMN XML → [{id, name, hitPolicy, inputs: [{label, expr, typeRef}], outputs: [{label, name}], rules: [{id, order, inputs[], outputs[], line}], line}]
export function parseDmn(text) {
  const out = [];
  for (const d of text.matchAll(/<(?:dmn:)?decision\b([^>]*)>([\s\S]*?)<\/(?:dmn:)?decision>/g)) {
    const dt = /<(?:dmn:)?decisionTable\b([^>]*)>([\s\S]*?)<\/(?:dmn:)?decisionTable>/.exec(d[2]);
    if (!dt) continue;
    const base = d.index + d[0].indexOf(dt[0]);
    const inputs = [...dt[2].matchAll(/<(?:dmn:)?input\b([^>]*)>([\s\S]*?)<\/(?:dmn:)?input>/g)].map((m) => {
      const ie = /<(?:dmn:)?inputExpression\b([^>]*)>([\s\S]*?)<\/(?:dmn:)?inputExpression>/.exec(m[2]);
      return { label: attr(m[1], 'label') || attr(m[1], 'id'), expr: textOf(ie?.[2]), typeRef: attr(ie?.[1] ?? '', 'typeRef') };
    });
    const outputs = [...dt[2].matchAll(/<(?:dmn:)?output\b([^>]*?)\/?>/g)].map((m) => ({ label: attr(m[1], 'label'), name: attr(m[1], 'name') }));
    const rules = [...dt[2].matchAll(/<(?:dmn:)?rule\b([^>]*)>([\s\S]*?)<\/(?:dmn:)?rule>/g)].map((m, i) => ({
      id: attr(m[1], 'id') || `#${i + 1}`, order: i + 1, line: lineAt(text, base + dt[0].indexOf(m[0])),
      inputs: [...m[2].matchAll(/<(?:dmn:)?inputEntry\b[^>]*>([\s\S]*?)<\/(?:dmn:)?inputEntry>/g)].map((x) => textOf(x[1])),
      outputs: [...m[2].matchAll(/<(?:dmn:)?outputEntry\b[^>]*>([\s\S]*?)<\/(?:dmn:)?outputEntry>/g)].map((x) => textOf(x[1])),
    }));
    const hp = (attr(dt[1], 'hitPolicy') || 'UNIQUE').toUpperCase();
    out.push({ id: attr(d[1], 'id'), name: attr(d[1], 'name') || attr(d[1], 'id'), hitPolicy: hp, inputs, outputs, rules, line: lineAt(text, d.index) });
  }
  return out;
}

// ---- нүд → таамаглагч (predicate) ба литерал хилүүд
// Серверийн `splitTopLevel`-тэй яг ижил: хашилт ба `(`/`[` … `)`/`]`-ийн гаднах таслалаар
function splitTop(s) {
  const parts = [];
  let cur = '', q = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && i + 1 < s.length) cur += s[++i]; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

// литерал → {kind: 'number'|'string'|'boolean', v} | null (литерал биш)
function literal(raw) {
  const s = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'number', v: Number(s) };
  if (/^"(?:[^"\\]|\\.)*"$/.test(s) || /^'(?:[^'\\]|\\.)*'$/.test(s)) return { kind: 'string', v: s.slice(1, -1).replace(/\\(.)/g, '$1') };
  if (s === 'true' || s === 'false') return { kind: 'boolean', v: s === 'true' };
  return null;
}

class Dynamic extends Error {}
const cmp = (op, a, b) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : op === '!=' ? a !== b : a === b);

// → {test(v) → bool, lits: [{kind, v}]}; литерал биш бол Dynamic
export function compileEntry(entry) {
  const e = String(entry ?? '').trim();
  if (!e || e === '-') return { test: () => true, lits: [], any: true };
  const parts = splitTop(e).map(compilePart);
  return { test: (v) => parts.some((p) => p.test(v)), lits: parts.flatMap((p) => p.lits), any: false };
}
function compilePart(p) {
  if (!p) throw new Dynamic('хоосон хэсэг');
  if (p === '-') return { test: () => true, lits: [] };
  if (p === 'null') return { test: (v) => v === null, lits: [] };
  if (p.startsWith('not(') && p.endsWith(')')) { const inner = compileEntry(p.slice(4, -1)); return { test: (v) => !inner.test(v), lits: inner.lits }; }
  for (const op of ['<=', '>=', '!=', '==', '<', '>', '=']) if (p.startsWith(op)) {
    const l = literal(p.slice(op.length));
    if (!l) throw new Dynamic(p);
    const o = op === '=' ? '==' : op;
    return { test: (v) => v !== null && typeof v === typeof l.v && cmp(o, v, l.v), lits: [l] };
  }
  if ('[(]'.includes(p[0]) && '])['.includes(p[p.length - 1]) && p.includes('..')) {
    const dots = p.indexOf('..');
    const lo = literal(p.slice(1, dots)), hi = literal(p.slice(dots + 2, -1));
    if (!lo || !hi || lo.kind !== 'number' || hi.kind !== 'number') throw new Dynamic(p);
    const loOp = p[0] === '[' ? '>=' : '>', hiOp = p[p.length - 1] === ']' ? '<=' : '<';
    return { test: (v) => typeof v === 'number' && cmp(loOp, v, lo.v) && cmp(hiOp, v, hi.v), lits: [lo, hi] };
  }
  const l = literal(p);
  if (!l) throw new Dynamic(p);
  return { test: (v) => v === l.v, lits: [l] };
}

// багана бүрийн төлөөлөгч утгууд (элементар хэсэг бүрээс нэг); domain — ERD-ийн enum-ийн утгууд (байвал «бусад» утга боломжгүй)
function probes(lits, domain = null) {
  if (domain) {
    if (lits.some((l) => l.kind !== 'string')) return null;
    return [...new Set([...domain, ...lits.map((l) => l.v)])].sort().map((v) => ({ v, d: `"${v}"` }));
  }
  const kinds = new Set(lits.map((l) => l.kind));
  if (!lits.length) return [{ v: 0, d: 'дурын' }];
  if (kinds.size > 1) return null; // холимог төрөл — шинжилгээгүй
  const kind = [...kinds][0];
  if (kind === 'boolean') return [{ v: true, d: 'true' }, { v: false, d: 'false' }];
  if (kind === 'string') {
    const vals = [...new Set(lits.map((l) => l.v))].sort();
    return [...vals.map((v) => ({ v, d: `"${v}"` })), { v: '\u0000бусад', d: 'бусад утга' }];
  }
  const xs = [...new Set(lits.map((l) => l.v))].sort((a, b) => a - b);
  const out = [{ v: xs[0] - 1, d: `< ${xs[0]}` }];
  xs.forEach((x, i) => {
    out.push({ v: x, d: String(x) });
    if (i + 1 < xs.length) out.push({ v: (x + xs[i + 1]) / 2, d: `${x}..${xs[i + 1]} хооронд` });
  });
  out.push({ v: xs[xs.length - 1] + 1, d: `> ${xs[xs.length - 1]}` });
  return out;
}

// `record.<Багана>` оролтын enum домэйн: тэр нэртэй багана бүхий бүх хүснэгтэд enum бол утгуудын нэгдэл, эс бөгөөс null
export function enumDomain(model, expr) {
  const m = /^record\.(.+)$/.exec(String(expr ?? '').trim());
  if (!m || !model) return null;
  const cols = [...model.tables.values()].map((t) => t.columns.find((c) => c.name === m[1].trim())).filter(Boolean);
  if (!cols.length || !cols.every((c) => Array.isArray(c.enumValues) && c.enumValues.length)) return null;
  return [...new Set(cols.flatMap((c) => c.enumValues.map(String)))];
}

// → {cells[rule][col], probes[col]} | {skip: шалтгаан}
export function compileTable(t, model = null) {
  const cells = [];
  try {
    for (const r of t.rules) cells.push(t.inputs.map((_, i) => compileEntry(r.inputs[i] ?? '-')));
  } catch (e) {
    if (e instanceof Dynamic) return { skip: `литерал биш хил «${e.message}»` };
    throw e;
  }
  const P = t.inputs.map((inp, i) => probes(cells.flatMap((row) => row[i].lits), enumDomain(model, inp.expr)));
  const bad = P.findIndex((p) => p === null);
  if (bad >= 0) return { skip: `оролт «${t.inputs[bad].label}»-д холимог төрлийн утга` };
  const combos = P.reduce((a, p) => a * p.length, 1);
  if (combos > MAX_COMBOS) return { skip: `хослол ${combos} > ${MAX_COMBOS}` };
  return { cells, probes: P, combos };
}

// бүх хослолоор: тохирох дүрмийн дугаарууд
function* matches(c) {
  const idx = c.probes.map(() => 0);
  for (let n = 0; n < c.combos; n++) {
    const point = idx.map((k, i) => c.probes[i][k]);
    const hit = [];
    c.cells.forEach((row, r) => { if (row.every((cell, i) => cell.test(point[i].v))) hit.push(r); });
    yield { point, hit };
    for (let i = 0; i < idx.length; i++) { if (++idx[i] < c.probes[i].length) break; idx[i] = 0; }
  }
}

export const decisionsCheck = {
  id: 'decisions', layer: 'A3',
  run(model, emit) {
    for (const f of model.dmn) for (const t of parseDmn(f.text)) {
      const el = ref.decision(f.file, t.name);
      if (!t.rules.length || !t.inputs.length) continue;
      const c = compileTable(t, model);
      if (c.skip) {
        emit({ code: 'DMN-NOT-ANALYZED', element: el, file: f.file, line: t.line, message: `шийдвэр «${t.name}»: хамрах хүрээг шинжлээгүй — ${c.skip}` });
        continue;
      }
      const policy = t.hitPolicy[0]; // U, F, A, P, C, R, O (сервер эхний үсгээр)
      const desc = (point) => point.map((p, i) => `${t.inputs[i].label} = ${p.d}`).join(', ');
      const gaps = [], overlaps = new Map(), fired = new Set(), matchedAny = new Set();
      let gapCount = 0;
      for (const { point, hit } of matches(c)) {
        if (!hit.length) { gapCount++; if (gaps.length < 3) gaps.push(desc(point)); continue; }
        hit.forEach((h) => matchedAny.add(h));
        if (policy === 'F') fired.add(hit[0]); else hit.forEach((h) => fired.add(h));
        if (policy === 'U' && hit.length > 1) { const k = hit.join(','); if (!overlaps.has(k)) overlaps.set(k, desc(point)); }
      }
      // DMN-OVERLAP: UNIQUE-д нэг оролтод олон дүрэм — сервер үнэлэхэд алдаа буцаана
      for (const [k, example] of overlaps) {
        const rs = k.split(',').map(Number).map((i) => t.rules[i]);
        emit({ code: 'DMN-OVERLAP', element: el, discriminator: rs.map((r) => r.id).join('+'), file: f.file, line: rs[1].line,
          message: `шийдвэр «${t.name}» (UNIQUE): дүрэм ${rs.map((r) => `#${r.order}`).join(', ')} зэрэг тохирно, жишээ [${example}] — үнэлэхэд алдаа гарна`,
          evidence: rs.map((r) => ({ file: f.file, line: r.line })),
          fix: 'нүдний мужийг давхцахгүй болгох (жишээ `< 5000000` ба `>= 5000000`), эсвэл давхцал санаатай бол hitPolicy="FIRST"' });
      }
      // DMN-GAP: ямар ч дүрэм тохирохгүй оролт — `null` гаралт
      if (policy !== 'C' && gaps.length)
        emit({ code: 'DMN-GAP', element: el, file: f.file, line: t.line,
          message: `шийдвэр «${t.name}»: ${gapCount} хэсэгт ямар ч дүрэм тохирохгүй (гаралт null), жишээ: ${gaps.map((g) => `[${g}]`).join('; ')}`,
          fix: 'дутуу мужид дүрэм нэмэх, эсвэл сүүлд бүх оролт нь `-` «бусад» дүрэм (FIRST) нэмнэ' });
      // DMN-SHADOWED: FIRST-д өмнөх дүрмүүд бүрэн далдалсан дүрэм — хэзээ ч ажиллахгүй (UNIQUE-д ижил хамрах хүрээ = давхцал)
      // DMN-NEVER-MATCHES: ямар ч оролтод тохирохгүй дүрэм (нүднүүд хоорондоо зөрчилтэй, жишээ `> 5` ба `< 3` нэг нүдэнд биш — олон оролтын хослолд)
      for (let r = 0; r < t.rules.length; r++) {
        const rule = t.rules[r];
        if (!matchedAny.has(r)) emit({ code: 'DMN-NEVER-MATCHES', element: el, discriminator: rule.id, file: f.file, line: rule.line,
          message: `шийдвэр «${t.name}»: дүрэм #${rule.order} ямар ч оролтод тохирохгүй`, fix: `дүрэм #${rule.order}-ийн нүдийг засах эсвэл хасна` });
        else if (policy === 'F' && !fired.has(r)) emit({ code: 'DMN-SHADOWED', element: el, discriminator: rule.id, file: f.file, line: rule.line,
          message: `шийдвэр «${t.name}» (FIRST): дүрэм #${rule.order} хэзээ ч ажиллахгүй — өмнөх дүрмүүд түүний бүх оролтыг хамарсан`,
          fix: `дүрэм #${rule.order}-ийг өмнө нь шилжүүлэх эсвэл хасна` });
      }
    }
  },
};
