// PLAN15 A4 — X0 предикатын зөрчил: шилжилтийн guard/`when`, баганын `requiredWhen`/`visibleWhen`/`validation` (erd.dbml note), DMN `record.<Багана>`.
//
// 1. X0-ENUM-LITERAL — enum баганыг enum-д байхгүй утгатай харьцуулсан (`Төрөл == "Ажилд авах"`, `in (…)`): нөхцөл хэзээ ч/үргэлж биелнэ (бичгийн алдаа).
//    Түүхий текстээр (хашилт ба нэрийн хил), предикат «энгийн» биш байсан ч шалгана.
// 2. Хангагдах эсэх (X0-NEVER-TRUE, X0-REQUIRED-HIDDEN, X0-GUARD-OVERLAP) — зөвхөн «энгийн» предикатад: хүснэгтийн өөрийн баганын нэр, литерал,
//    харьцуулалт (== != < <= > >=), and/or/not, in/not in, null, хаалт. FK зам, функц, today/now, `заавал`, `мөр бүрт`, `calc`, тооцоо (+ - * /) байвал
//    алгасна (серверийн `naturalGuard`/`translateExpr`-ийн нэр шийдлийг дуурайхгүй — plan-ийн `transition_guard` анхааруулга тэдгээрийг хамарна).
//    Нэрийг `v<i>` болгоод web/src/lib/expr.ts (сервертэй нэг семантик)-аар үнэлнэ. Домэйн: enum — утгууд; boolean — true/false; тоо — литерал хилүүд,
//    хил хоорондын ба хилээс цаашх k+1 цэг (k — тоон хувьсагчийн тоо, хувьсагч хоорондын дараалал ч яг хамрагдана); текст — литерал + «бусад»;
//    not null биш бол null. Ийм домэйнд үнэлэх нь бүх утгад үнэлэхтэй тэнцүү. Баганын validation-ыг `(багана == null or <validation>)` гэж нэмнэ.
import { ref } from '../model.mjs';
import { x0Evaluate } from '../x0eval.mjs';

const str = (v) => String(v ?? '').trim();
const MAX_COMBOS = 20000;
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'null', 'true', 'false']);
const LETTER = /[\p{L}\p{N}_]/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// хашилттай мөрийг §0, §1 … болгож нуух
function maskStrings(src) {
  const strings = [];
  const text = src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => { strings.push(m); return `§${strings.length - 1}§`; });
  return { text, strings };
}
const unmask = (t, strings) => t.replace(/§(\d+)§/g, (_, i) => strings[Number(i)]);
const unquote = (s) => s.slice(1, -1).replace(/\\(.)/g, '$1');

// багананы нэрийн байрлал: өмнө нь үсэг/тоо/`.` биш, ард нь үсэг/тоо/`.` биш (FK замыг багана гэж үзэхгүй)
const nameRe = (name) => new RegExp(`(?<![\\p{L}\\p{N}_.])${escapeRe(name)}(?![\\p{L}\\p{N}_.])`, 'gu');

// guard-ын ард «мессеж» — хэрэглэгчид харуулах (README states.mmd) — шинжилгээнд хамаарахгүй
const stripMessage = (g) => str(g).replace(/«[^»]*»\s*$/u, '').trim();

// validation note → X0 (баганын нэрээр) | null (regex/email/хэлбэр танигдахгүй)
export function validationExpr(col, v) {
  const s = str(v);
  if (!s || /^(regex|email|url|phone)\b/i.test(s)) return null;
  const range = /^range\s+(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/i.exec(s);
  if (range) return `${col} >= ${range[1]} and ${col} <= ${range[2]}`;
  if (/^(==|!=|>=|<=|>|<)/.test(s)) return `${col} ${s}`;
  return s;
}

// предикат → {expr, vars: [баганын нэр]} | {skip}; cols — хүснэгтийн баганууд (урт нэр эхэнд)
export function toSimple(text, cols) {
  const { text: masked, strings } = maskStrings(stripMessage(text));
  let t = masked;
  const vars = [];
  for (const c of cols) {
    const re = nameRe(c);
    if (!re.test(t)) continue;
    t = t.replace(nameRe(c), () => { if (!vars.includes(c)) vars.push(c); return ` v${vars.indexOf(c)} `; });
  }
  // `<Багана> заавал` → `v != null` (сервер naturalGuard: not empty(<Багана>); `!= null` нь сул — хоосон мөрийг ч зөвшөөрнө → X0-NEVER-TRUE-г цөөн гаргана, ХЭ биш)
  t = t.replace(/(v\d+)\s+заавал(?![\p{L}\p{N}_])/gu, '$1 != null');
  // үлдсэн үг: түлхүүр үг, v<i>, тоо, §<i>§-ээс бусад → энгийн биш
  const leftovers = t.replace(/§\d+§/g, ' ').split(/[^\p{L}\p{N}_.]+/u).filter((w) => w && LETTER.test(w) && !/^v\d+$/.test(w) && !/^-?\d+(\.\d+)?$/.test(w) && !KEYWORDS.has(w));
  if (leftovers.length) return { skip: `энгийн биш: ${leftovers.slice(0, 3).join(', ')}` };
  // тооцоо: + * / эсвэл хоёртын - (сөрөг литерал `< -5`, `(-1`, `, -2` зөвшөөрнө); хоосон хаалт `()` — функц
  const bare = t.replace(/§\d+§/g, ' ').replace(/(^|[<>=!(,]\s*)-(?=\s*\d)/g, '$1');
  if (/[+*/-]|\(\s*\)/.test(bare)) return { skip: 'тооцоо' };
  if (/(?<![<>=!])=(?!=)/.test(t)) return { skip: 'ганц `=`' };
  return { expr: unmask(t, strings).replace(/\s+/g, ' ').trim(), vars };
}

// литералууд (тоо, мөр) — v<i> бүрийн хувьд биш, бүх илэрхийллээс
function literals(exprs) {
  const nums = new Set(), strs = new Set();
  for (const e of exprs) {
    const { text, strings } = maskStrings(e);
    for (const s of strings) strs.add(unquote(s));
    for (const m of text.matchAll(/(?<![\p{L}\p{N}_])-?\d+(?:\.\d+)?(?![\p{L}\p{N}_])/gu)) nums.add(Number(m[0]));
  }
  return { nums: [...nums].sort((a, b) => a - b), strs: [...strs].sort() };
}

function domainOf(colMeta, lits, k) {
  const nullable = !(colMeta.required || colMeta.pk);
  const withNull = (xs) => (nullable ? [...xs, null] : xs);
  const t = colMeta.type;
  if (t === 'enum' && colMeta.enumValues?.length) return withNull(colMeta.enumValues.map(String));
  if (t === 'boolean') return withNull([true, false]);
  if (t === 'integer' || t === 'decimal') {
    const xs = lits.nums.length ? lits.nums : [0];
    const out = [];
    const step = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / (n + 1));
    out.push(...Array.from({ length: k + 1 }, (_, i) => xs[0] - (k + 1 - i)));
    xs.forEach((x, i) => { out.push(x); if (i + 1 < xs.length) out.push(...step(x, xs[i + 1], k + 1)); });
    out.push(...Array.from({ length: k + 1 }, (_, i) => xs[xs.length - 1] + i + 1));
    return withNull(out);
  }
  if (t === 'text' || t === 'longtext' || (t === '' && colMeta.ref)) return withNull([...lits.strs, '\u0000бусад']);
  return null; // огноо, файл … — дэмжихгүй
}

// exprs (бүгд and) хангагдах эсэх: {sat: bool, witness} | {skip}
export function satisfiable(exprs, vars, metaOf, evaluate) {
  const metas = vars.map((v) => metaOf.get(v));
  const lits = literals(exprs);
  const numeric = metas.filter((m) => m && (m.type === 'integer' || m.type === 'decimal')).length;
  const doms = metas.map((m) => (m ? domainOf(m, lits, numeric) : null));
  if (doms.some((d) => d === null)) return { skip: 'дэмжигдээгүй төрөл' };
  const combos = doms.reduce((a, d) => a * d.length, 1);
  if (combos > MAX_COMBOS) return { skip: `хослол ${combos}` };
  const joined = exprs.map((e) => `(${e})`).join(' and ');
  const idx = doms.map(() => 0);
  for (let n = 0; n < combos; n++) {
    const ctx = Object.fromEntries(doms.map((d, i) => [`v${i}`, d[idx[i]]]));
    const r = evaluate(joined, ctx);
    if (!r.ok) return { skip: `үнэлгээ: ${r.error}` };
    if (r.value === true) return { sat: true, witness: Object.fromEntries(vars.map((v, i) => [v, ctx[`v${i}`]])) };
    for (let i = 0; i < idx.length; i++) { if (++idx[i] < doms[i].length) break; idx[i] = 0; }
  }
  return { sat: false };
}

const fmt = (w) => Object.entries(w).map(([k, v]) => `${k} = ${v === null ? 'null' : typeof v === 'string' ? (v === '\u0000бусад' ? 'бусад утга' : `"${v}"`) : v}`).join(', ');

// хүснэгтийн нэр → Map(нэр → баганын meta): өөрийн багана + нэг алхмын FK зам (`<FK>.<Багана>`); төлөвийн машинтай багана = төлвүүдийн enum
export function columnIndex(model, tableName) {
  const idx = new Map();
  const withState = (tbl, c) => {
    const m = model.machines.find((x) => x.table === tbl && x.column === c.name);
    return m ? { ...c, type: 'enum', enumValues: m.states.map((st) => st.name), stateOf: m.name } : c;
  };
  const t = model.tables.get(tableName);
  if (!t) return idx;
  for (const c of t.columns) idx.set(c.name, withState(tableName, c));
  for (const c of t.columns) {
    const tgt = c.ref?.table && model.tables.get(c.ref.table);
    if (!tgt) continue;
    for (const c2 of tgt.columns) idx.set(`${c.name}.${c2.name}`, { ...withState(c.ref.table, c2), required: false, pk: false }); // FK хоосон байж болно
  }
  return idx;
}

// хүснэгт бүрийн предикатууд: {kind, text, column?, element, file, line}
function collect(model) {
  const byTable = new Map();
  const add = (table, p) => { if (!byTable.has(table)) byTable.set(table, []); byTable.get(table).push(p); };
  // хүү хүснэгт (FK-ээр эцэг рүү заасан) — `мөр бүрт <нөхцөл>`-ийн контекст (сервер naturalGuard: lines-ийн эхнийх)
  const childrenOf = (tbl) => [...model.tables.values()].filter((t) => t.columns.some((c) => c.ref?.table === tbl)).map((t) => t.name);
  for (const m of model.machines) for (const t of m.transitions) {
    if (t.create) continue;
    const el = ref.transition(m.name, t.caption, t.from);
    for (const [kind, raw] of [['guard', t.guard], ['when', t.autoWhen]]) {
      let g = stripMessage(raw);
      if (!g) continue;
      if (g.startsWith('мөр заавал and ')) g = g.slice('мөр заавал and '.length).trim();
      else if (g === 'мөр заавал') continue;
      if (g.startsWith('мөр бүрт ')) {
        const kids = childrenOf(m.table);
        if (kids.length) add(kids.length === 1 ? kids[0] : `\u0000${m.table}`, { kind, text: g.slice('мөр бүрт '.length).trim(), rows: kids, element: el, file: m.file, line: t.line, tr: t, context: 'rows' });
        continue;
      }
      add(m.table, { kind, text: g, element: el, file: m.file, line: t.line, tr: t });
    }
  }
  for (const [name, t] of model.tables) for (const c of t.columns) for (const tg of c.tags ?? []) {
    const kind = { requiredwhen: 'requiredWhen', visiblewhen: 'visibleWhen', validation: 'validation' }[String(tg.tag).toLowerCase()];
    if (!kind) continue;
    const text = kind === 'validation' ? validationExpr(c.name, tg.value) : str(tg.value);
    if (text) add(name, { kind, text, column: c.name, element: ref.column(name, c.name), file: t.file, line: c.line });
  }
  return byTable;
}

const KIND_NAME = { guard: 'guard', when: 'автомат нөхцөл (when)', requiredWhen: 'requiredWhen', visibleWhen: 'visibleWhen', validation: 'validation' };

export const predicatesCheck = {
  id: 'predicates', layer: 'A4',
  run(model, emit) {
    const preds = collect(model);

    // X0-ENUM-LITERAL — бүх предикат + DMN record.<Багана>
    const enumCols = (table) => [...columnIndex(model, table)].filter(([, c]) => c.type === 'enum' && c.enumValues?.length).map(([name, c]) => ({ ...c, name }))
      .sort((a, b) => b.name.length - a.name.length);
    const enumFlagged = new Set(); // нэг үндсэн шалтгаан: enum-ийн буруу утгатай предикатад X0-NEVER-TRUE давхар гаргахгүй
    const enumCheck = (text, cols, where) => {
      const { text: masked, strings } = maskStrings(text);
      for (const c of cols) {
        const vals = new Set(c.enumValues.map(String));
        const n = escapeRe(c.name);
        const re = new RegExp(`(?<![\\p{L}\\p{N}_.])${n}\\s*(?:==|!=)\\s*§(\\d+)§|(?<![\\p{L}\\p{N}_.])${n}\\s+(?:not\\s+)?in\\s*\\(([^)]*)\\)`, 'gu');
        for (const m of masked.matchAll(re)) {
          const ids = m[1] !== undefined ? [m[1]] : [...(m[2] ?? '').matchAll(/§(\d+)§/g)].map((x) => x[1]);
          for (const id of ids) {
            const v = unquote(strings[Number(id)]);
            if (vals.has(v)) continue;
            enumFlagged.add(where);
            emit({ code: 'X0-ENUM-LITERAL', element: where.element, discriminator: `${where.kind}:${c.name}=${v}`, file: where.file, line: where.line,
              message: `${KIND_NAME[where.kind] ?? where.kind} «${text.slice(0, 120)}»${where.context === 'rows' ? ' (мөр бүрт)' : ''}: «${c.name}» ${c.stateOf ? `машин «${c.stateOf}»-д` : 'enum-д'} «${v}» утга алга (${[...vals].join(', ')}) — нөхцөл хэзээ ч таарахгүй`,
              fix: `утгыг enum-ийн утгатай таацуулах (бичгийн алдаа?) эсвэл erd.dbml-д «${c.name}» enum-д «${v}» нэмнэ` });
          }
        }
      }
    };
    for (const [table, list] of preds) for (const p of list) {
      if (!p.rows || p.rows.length === 1) { enumCheck(p.text, enumCols(p.rows ? p.rows[0] : table), p); continue; }
      // олон хүү хүснэгт: тэр нэртэй багана бүхий бүх хүүд утга алга бол л (аль хүү болохыг сервер lines-аар сонгоно)
      const byName = new Map();
      for (const k of p.rows) for (const c of enumCols(k)) { const e = byName.get(c.name); byName.set(c.name, e ? { ...e, enumValues: [...new Set([...e.enumValues, ...c.enumValues])] } : c); }
      enumCheck(p.text, [...byName.values()].sort((a, b) => b.name.length - a.name.length), p);
    }
    for (const f of model.dmn) for (const d of f.text.matchAll(/<(?:dmn:)?decision\b[^>]*name="([^"]*)"[\s\S]*?<\/(?:dmn:)?decision>/g)) {
      const inputs = [...d[0].matchAll(/<inputExpression\b[^>]*>\s*<text>\s*record\.([^<]+?)\s*<\/text>/g)].map((m) => m[1]);
      const rules = [...d[0].matchAll(/<rule\b[\s\S]*?<\/rule>/g)];
      inputs.forEach((col, i) => {
        const cols = [...model.tables.values()].map((t) => t.columns.find((c) => c.name === col)).filter(Boolean);
        if (!cols.length || !cols.every((c) => c.type === 'enum' && c.enumValues?.length)) return;
        const vals = new Set(cols.flatMap((c) => c.enumValues.map(String)));
        rules.forEach((r, k) => {
          const entry = [...r[0].matchAll(/<inputEntry\b[^>]*>\s*<text>([\s\S]*?)<\/text>/g)][i]?.[1] ?? '';
          const dec = entry.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          for (const m of dec.matchAll(/"((?:[^"\\]|\\.)*)"/g)) if (!vals.has(m[1])) {
            const line = f.text.slice(0, d.index + d[0].indexOf(r[0])).split('\n').length;
            emit({ code: 'X0-ENUM-LITERAL', element: ref.decision(f.file, d[1]), discriminator: `dmn:${k + 1}:${col}=${m[1]}`, file: f.file, line,
              message: `шийдвэр «${d[1]}» дүрэм #${k + 1}: «${col}» enum-д «${m[1]}» утга алга (${[...vals].join(', ')}) — нүд хэзээ ч таарахгүй`,
              fix: 'утгыг enum-ийн утгатай таацуулна' });
          }
        });
      });
    }

    const evaluate = x0Evaluate();
    if (!evaluate) return;
    for (const [tableName, list] of preds) {
      const table = model.tables.get(tableName);
      if (!table) continue;
      const metaOf = columnIndex(model, tableName);
      const cols = [...metaOf.keys()].sort((a, b) => b.length - a.length);
      const simple = list.map((p) => ({ ...p, s: toSimple(p.text, cols) }));
      const validations = simple.filter((p) => p.kind === 'validation' && p.s.expr);
      // илэрхийлэл бүрийн локал v<i>-г нийтлэг дугаар руу (нэрээр) — мөр литерал доторхыг хөндөхгүй
      const unify = (items) => {
        const vars = [];
        const exprs = items.map((it) => {
          const { text, strings } = maskStrings(it.s.expr);
          const t = text.replace(/\bv(\d+)\b/g, (_, i) => { const n = it.s.vars[Number(i)]; if (!vars.includes(n)) vars.push(n); return `V${vars.indexOf(n)}`; });
          return unmask(t.replace(/\bV(\d+)\b/g, 'v$1'), strings);
        });
        return { exprs, vars };
      };
      // хувьсагчдын validation-ыг `(багана == null or <validation>)` хэлбэрээр (өөрийн баганаа дурдсан, бүх хувьсагч нь багтсан validation л)
      const constraintsFor = (vars, exclude) => validations
        .filter((v) => v !== exclude && vars.includes(v.column) && v.s.vars.includes(v.column) && v.s.vars.every((x) => vars.includes(x)))
        .map((v) => ({ s: { expr: `v${v.s.vars.indexOf(v.column)} == null or (${v.s.expr})`, vars: v.s.vars } }));
      const solve = (items, exclude = null) => {
        const base = unify(items);
        const all = unify([...items, ...constraintsFor(base.vars, exclude)]);
        return satisfiable(all.exprs, all.vars, metaOf, evaluate);
      };

      // X0-NEVER-TRUE — предикат (validation-тай хамт) хэзээ ч биелэхгүй; validation өөрөө — null-ээс бусад утга хүчинтэй эсэх
      for (const p of simple) {
        if (!p.s.expr || enumFlagged.has(list[simple.indexOf(p)])) continue;
        const r = solve([p], p.kind === 'validation' ? p : null);
        if (r.skip || r.sat) continue;
        const sev = p.kind === 'guard' || p.kind === 'when' || p.kind === 'validation' ? 'important' : 'advisory';
        const effect = { guard: 'шилжилт хэзээ ч хийгдэхгүй', when: 'автомат шилжилт хэзээ ч ажиллахгүй', requiredWhen: 'дүрэм хэзээ ч хэрэгжихгүй',
          visibleWhen: 'талбар хэзээ ч харагдахгүй', validation: 'ямар ч утга хүчинтэй биш — хадгалах боломжгүй (null-ээс бусад)' }[p.kind];
        emit({ code: 'X0-NEVER-TRUE', severity: sev, element: p.element, discriminator: p.kind, file: p.file, line: p.line,
          message: `${KIND_NAME[p.kind]} «${p.text}» баганын validation-тай хамт хэзээ ч биелэхгүй — ${effect}`,
          fix: 'нөхцөлийн хил/утгыг засна (validation-тэй зөрчилдөж байгаа эсэхийг шалгана)' });
      }
      // X0-REQUIRED-HIDDEN — requiredWhen ∧ ¬visibleWhen хангагдана: заавал атлаа нуугдсан талбар → хадгалж чадахгүй
      for (const rq of simple.filter((p) => p.kind === 'requiredWhen' && p.s.expr)) {
        const vis = simple.find((p) => p.kind === 'visibleWhen' && p.column === rq.column);
        if (!vis?.s.expr) continue;
        const neg = { s: { expr: `not (${vis.s.expr})`, vars: vis.s.vars } };
        const r = solve([rq, neg]);
        if (r.skip || !r.sat) continue;
        emit({ code: 'X0-REQUIRED-HIDDEN', element: rq.element, file: rq.file, line: rq.line,
          message: `«${tableName}.${rq.column}»: requiredWhen «${rq.text}» үнэн, visibleWhen «${vis.text}» худал байх тохиолдол бий [${fmt(r.witness)}] — заавал талбар нуугдаж бичлэг хадгалагдахгүй`,
          fix: 'visibleWhen-ийг requiredWhen-ийг агуулахаар өргөтгөнө (requiredWhen ⇒ visibleWhen)' });
      }
      // X0-GUARD-OVERLAP — нэг төлвөөс ижил товч, өөр guard зэрэг биелнэ (A1 SM-AMBIGUOUS-ийн үлдэгдэл)
      const guards = simple.filter((p) => p.kind === 'guard');
      for (let i = 0; i < guards.length; i++) for (let j = i + 1; j < guards.length; j++) {
        const a = guards[i], b = guards[j];
        if (a.tr.from !== b.tr.from || a.tr.caption !== b.tr.caption || str(a.tr.guard) === str(b.tr.guard) || !a.s.expr || !b.s.expr) continue;
        const r = solve([a, b]);
        if (r.skip || !r.sat) continue;
        emit({ code: 'X0-GUARD-OVERLAP', element: a.element, discriminator: `${a.tr.to}|${b.tr.to}`, file: b.file, line: b.line,
          message: `«${a.tr.from}»-өөс «${a.tr.caption}» (→ ${a.tr.to}, → ${b.tr.to}): guard «${a.text}» ба «${b.text}» зэрэг биелнэ [${fmt(r.witness)}]`,
          evidence: [{ file: a.file, line: a.line }, { file: b.file, line: b.line }], fix: 'guard-уудыг харилцан үгүйсгэх болгоно' });
      }
    }
  },
};
