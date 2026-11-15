// T3b WP-J (N-01) — deploy үеийн хөрвүүлэлтийн JS хуулбар: generators.yaml (DeployCalc.inc compileGenerator/groupSql/sourceSql/mapSql),
// metrics.yaml (metrics), reports.yaml `layout` (compileLayout). Сервер эдгээрийг apply үед л (хүснэгтийн код бэлэн болсны дараа)
// хөрвүүлдэг тул алдаа нь plan-д биш lint/apply-д (generator_compile, metric_compile, metric_notify, report_compile) гарна —
// энд сервергүйгээр, мессеж нь серверийнхтэй ижил. Зөвхөн strict үед (бүх `requires` уншигдсан) — эс бөгөөс нэр суусан багцад байж болно.
import { compileExpr, dimAttr } from './exprsql.mjs';

const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));
const listOf = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const dumpJson = (v) => JSON.stringify(v);

// Цөмийн хүснэгт (SolutionDeploy.cpp buildIndex-ийн alias + цөмийн caption) — багц эдгээрийг хэсэгчилсэн «stub»-аар зарладаг тул баганыг шалгахгүй
export const CORE_TABLES = new Set(['Хэсэг', 'Байгууллага', 'Хэрэглэгч', 'Хүн', 'Албан тушаал', 'Ажилтны албан тушаал', 'Бүлэг', 'Баяр ёслол',
  'Баяр ёслолоор амрах өдрүүд', 'Элемент', 'Байгууллагын бүтэц', 'Элементийн шинж чанар', 'Хэрэглэгчийн шалгуур', 'Ажилчдын албан тушаал', 'Хүйс',
  'Байгууллагын албан тушаалууд', 'Яс үндэс', 'Хэрэглэгчийн шалгуурын утга', 'Шинж чанар', 'Хуудас', 'Хуудасны хүснэгт', 'Хэсгийн төрөл', 'Хэрэглэгчийн эрх',
  'Бичгэн шинж чанар', 'Гадаад түлхүүр', 'Гадаад түлхүүрийн талбар', 'Өгөгдлийн төрөл', 'Програмын лиценз', 'Элементийн бичгэн шинж чанар']);

// tables: Map<нэр, {columns: [{name, type, ref, pk, tags}]}> (өөрийн + requires); ledgers: Map<нэр, {dims, measures, refs}>
export function makeSchema(tables, ledgers) {
  // байгууллагын хүрээтэй хүснэгтэд платформ «Байгууллага» (ST000501, FK → ST0005) баганыг өөрөө нэмдэг (ErdAdmin.cpp orgColumn)
  const ORG = { name: 'Байгууллага', ref: { table: 'Байгууллага', column: 'id' } };
  // T3b WP-L (N-06): системийн баганын нөөц нэр (SolutionDeploy.cpp kSystemNames) — багцын ижил нэртэй багана давуу; org нь байгууллагын хүрээтэйд л.
  // FK: org → Байгууллага (ST0005), createdBy/updatedBy → Хэрэглэгч (ST0032) — DeployCalc.inc schemaLookup
  // P-WP-10: аудит баганын монгол нэр (цөмийн caption — DesignerAdmin.cpp createModuleTx) нь англи нэрийн alias — screens.yaml/reports.yaml/илэрхийлэлд
  const SYS = { org: { table: 'Байгууллага' }, createdBy: { table: 'Хэрэглэгч' }, createdAt: null, updatedBy: { table: 'Хэрэглэгч' }, updatedAt: null,
    'Бүртгэсэн хүн': { table: 'Хэрэглэгч' }, 'Бүртгэсэн огноо': null, 'Зассан хүн': { table: 'Хэрэглэгч' }, 'Зассан огноо': null };
  const AUDIT = new Set(Object.keys(SYS).filter((n) => n !== 'org'));
  const sysCol = (t, n) => {
    const tb = tables.get(t);
    if (!tb || !Object.hasOwn(SYS, n) || (n === 'org' && !tb.orgScoped)) return undefined;
    return { name: n, ...(SYS[n] ? { ref: { table: SYS[n].table, column: 'id' } } : {}) };
  };
  const colOf = (t, n) => tables.get(t)?.columns.find((c) => c.name === str(n)) ?? (str(n) === ORG.name && tables.get(t)?.orgScoped ? ORG : sysCol(t, str(n)));
  // auth/Hash.h isSecretColumn — ST0032-ийн нууц үгийн hash, TOTP нууц, сэргээх код (кодоор эсвэл цөмийн caption-аар)
  const SECRET = new Set(['ST003204', 'ST003213', 'ST003215', 'Password', 'TotpSecret', 'RecoveryCodes', 'Нууц үг']);
  const S = {
    table: (n) => (tables.has(str(n)) || CORE_TABLES.has(str(n)) ? str(n) : ''),
    opaque: (t) => CORE_TABLES.has(t),
    secret: (t, n) => t === 'Хэрэглэгч' && SECRET.has(str(n)),
    column: (t, n) => (CORE_TABLES.has(t) || /^ST\d{6}$/.test(str(n)) || colOf(t, n) ? str(n) : ''),
    fk: (t, col) => {
      const c = colOf(t, col);
      if (!c?.ref) return '';
      const rt = c.ref.table, target = tables.get(rt);
      const logical = c.ref.column && c.ref.column.toLowerCase() !== 'id' && !(target?.columns.some((x) => x.name === c.ref.column && x.pk));
      return logical ? '' : rt;
    },
    dateCol: (t) => { for (const ty of ['date', 'datetime']) { const c = tables.get(t)?.columns.find((x) => x.type === ty); if (c) return c.name; } return ''; },
    effectiveCol: (t) => tables.get(t)?.columns.find((x) => (x.tags ?? []).some((g) => g.tag === 'effective'))?.name ?? '',
    ledger: (n) => ledgers.get(str(n)) ?? null,
    // T3b WP-K: өөр рүүгээ FK (лавлах багана нь pk/id) — DeployCalc.inc schemaLookup treeParent
    //   цөмийн хүснэгт: Хэрэглэгч (ST0032) мод биш; бусад (Байгууллага ST0005 г.м.) — серверт шийднэ (сул)
    treeParent: (t) => (CORE_TABLES.has(t) ? (t === 'Хэрэглэгч' ? '' : '(цөм)') : tables.get(t)?.columns.find((c) => c.ref?.table === t && S.fk(t, c.name) === t)?.name ?? ''),
    // P-WP-10: нэр нь системийн аудит баганад (ST000001–4) шийдэгдэх эсэх (багцын ижил нэртэй багана давуу) — зөвхөн унших
    audit: (t, n) => AUDIT.has(str(n)) && !CORE_TABLES.has(t) && !tables.get(t)?.columns.some((c) => c.name === str(n)) && !!tables.get(t),
    // P-WP-5: баганын DBML төрөл (жагсаалтын шүүлтийн input/op шалгалт) — цөм/системийн багана ''
    colType: (t, n) => String(colOf(t, n)?.type ?? '').toLowerCase(),
    // P-WP-27 (G-LFP): t-ийн target рүү заасан FK баганууд (хүүхдийн шүүлтийн `via` анхдагч) — цөм/алга хүснэгтэд [] биш, сул (['?'])
    fksTo: (t, target) => (CORE_TABLES.has(t) || !tables.has(t) ? ['?'] : tables.get(t).columns.filter((c) => S.fk(t, c.name) === target).map((c) => c.name)),
    columnsOf: (t) => [...(tables.get(t)?.columns.map((c) => c.name) ?? []), ...(tables.get(t)?.orgScoped ? [ORG.name] : [])],
    // T4 WP-U: байгууллагын хүрээтэй (ST000501) хүснэгт — цөмийн хүснэгтийг серверт шийднэ (сул: үнэн)
    hasOrg: (t) => (CORE_TABLES.has(t) ? true : !!tables.get(t)?.orgScoped),
  };
  return S;
}

// ledgers.yaml → Map<нэр, {dims, measures, refs: {хэмжээс: {table}}}> (extends — эх ledger-ийн нэрээр)
export function ledgerInfos(docs) {
  const out = new Map();
  for (const d of docs) for (const l of asList(d?.ledgers)) {
    if (!isObj(l) || !str(l.name)) continue;
    const dims = [], refs = {};
    for (const x of asList(l.dimensions)) {
      const dn = typeof x === 'string' ? str(x) : isObj(x) ? str(x.name) : '';
      if (!dn) continue;
      dims.push(dn);
      if (isObj(x) && str(x.ref)) refs[dn] = { table: str(x.ref) };
    }
    out.set(str(l.name), { dims, measures: asList(l.measures).filter((m) => typeof m === 'string').map(str), refs });
  }
  return out;
}

const scopeT = (table) => ({ table });

// ---- generators.yaml
function mapCheck(S, tbl, m, env, exact = null) {
  if (!isObj(m)) return '';
  for (const k of Object.keys(m).sort()) { // nlohmann::json объект түлхүүрээр эрэмбэлэгдсэн — эхний алдаа серверийнхтэй ижил
    const v = m[k];
    if (!S.column(tbl, k)) return `«${tbl}»-д багана «${k}» алга`;
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) continue;
    if (typeof v === 'string' && exact?.has(v.trim())) continue; // T3b WP-N: groupBy-ийн илэрхийлэлтэй ижил текст
    if (typeof v === 'string') { const e = compileExpr(v, S, env); if (e) return `«${k}»: ${e}`; continue; }
    return `«${k}»: утга буруу`;
  }
  return '';
}

function orderCheck(S, v, env, allowDir) {
  for (let e of listOf(v)) {
    e = e.trim();
    if (allowDir && e.length > 5 && e.slice(-5).toLowerCase() === ' desc') e = e.slice(0, -5).trim();
    else if (allowDir && e.length > 4 && e.slice(-4).toLowerCase() === ' asc') e = e.slice(0, -4).trim();
    const x = compileExpr(e, S, env);
    if (x) return x;
  }
  return '';
}

// → {err} | {env} (env.row тохируулсан)
function sourceCheck(S, from, env, refsParams) {
  if (typeof from === 'string' && from.trim().startsWith('param.')) {
    const pn = from.trim().slice(6).trim();
    if (refsParams.rows?.has(pn)) return { env: { ...env, row: refsParams.rows.get(pn) } }; // T3b WP-N (N-12): ledger/тайлангийн сонгосон мөр
    if (!refsParams.has(pn)) return { err: `from: param.${pn} — \`type: refs\` эсвэл \`type: rows\` параметр алга` };
    return { env: { ...env, row: scopeT(refsParams.get(pn)) } };
  }
  if (typeof from === 'string') {
    const t = S.table(from);
    if (!t) return { err: `from: хүснэгт «${from}» алга` };
    return { env: { ...env, row: scopeT(t) } };
  }
  if (!isObj(from)) return { err: 'from: хүснэгтийн нэр эсвэл {ledger: …} | {explode: …} | {days: …} | {lines: …}' };
  if (from.days !== undefined) { // P-WP-30 (G-DAYSERIES): огнооны цуваа — map-д date, n, weekday (row.date …) — DeployCalc.inc sourceSql
    const dy = from.days;
    if (!isObj(dy) || dy.from === undefined || dy.to === undefined) return { err: 'days: {from: <огноо>, to: <огноо>} (param.<Нэр> | огнооны токен | илэрхийлэл)' };
    if (Object.keys(from).some((k) => k !== 'days')) return { err: 'days: эх нь өөр түлхүүргүй ({days: {from, to}}) — шүүлт бүлгийн filter-т' };
    for (const k of ['from', 'to']) {
      const e = compileExpr(typeof dy[k] === 'string' ? dy[k] : dumpJson(dy[k]), S, env);
      if (e) return { err: `days.${k}: ${e}` };
    }
    if (Object.keys(dy).some((k) => k !== 'from' && k !== 'to')) return { err: 'days: зөвхөн {from, to}' };
    const row = { fields: new Map([['date', ''], ['n', ''], ['weekday', '']]) };
    return { env: { ...env, row, scopes: { ...(env.scopes ?? {}), ...(env.scopes?.row ? {} : { row }) } } };
  }
  if (from.lines !== undefined) { // P-WP-32 (G-TXTLIST): олон мөрт текст — map-д value, n (row.value …) — DeployCalc.inc sourceSql
    if (Object.keys(from).some((k) => k !== 'lines' && k !== 'split')) return { err: 'lines: эх нь {lines: <текст>, split: \'<regex>\'} л — шүүлт бүлгийн filter-т' };
    if (typeof from.lines !== 'string' || !from.lines.trim()) return { err: 'lines: <текст> (param.<Нэр> эсвэл илэрхийлэл)' };
    const e = compileExpr(from.lines, S, env);
    if (e) return { err: `lines: ${e}` };
    if (from.split !== undefined && (typeof from.split !== 'string' || !from.split || from.split.length > 100)) return { err: 'lines.split: хоосон биш regex (≤ 100 тэмдэгт)' };
    const row = { fields: new Map([['value', ''], ['n', '']]) };
    return { env: { ...env, row, scopes: { ...(env.scopes ?? {}), ...(env.scopes?.row ? {} : { row }) } } };
  }
  if (from.ledger !== undefined) {
    const ln = str(from.ledger);
    const li = S.ledger(ln);
    if (!li) return { err: `from: ledger «${ln}» алга` };
    const by = from.by !== undefined ? listOf(from.by) : li.dims;
    for (const d of by) if (!li.dims.includes(d) && !dimAttr(S, li, d)) return { err: `from: «${ln}»-д хэмжээс «${d}» алга (эсвэл <лавлах хэмжээс>.<багана>)` };
    const sc = from.scope === undefined ? 'exact' : from.scope;
    if (!['exact', 'root', 'subtree'].includes(sc)) return { err: 'from.scope: exact | root | subtree' };
    for (const k of ['from', 'to']) {
      if (from[k] === undefined) continue;
      const e = compileExpr(typeof from[k] === 'string' ? from[k] : dumpJson(from[k]), S, env);
      if (e) return { err: `from.${k}: ${e}` };
    }
    if (from.where !== undefined) {
      if (!isObj(from.where)) return { err: 'from.where: {<хэмжээс>: \'<загвар>\'}' };
      for (const k of Object.keys(from.where).sort()) {
        const v = from.where[k];
        if (!li.dims.includes(k) && !dimAttr(S, li, k)) return { err: `from.where: «${ln}»-д хэмжээс «${k}» алга (эсвэл <лавлах хэмжээс>.<багана>)` };
        if (typeof v !== 'string' || !v.trim()) return { err: `from.where.${k}: загвар (текст) — '11*|12*' эсвэл '!Хаалт'` };
      }
    }
    const fields = new Map();
    for (const d of by) fields.set(d, li.dims.includes(d) ? li.refs?.[d]?.table ?? '' : '');
    for (const m of li.measures) fields.set(m, '');
    return { env: { ...env, row: { fields } } };
  }
  if (from.explode !== undefined) {
    const edge = S.table(str(from.explode));
    if (!edge) return { err: `explode: хүснэгт «${str(from.explode)}» алга` };
    if (!S.column(edge, str(from.parent)) || !S.column(edge, str(from.child)) || !S.column(edge, str(from.qty))) return { err: `explode: parent/child/qty багана «${edge}»-д алга` };
    const itemTable = S.fk(edge, str(from.child));
    const rootsT = S.table(str(from.roots));
    if (!rootsT) return { err: `explode: roots хүснэгт «${str(from.roots)}» алга` };
    const re = { ...env, row: scopeT(rootsT) };
    let e = compileExpr(from.item === undefined ? 'id' : str(from.item), S, re);
    if (e) return { err: `explode.item: ${e}` };
    const qv = from.quantity === undefined ? 1 : from.quantity;
    e = compileExpr(typeof qv === 'string' ? qv : dumpJson(qv), S, re);
    if (e) return { err: `explode.quantity: ${e}` };
    if (str(from.filter)) { e = compileExpr(str(from.filter), S, re); if (e) return { err: `explode.filter: ${e}` }; }
    const fields = new Map([['item', itemTable], ['qty', ''], ['level', '']]);
    if (!from.group) { fields.set('root', itemTable); fields.set('src', rootsT); }
    return { env: { ...env, row: { fields } } };
  }
  return { err: 'from: {ledger: …}, {explode: …}, {days: …} эсвэл {lines: …}' };
}

function groupCheck(S, g, outTable, mapKey, update, env0, refsParams) {
  const from = update ? outTable : g?.from ?? null;
  const single = from === null || from === undefined;
  let env = env0;
  if (!single) { const r = sourceCheck(S, from, env, refsParams); if (r.err) return r.err; env = r.env; }
  const f = str(g?.filter);
  if (f) {
    if (single) return 'filter нь from-той бүлэгт';
    const e = compileExpr(f, S, env);
    if (e) return `filter: ${e}`;
  }
  // T3b WP-N (N-10): each — A × B (map-д нэр нь B, row. — A); бүлгийн filter нь A-д
  if (g?.each !== undefined) {
    const ea = g.each;
    if (single || update || !isObj(ea) || typeof ea.from !== 'string') return 'each: {from: <Хүснэгт>, filter, as} — from-той бүлэгт';
    const bt = S.table(str(ea.from));
    if (!bt) return `each.from: хүснэгт «${str(ea.from)}» алга`;
    const outer = env.row;
    env = { ...env, row: scopeT(bt), scopes: { ...env.scopes, row: outer } };
    if (ea.as !== undefined) {
      const an = str(ea.as);
      if (!an || an.includes('.') || ['row', 'doc', 'param', 'user', 'transition', 'src', 'item', 'root', 'line', 'old', 'trigger', 'id'].includes(an)) return 'each.as: нөөц бус, цэггүй нэр';
      env.scopes[an] = outer;
    }
    if (str(ea.filter)) { const e = compileExpr(str(ea.filter), S, env); if (e) return `each.filter: ${e}`; }
  }
  // T3b WP-N (N-08): groupBy — нэгтгэлийн гадна нэр нь бүлэглэсэн энгийн багана эсвэл groupBy-ийн илэрхийлэлтэй ижил текст
  const grouped = g?.groupBy !== undefined;
  let exact = null;
  if (grouped) {
    if (single || update) return 'groupBy нь from-той lines/rows бүлэгт';
    if (g.partition !== undefined) return 'groupBy нь partition (цонхны функц)-тэй хамт биш';
    const gl = listOf(g.groupBy);
    if (!gl.length) return 'groupBy: [<илэрхийлэл>] (хоосон биш)';
    const keys = new Set();
    exact = new Set();
    for (const e0 of gl) {
      const e = e0.trim();
      const x = compileExpr(e, S, env);
      if (x) return `groupBy: ${x}`;
      exact.add(e);
      if (env.row?.fields ? env.row.fields.has(e) : e === 'id' || (env.row?.table && S.column(env.row.table, e) === e)) keys.add(e);
    }
    env = { ...env, group: true, groupKeys: keys };
  }
  if (g?.order !== undefined) { const e = orderCheck(S, g.order, env, true); if (e) return `order: ${e}`; }
  if (g?.partition !== undefined) { const e = orderCheck(S, g.partition, env, false); if (e) return `partition: ${e}`; }
  env = { ...env, windows: !single && !grouped };
  const m = mapCheck(S, outTable, g?.[mapKey] ?? {}, env, exact);
  if (m) return m;
  for (const n of listOf(g?.nonzero)) if (!S.column(outTable, n)) return `nonzero: багана «${n}» алга`;
  return '';
}

// T3b WP-L (N-04): генераторын хүрээ — user.code|name|role|org, user.<контекст>[.<Багана>] (context.yaml-ийн хүснэгтээр FK зам), transition.*
//   contexts: Map<нэр, хүснэгт|''> (энэ багц + requires; серверт ST1917 — суусан бүх багцынх)
export function userScopes(S, contexts = new Map()) {
  const u = new Map(['code', 'name', 'role', 'org'].map((k) => [k, '']));
  for (const [nm, t] of contexts) u.set(nm, t && S.table(t) ? S.table(t) : '');
  return { user: { fields: u }, transition: { fields: new Map(['comment', 'button', 'from', 'to'].map((k) => [k, ''])) } };
}

export function generatorError(S, g, tables, contexts = new Map()) {
  const base = { params: new Set(), paramRefs: new Map(), paramLists: new Set(), scopes: userScopes(S, contexts), row: null };
  const refsParams = new Map();
  refsParams.rows = new Map(); // T3b WP-N (N-12): `type: rows` → мөрийн хүрээ
  const rowsDefs = [], refsDefs = [];
  for (const p of asList(g.params)) {
    const pn = str(p?.name), ty = p?.type === undefined ? 'text' : p.type;
    if (!pn || !['date', 'datetime', 'number', 'text', 'ref', 'refs', 'rows', 'boolean'].includes(ty)) return 'params: {name, label, type: date|datetime|number|text|boolean|ref|refs|rows, table (ref, refs), from (rows), options (text, number), default}';
    if (pn.includes('.')) return `params: нэр «${pn}»-д цэг байж болохгүй`;
    // P-WP-35 — DeployCalc.inc compileGenerator-тэй ижил мессеж: G-PARAMLBL (label), G-GENPOPT (options/display, boolean), G-GENTRANS (split)
    if (p.label !== undefined && (typeof p.label !== 'string' || !p.label.trim())) return `params «${pn}»: label — хоосон биш текст`;
    if ((p.options !== undefined || p.display !== undefined) && ty !== 'text' && ty !== 'number') return `params «${pn}»: options/display зөвхөн type: text | number-д (checkbox — type: boolean)`;
    if (p.display !== undefined && (p.options === undefined || !['radio', 'select'].includes(p.display))) return `params «${pn}»: display: radio | select (options-той)`;
    if (p.split !== undefined && !(ty === 'text' && p.multiline === true)) return `params «${pn}»: split зөвхөн multiline: true текстэд`;
    if (ty === 'refs') {
      const rt = S.table(str(p.table)); if (!rt) return `params «${pn}»: type refs — table «${str(p.table)}» алга`; refsParams.set(pn, rt); base.paramLists.add(pn);
      if (p.where !== undefined || p.default !== undefined) refsDefs.push([p, rt]); // P-WP-35 (G-REFSDEF): doc.* тодорхой болсны дараа
      continue;
    }
    if (ty === 'rows') { rowsDefs.push(p); continue; }
    if (p.multiline !== undefined && (ty !== 'text' || typeof p.multiline !== 'boolean')) return `params «${pn}»: multiline: true зөвхөн type: text-д`; // P-WP-32 (G-TXTLIST)
    if (p.options !== undefined) {
      if (!Array.isArray(p.options) || !p.options.length) return `params «${pn}»: options: [<утга> | {value, label}] (хоосон биш жагсаалт)`;
      const vals = [];
      for (const o of p.options) {
        const v = isObj(o) ? o.value : o;
        if (typeof v !== 'string' && typeof v !== 'number') return `params «${pn}»: options: утга нь текст эсвэл тоо`;
        if (ty === 'number' && !Number.isFinite(Number(v))) return `params «${pn}»: options: type number — «${v}» тоо биш`;
        if (vals.some((x) => String(x) === String(v))) return `params «${pn}»: options: «${v}» давхардсан`;
        vals.push(v);
      }
      const dv = p.default;
      if (dv !== undefined && !(typeof dv === 'string' && dv.trim().startsWith('user.')) && !vals.some((x) => (ty === 'number' ? Number(x) === Number(dv) : String(x) === String(dv)))) return `params «${pn}»: default «${dv}» сонголтод (options) алга`;
    }
    if (ty === 'boolean' && p.default !== undefined && ![true, false, 'true', 'false', 'True', 'False', 1, 0, '1', '0', 'yes', 'no', 'on', 'off', 'тийм', 'үгүй', 'Тийм', 'Үгүй'].includes(p.default)) return `params «${pn}»: type boolean — default: true | false`;
    base.params.add(pn);
    if (ty === 'ref') { const rt = S.table(str(p.table)); if (!rt) return `params «${pn}»: type ref — table (лавлах хүснэгт) «${str(p.table)}» алга`; base.paramRefs.set(pn, rt); }
    // T3b WP-L (N-04): `default: user.<Нэр>` — code | name | role | org эсвэл context.yaml-ийн контекст
    if (typeof p.default === 'string' && p.default.trim().startsWith('user.')) {
      const un = p.default.trim().slice(5).trim();
      if (!['code', 'name', 'role', 'org'].includes(un) && !contexts.has(un)) return `params «${pn}»: default user.${un} — code | name | role | org эсвэл context.yaml-ийн контекст`;
    }
  }
  let on = '';
  if (g.on !== undefined) {
    on = S.table(str(g.on));
    if (!on) return `on: хүснэгт «${str(g.on)}» алга`;
    base.scopes.doc = { table: on, keyed: true };
  }
  // T3b WP-M (N-14): trigger — DeployCalc.inc compileGenerator-тэй ижил мессеж; doc./old./trigger.event, changed(<Багана>)
  if (g.trigger !== undefined) {
    const t = g.trigger;
    if (!isObj(t)) return 'trigger: {table, on: insert|update|delete|transition, transitions, when}';
    const tt = S.table(str(t.table));
    if (!tt) return `trigger.table: хүснэгт «${str(t.table)}» алга`;
    if (on && on !== tt) return 'trigger.table нь on-той ижил байх ёстой (doc.* = үйл явдлын мөр)';
    const events = listOf(t.on).map((e) => e.trim());
    for (const ev of events) if (!['insert', 'update', 'delete', 'transition'].includes(ev)) return `trigger.on: insert | update | delete | transition («${ev}»)`;
    if (!events.length) return 'trigger.on заавал (insert | update | delete | transition)';
    if (listOf(t.transitions).length && !events.includes('transition')) return 'trigger.transitions нь on: transition-тэй хамт';
    if (t.replay !== undefined && typeof t.replay !== 'boolean') return 'trigger.replay: true | false';
    for (const p of asList(g.params)) if (isObj(p) && p.default === undefined && p.required !== false) return `trigger: параметр «${str(p.name)}»-д default эсвэл required: false`;
    on = tt;
    base.scopes.doc = { table: on, keyed: true };
    base.scopes.old = { table: on };
    base.scopes.trigger = { fields: new Map([['event', '']]) };
    base.call = (fn, raw) => {
      if (fn !== 'changed') return null;
      if (raw.length !== 1 || !raw[0]) return { err: 'changed(<Багана>)' };
      return S.column(on, raw[0]) ? { ok: true } : { err: `changed: багана «${raw[0]}» алга` };
    };
  }
  // T3b WP-N: `type: rows` — P-WP-32 (R-ROWSDEF): doc.* (on/trigger) тодорхой болсны дараа (from.where/default-д)
  for (const p of rowsDefs) { const e = rowsParamCheck(S, p, base, refsParams); if (e) return e; }
  for (const [p, rt] of refsDefs) { // P-WP-35 (G-REFSDEF): where: <X0>, default: all | <X0> — мөр = refs хүснэгт
    const pn = str(p.name);
    for (const [x, what] of [[p.where, 'where'], [p.default, 'default']]) {
      if (x === undefined) continue;
      if (typeof x !== 'string' || !x.trim()) return `params «${pn}»: type refs — ${what}: ${what === 'where' ? '<нөхцөл (X0)>' : 'all | <нөхцөл (X0)>'}`;
      if (what === 'default' && x.trim() === 'all') continue;
      const e = compileExpr(x.trim(), S, { ...base, row: scopeT(rt) });
      if (e) return `params «${pn}»: ${what}: ${e}`;
    }
  }
  // N-09: when (trigger.when ба generator when), require: '<X0> «мессеж»' | {if, message}
  const splitMsg = (x) => { const m = /^([\s\S]*?)\s*«([^«»]*)»\s*$/.exec(String(x).trim()); return m ? m[1].trim() : String(x).trim(); };
  for (const w of [isObj(g.trigger) ? g.trigger.when : undefined, g.when]) {
    if (w === undefined) continue;
    const e = compileExpr(splitMsg(typeof w === 'string' ? w : dumpJson(w)), S, { ...base });
    if (e) return `when: ${e}`;
  }
  if (g.require !== undefined) {
    for (const r of Array.isArray(g.require) ? g.require : [g.require]) {
      const x = typeof r === 'string' ? splitMsg(r) : isObj(r) ? str(r.if ?? r.expr) : '';
      if (!x) return "require: '<X0> «мессеж»' эсвэл {if: <X0>, message}";
      const e = compileExpr(x, S, { ...base });
      if (e) return `require: ${e}`;
    }
  }
  const intoDoc = !!on && g.target === undefined && g.lines !== undefined;
  if (intoDoc && (g.header !== undefined || g.then !== undefined)) return 'on + lines (target-гүй) нь баримтын өөрийн мөрийг бөглөнө — header/then-гүй';
  const target = intoDoc ? on : g.target !== undefined ? S.table(str(g.target)) : '';
  if (g.target !== undefined && !target) return `target: хүснэгт «${str(g.target)}» алга`;
  if (str(g.undo) && (!target || intoDoc)) return 'undo: зөвхөн target баримттай генераторт';
  if (g.runAs !== undefined && str(g.runAs) !== 'system') return 'runAs: зөвхөн system';
  if (!target && (g.header !== undefined || g.lines !== undefined || g.rows !== undefined)) return 'header/lines/rows-д target заавал';
  if (g.rows !== undefined && (g.lines !== undefined || g.header !== undefined)) return 'rows (мөр бүрээр баримт) нь header/lines-тэй хамт биш';
  const key = [];
  if (!intoDoc) for (const k of listOf(g.key)) { if (!S.column(target, k)) return `key: «${k}» багана алга`; key.push(k); }
  if (g.onDuplicate !== undefined) {
    if (!['skip', 'error'].includes(str(g.onDuplicate))) return 'onDuplicate: skip | error';
    if (!key.length) return 'onDuplicate нь key-тэй хамт';
  }
  if (g.keyExcept !== undefined && !key.length) return 'keyExcept нь key-тэй хамт';
  const lineTables = [];
  // total(<мөрийн багана|илэрхийлэл>) — өмнөх мөрийн бүлгүүдийн хүснэгтээр (T3b WP-N: exprsql totalCall)
  const withTotal = (env) => ({ ...env, totalTables: lineTables.length ? [...lineTables] : [''] });
  if (g.rows !== undefined) {
    const e = groupCheck(S, g.rows, target, 'map', false, base, refsParams);
    if (e) return `rows: ${e}`;
    if (g.rows?.from === undefined || g.rows?.from === null) return 'rows: from заавал';
  } else if (target) {
    let groups = g.lines === undefined ? [] : g.lines;
    if (isObj(groups)) groups = [groups];
    let prev = '';
    for (let i = 0; i < asList(groups).length; i++) {
      const gr = groups[i];
      let lt = gr?.table !== undefined ? S.table(str(gr.table)) : prev;
      // толгой-мөр (ST1306): серверт бүртгэлээс — энд target руу FK-тай эхний хүснэгт
      if (!lt) for (const [tn, t] of tables) if (t.columns.some((c) => c.ref?.table === target && S.fk(tn, c.name) === target)) { lt = tn; break; }
      if (!lt) return `lines[${i}]: table (мөрийн хүснэгт) заавал`;
      if (!tables.get(lt)?.columns.some((c) => c.ref?.table === target && S.fk(lt, c.name) === target) && !S.opaque(lt)) return `lines: «${lt}»-д «${target}» рүү FK алга`;
      const e = groupCheck(S, gr, lt, 'map', false, withTotal(base), refsParams);
      if (e) return `lines[${i}]: ${e}`;
      if (gr?.lines !== undefined) { const ne = nestedCheck(S, gr.lines, lt, base, refsParams, tables, 1); if (ne) return `lines[${i}].${ne}`; }
      if (intoDoc) for (const k of listOf(gr?.key !== undefined ? gr.key : g.key)) if (!S.column(lt, k)) return `lines.key: «${k}» багана алга`;
      lineTables.push(lt);
      prev = lt;
    }
    const h = mapCheck(S, target, g.header ?? {}, withTotal(base));
    if (h) return `header: ${h}`;
  }
  for (const u of asList(g.update)) {
    const ut = S.table(str(u?.table));
    if (!ut) return `update: хүснэгт «${str(u?.table)}» алга`;
    const e = groupCheck(S, u, ut, 'set', true, base, refsParams);
    if (e) return `update «${str(u?.table)}»: ${e}`;
    if (u?.transition !== undefined) { // T4; P-WP-35 (G-GENTRANS): {button, as: user | process} — DeployCalc.inc (state/GenParams.h parseTransition)-тэй ижил
      const t = u.transition;
      if (typeof t === 'string') { if (!t.trim()) return `update «${str(u?.table)}»: transition: <товчны нэр>`; }
      else if (!isObj(t)) return `update «${str(u?.table)}»: transition: <товчны нэр> | {button: <товч>, as: user | process}`;
      else {
        for (const k of Object.keys(t)) if (!['button', 'as'].includes(k)) return `update «${str(u?.table)}»: transition: {button, as} — «${k}» танигдаагүй`;
        if (typeof t.button !== 'string' || !t.button.trim()) return `update «${str(u?.table)}»: transition.button: <товчны нэр> заавал`;
        if (t.as !== undefined && !['user', 'process'].includes(t.as)) return `update «${str(u?.table)}»: transition.as: user | process`;
      }
    }
    // T4 WP-U: шинэчлэх мөрийн байгууллагын хүрээ — DeployCalc.inc groupSql-тэй ижил (self | children | subtree; дээш биш)
    if (u?.org !== undefined) {
      const sc = typeof u.org === 'string' ? u.org.trim() : '';
      if (!['self', 'children', 'subtree'].includes(sc)) return `update «${str(u?.table)}»: org: self | children | subtree (шинэчлэх мөрийн байгууллага — өөрөө, шууд охин, бүх доод)`;
      if (sc !== 'self' && !S.hasOrg(ut)) return `update «${str(u?.table)}»: org: «${ut}» байгууллагын хүрээгүй хүснэгт`;
    }
  }
  for (const dg of asList(g.delete)) {
    const dt = S.table(str(dg?.table));
    if (!dt) return `delete: хүснэгт «${str(dg?.table)}» алга`;
    if (!str(dg?.filter)) return `delete «${str(dg?.table)}»: filter заавал`;
    const e = groupCheck(S, { filter: str(dg.filter) }, dt, 'set', true, base, refsParams);
    if (e) return `delete «${str(dg?.table)}»: ${e}`;
  }
  if (g.skipEmpty !== undefined) {
    if (!target || intoDoc || g.rows !== undefined) return 'skipEmpty: зөвхөн target + header/lines генераторт';
    if (typeof g.skipEmpty !== 'boolean') {
      const cols = listOf(g.skipEmpty);
      for (const n of cols) if (!S.column(target, n)) return `skipEmpty: багана «${n}» алга`;
      if (!cols.length) return 'skipEmpty: true | [<толгойн багана>]';
    }
  }
  if (g.emptyHeader !== undefined) { // T4 (todu-stock S-M03-009/010): мөргүй ч толгой — DeployCalc.inc-тэй ижил
    if (typeof g.emptyHeader !== 'boolean') return 'emptyHeader: true | false';
    if (!target || intoDoc || g.rows !== undefined || g.header === undefined) return 'emptyHeader: зөвхөн target + header/lines генераторт';
    if (g.emptyHeader && g.skipEmpty !== undefined && g.skipEmpty !== false) return 'emptyHeader ба skipEmpty зэрэг болохгүй';
  }
  const hasGroups = g.rows === undefined && target && asList(g.lines).length > 0;
  if (!hasGroups && g.rows === undefined && !asList(g.update).length && !asList(g.delete).length && !(target && g.header !== undefined) && g.require === undefined) return 'lines, rows, update, delete, target + header эсвэл require алга';
  return '';
}

// T3b WP-N (N-10): ач хүү мөр — DeployCalc.inc nestedLines (line.<Багана> = эцэг мөр)
function nestedCheck(S, lines0, parent, base, refsParams, tables, depth) {
  if (depth > 3) return 'lines: үүрлэлт 3 шатаас гүн байж болохгүй';
  const lines = isObj(lines0) ? [lines0] : lines0;
  if (!Array.isArray(lines) || !lines.length) return 'lines: [{table, from, map, …}] (ач хүү мөр)';
  for (let i = 0; i < lines.length; i++) {
    const gr = lines[i], at = `lines[${i}]`;
    if (!isObj(gr)) return `${at}: {table, from, map}`;
    const lt = S.table(str(gr.table));
    if (!lt) return `${at}: table (ач хүү мөрийн хүснэгт) «${str(gr.table)}» алга`;
    if (!tables.get(lt)?.columns.some((c) => c.ref?.table === parent && S.fk(lt, c.name) === parent) && !S.opaque(lt)) return `${at}: «${lt}»-д «${parent}» рүү FK алга`;
    const env = { ...base, scopes: { ...base.scopes, line: { table: parent } } };
    const e = groupCheck(S, gr, lt, 'map', false, env, refsParams);
    if (e) return `${at}: ${e}`;
    for (const k of listOf(gr.key)) if (!S.column(lt, k)) return `${at}.key: «${k}» багана алга`;
    if (gr.lines !== undefined) { const ne = nestedCheck(S, gr.lines, lt, base, refsParams, tables, depth + 1); if (ne) return `${at}.${ne}`; }
  }
  return '';
}

// T3b WP-N (N-12): `type: rows` — DeployCalc.inc rowsParam (тайлангийн баганыг сервер л мэднэ — энд {any})
function rowsParamCheck(S, p, base, refsParams) {
  const pn = str(p.name), from0 = p.from;
  let row = null, names = null, key = [];
  // P-WP-32 (R-ROWSDEF): from.where — X0 (текст) эсвэл {<хэмжээс>: '<загвар>'}; default: all | <X0>
  const whereX = isObj(from0) && typeof from0.where === 'string' ? from0.where.trim() : '';
  const from = whereX ? { ...from0, where: undefined } : from0;
  if (whereX === '' && isObj(from0) && typeof from0.where === 'string') return `params «${pn}»: from.where хоосон`;
  if (p.default !== undefined && (typeof p.default !== 'string' || !p.default.trim())) return `params «${pn}»: type rows — default: all | <нөхцөл (X0)>`;
  const defX = typeof p.default === 'string' ? p.default.trim() : '';
  if (isObj(from) && from.ledger !== undefined && from.explode === undefined) {
    const ln = str(from.ledger), li = S.ledger(ln);
    if (!li) return `params «${pn}»: from: ledger «${ln}» алга`;
    const r = sourceCheck(S, from, base, refsParams);
    if (r.err) return `params «${pn}»: ${r.err}`;
    row = r.env.row;
    for (const [x, what] of [[whereX, 'from.where'], [defX === 'all' ? '' : defX, 'default']]) {
      if (!x) continue;
      const e = compileExpr(x, S, r.env);
      if (e) return `params «${pn}»: ${what}: ${e}`;
    }
    const by = from.by !== undefined ? listOf(from.by) : li.dims;
    names = new Set([...by, ...li.measures]);
    key = by;
  } else if (isObj(from) && from.report !== undefined) {
    if (whereX) return `params «${pn}»: from.where (илэрхийлэл) зөвхөн ledger эхэд — тайлангийн filter/params-аар шүүнэ`;
    if (defX && defX !== 'all') return `params «${pn}»: тайлангийн эхэд default: all л`;
    row = { any: true };
  } else return `params «${pn}»: type rows — from: {ledger: …, by} эсвэл {report: <нэр>}`;
  if (p.key !== undefined) key = listOf(p.key);
  if (!key.length) return `params «${pn}»: type rows — key: [<талбар>] (сонгосон мөрийг таних)`;
  if (names) for (const k of key) if (!names.has(k)) return `params «${pn}»: key «${k}» талбар алга`;
  refsParams.rows.set(pn, row);
  for (const n of names ?? []) base.paramLists.add(`${pn}.${n}`);
  if (!names) base.paramLists.add(`${pn}.*`);
  return '';
}

// ---- metrics.yaml (DeployCalc.inc metrics): үзүүлэлт бие биеэ нэрээр лавлана (тойрог хориглоно)
export function metricErrors(S, metrics) {
  const defs = new Map();
  for (const m of metrics) if (isObj(m) && str(m.name) && str(m.value)) defs.set(str(m.name), m);
  const memo = new Map(), busy = new Set();
  const build = (name) => {
    if (memo.has(name)) return memo.get(name);
    if (busy.has(name)) return `үзүүлэлт «${name}» өөрийгөө лавласан (тойрог)`;
    busy.add(name);
    const d = defs.get(name);
    const scope = d?.scope === undefined ? 'subtree' : d.scope;
    if (!['exact', 'root', 'subtree'].includes(scope)) { busy.delete(name); return 'scope: exact | root | subtree'; }
    let inner = '';
    const env = { params: new Set(['from', 'to']), ident: (n) => { if (!defs.has(n)) return false; const e = build(n); if (e) { inner = e; return false; } return true; } };
    let err = compileExpr(str(d.value), S, env);
    if (err && inner) err = inner;
    busy.delete(name);
    memo.set(name, err);
    return err;
  };
  const out = [];
  for (const [name, d] of defs) {
    const e = build(name);
    if (e) { out.push({ code: 'metric_compile', message: `metrics.yaml «${name}»: ${e}` }); continue; }
    if (d.notify !== undefined) {
      const nf = d.notify;
      const to = typeof nf === 'string' ? nf.trim() : isObj(nf) ? str(nf.to) : '';
      const when = isObj(nf) && nf.when !== undefined ? nf.when : 'bad';
      if (!to || (when !== 'bad' && when !== 'warning')) out.push({ code: 'metric_notify', message: `metrics.yaml «${name}»: notify — '<хүлээн авагч>' эсвэл {to, when: bad|warning}` });
      else if (typeof d.target !== 'number') out.push({ code: 'metric_notify', message: `metrics.yaml «${name}»: notify-д target (босго) заавал` });
    }
  }
  return out;
}

// ---- reports.yaml `layout` (DeployCalc.inc compileLayout)
export function layoutError(S, y) {
  const lay = y.layout;
  const base = { params: new Set(asList(y.params).map((p) => str(p?.name)).filter(Boolean)) };
  const scope = lay.scope === undefined ? 'subtree' : lay.scope;
  if (!['exact', 'root', 'subtree'].includes(scope)) return 'layout.scope: exact | root | subtree';
  const cols = lay.columns, rows = lay.rows;
  if (!Array.isArray(cols) || !cols.length || !Array.isArray(rows) || !rows.length) return 'layout: columns, rows заавал';
  const cs = [];
  for (const cj of cols) {
    const cl = { name: str(cj?.name), formula: '', text: false };
    if (!cl.name) return 'layout.columns: name заавал';
    // P-WP-24 (A2-9): type: text — мөрийн текст багана
    const ty = cj.type === undefined ? 'number' : str(cj.type);
    if (ty !== 'number' && ty !== 'text') return `layout.columns «${cl.name}» type: number | text`;
    if (ty === 'text') {
      if (cj.formula !== undefined || cj.from !== undefined || cj.to !== undefined) return `layout.columns «${cl.name}»: text багана formula/from/to-гүй`;
      cl.text = true; cs.push(cl); continue;
    }
    if (cj.formula !== undefined) { cl.formula = str(cj.formula); cs.push(cl); continue; }
    for (const k of ['from', 'to']) {
      if (cj[k] === undefined) continue;
      const e = compileExpr(str(cj[k]), S, base);
      if (e) return `layout.columns «${cl.name}» ${k}: ${e}`;
    }
    cs.push(cl);
  }
  const byCode = new Map();
  for (const r of rows) if (isObj(r) && r.code !== undefined) byCode.set(str(r.code), r);
  const memo = new Map(), busy = new Set();
  const cell = (r, ci, rowScope) => {
    const cl = cs[ci], code = str(r.code), key = `${code}#${ci}`;
    if (code && !rowScope && memo.has(key)) return memo.get(key);
    if (code && busy.has(key)) return `мөр «${code}» өөрийгөө лавласан`;
    busy.add(key);
    const env = { ...base, row: rowScope };
    let expr;
    if (cl.formula) {
      expr = cl.formula;
      env.ident = (n) => { for (let k = 0; k < cs.length; k++) if (cs[k].name === n && k !== ci && !cs[k].text && !cell(r, k, rowScope)) return true; return false; };
    } else {
      expr = isObj(r.values) && r.values[cl.name] !== undefined ? str(r.values[cl.name]) : cl.text ? '' : str(r.value);
      env.ident = (n) => byCode.has(n) && !cell(byCode.get(n), ci, null);
    }
    const res = expr.trim() ? compileExpr(expr, S, env) : '';
    busy.delete(key);
    if (code && !rowScope) memo.set(key, res);
    return res;
  };
  for (const r of rows) {
    if (!isObj(r)) continue;
    if (r.each !== undefined) {
      const t = S.table(str(r.each));
      if (!t) return `layout.rows each: хүснэгт «${str(r.each)}» алга`;
      const env = { ...base, row: scopeT(t) };
      let e = compileExpr(r.label === undefined ? 'id' : str(r.label), S, env);
      if (e) return `layout.rows each label: ${e}`;
      if (str(r.filter)) { e = compileExpr(str(r.filter), S, env); if (e) return `layout.rows each filter: ${e}`; }
      if (r.order !== undefined) { e = orderCheck(S, r.order, env, true); if (e) return e; }
      for (let ci = 0; ci < cs.length; ci++) { const x = cell(r, ci, scopeT(t)); if (x) return `layout «${str(r.label)}» / «${cs[ci].name}»: ${x}`; }
    } else {
      for (let ci = 0; ci < cs.length; ci++) {
        const heading = r.value === undefined && r.values === undefined && !cs[ci].formula;
        if (heading) continue;
        const x = cell(r, ci, null);
        if (x) return `layout «${str(r.label)}» / «${cs[ci].name}»: ${x}`;
      }
    }
  }
  return '';
}
