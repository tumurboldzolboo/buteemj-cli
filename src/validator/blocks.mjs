// T3b WP-J (N-01) — блокуудын баганын нэрийн шалгалт (сервергүй), серверийн мессежтэй ижил:
//   ledgers.yaml — plan (SolutionDeploy.cpp 7c: ledger_*) + apply (ledgers(): эх бүрийн date/map, ledger_skip)
//   screens.yaml — translateFormScreen / translateListScreen (screen_skip)
//   reports.yaml — reports() buildSpec (report_skip): groupBy, measures.field, columns
// S — compile.mjs makeSchema (цөмийн хүснэгт opaque).

// P-WP-51 (DEFER-TARGETS): товч/холбоосын зорилт (page/screen/form/report) энэ багц ба requires-д алга — дараа суух багцынх байж болно:
// сервер нэрээр хадгалж ажиллах үед шийднэ (шийдэгдэхгүй бол товч нуугдана). Алдаа биш анхааруулга — SolutionDeploy.cpp kPendingHint-тэй ижил.
export const PENDING_HINT = ' (одоогоор суулгалтад алга — дараа суух багцынх бол тэр үед шийдэгдэнэ; түүнээс өмнө товч нуугдана)';
const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// FK зам: сегмент бүр багана, дараагийнх нь FK-ийн лавлах хүснэгтэд; цөмийн хүснэгтэд хүрвэл шалгахгүй. maxSegs: ledger 4, тайлан ∞
export function pathOk(S, tbl, path, maxSegs = Infinity) {
  if (S.opaque(tbl) || S.column(tbl, str(path))) return true;
  const segs = String(path).split('.').map((x) => x.trim());
  if (segs.length < 2 || segs.length > maxSegs) return false;
  let cur = tbl;
  for (let i = 0; i < segs.length; i++) {
    if (S.opaque(cur)) return true;
    if (!S.column(cur, segs[i])) return false;
    if (i === segs.length - 1) return true;
    cur = S.fk(cur, segs[i]);
    if (!cur) return false;
  }
  return true;
}

// P-WP-27 (G-LFP): "<Багана>[.<лавлахын багана>…]" (FK гинж ≤ 5) → {tbl, col} эцсийн хүснэгт/багана; цөмийн (opaque) хүснэгтэд хүрвэл {tbl, col: ''}; алга бол null
export function pathEnd(S, tbl, path) {
  const name = str(path);
  if (!name) return null;
  if (S.opaque(tbl)) return { tbl, col: '' };
  if (S.column(tbl, name)) return { tbl, col: name };
  const segs = name.split('.').map((x) => x.trim());
  let cur = tbl, i = 0, steps = 0;
  while (i < segs.length) {
    if (S.opaque(cur)) return { tbl: cur, col: '' };
    let j = segs.length;
    for (; j > i; j--) if (S.column(cur, segs.slice(i, j).join('.'))) break;
    if (j === i) return null;
    const col = segs.slice(i, j).join('.');
    i = j;
    if (i === segs.length) return { tbl: cur, col };
    const next = S.fk(cur, col);
    if (!next || ++steps > 5) return null;
    cur = next;
  }
  return null;
}

// дээд түвшний ` + `/` - ` эсвэл ` * `/` / ` (хаалт, хашилтын гадна; баруунаас) → [зүүн, баруун] | null (SolutionDeploy.cpp valueSql)
function splitTop(v) {
  for (const ops of ['+-', '*/']) {
    let depth = 0, q = false;
    for (let i = v.length - 1; i >= 1; i--) {
      const ch = v[i];
      if (ch === "'") q = !q;
      if (q) continue;
      if (ch === ')') depth++;
      else if (ch === '(') depth--;
      else if (depth === 0 && ops.includes(ch) && v[i - 1] === ' ' && i + 1 < v.length && v[i + 1] === ' ') return [v.slice(0, i - 1), v.slice(i + 2)];
    }
  }
  return null;
}
const literal = (v) => /^-?[0-9]+(\.[0-9]+)?$/.test(v) || (v.length >= 2 && v[0] === "'" && v.endsWith("'")) || /^ledger\(\s*(.+?)\s*,\s*(.+?)\s*\)$/.test(v) || v.startsWith('asof(');
// утга: арифметик, хаалт, урд `-`, тоо, '<текст>', ledger(), asof() эсвэл багана/зам (leaf) → алдаатай хэсэг | ''
function valueWalk(v0, leaf, empty) {
  const v = str(v0);
  if (!v) return empty;
  const sp = splitTop(v);
  if (sp) return valueWalk(sp[0], leaf, empty) || valueWalk(sp[1], leaf, empty);
  if (v[0] === '(' && v.endsWith(')')) return valueWalk(v.slice(1, -1), leaf, empty);
  if (v[0] === '-' && v.length > 1 && v[1] !== ' ') return valueWalk(v.slice(1), leaf, empty);
  if (literal(v)) return '';
  return leaf(v);
}

// own: энэ багцын (шинээр үүсэх) хүснэгт — серверт кодгүй тул plan баганыг шалгахгүй, apply үед ledger_skip; суусан (requires) хүснэгтэд plan-д ledger_date/ledger_map
export function ledgerErrors(S, ledgersYaml, own, foreignLedgers) {
  const out = [];
  out.blocked = new Set(); // plan-д хаагдсан ledger — үүсэхгүй тул генератор/үзүүлэлт/тайланд «ledger алга»
  for (const l of asList(ledgersYaml?.ledgers)) {
    if (!isObj(l)) continue;
    const ext = l.extends !== undefined;
    const name = str(ext ? l.extends : l.name);
    let blocked = false;
    const bad = (code, msg) => { blocked = true; out.push({ code, message: `ledgers.yaml «${name}»: ${msg}` }); };
    if (!name) { out.push({ code: 'ledger_name', message: 'ledgers.yaml: ledger-д `name` (эсвэл `extends`) заавал' }); continue; }
    let dims = [], measures = asList(l.measures).filter((m) => typeof m === 'string' && m.trim()).map(str);
    for (const d of asList(l.dimensions)) {
      const dn = typeof d === 'string' ? str(d) : isObj(d) ? str(d.name) : '';
      if (!dn) { bad('ledger_dimensions', 'dimensions: нэр эсвэл {name, ref, key}'); continue; }
      dims.push(dn);
      if (isObj(d) && d.ref !== undefined) {
        const rt = str(d.ref);
        if (!rt || !S.table(rt)) bad('ledger_ref', `хэмжээс «${dn}»: ref хүснэгт «${rt}» ERD-д алга`);
        else if (str(d.key) && !own.has(rt) && !S.column(rt, str(d.key))) bad('ledger_ref', `хэмжээс «${dn}»: key багана «${str(d.key)}» «${rt}»-д алга`);
      }
    }
    if (ext) {
      const li = foreignLedgers.get(name);
      if (!li) { bad('ledger_extends', 'extends — ledger алга (эзэмшигч багц эхлээд суусан байх ёстой)'); continue; }
      dims = li.dims; measures = li.measures;
    }
    if (!measures.length) bad('ledger_measures', '`measures` (хэмжигдэхүүн) дор хаяж нэг');
    const known = new Set([...dims, ...measures]);
    const sources = l.sources;
    if (!Array.isArray(sources) || !sources.length) bad('ledger_sources', '`sources` (эх баримт) дор хаяж нэг');
    for (const nn of asList(l.nonNegative).filter((x) => typeof x === 'string' && x.trim()).map(str)) if (!measures.includes(nn)) bad('ledger_limit', `nonNegative «${nn}» хэмжигдэхүүнд алга`);
    if (str(l.balanced) && !measures.includes(str(l.balanced))) bad('ledger_balanced', `balanced «${str(l.balanced)}» хэмжигдэхүүнд алга`);
    // plan-ийн colOk: шинэ хүснэгт — шалгахгүй; эс бөгөөс багана эсвэл эхний сегмент нь багана
    const colOk = (tbl, col) => own.has(tbl) || S.opaque(tbl) || !!S.column(tbl, col) || (col.includes('.') && !!S.column(tbl, col.slice(0, col.indexOf('.')).trim()));
    const srcTables = new Set(), srcPlan = [];
    for (const s of Array.isArray(sources) ? sources : []) {
      const tbl = str(s?.table);
      if (!tbl || !S.table(tbl)) { bad('ledger_table', `эх хүснэгт «${tbl}» ERD-д алга`); continue; }
      if (srcTables.has(tbl)) bad('ledger_source_dup', `«${tbl}» хоёр удаа эх болсон — нэг эх, нөхцөлт хөлүүдээр (\`legs: [{…, when: <X0>, sign: -1}]\`)`);
      srcTables.add(tbl);
      if (!str(s.date) || !colOk(tbl, str(s.date))) bad('ledger_date', `«${tbl}»: \`date\` багана «${str(s.date)}» алга`);
      if (s.sign !== undefined && s.sign !== 1 && s.sign !== -1) bad('ledger_sign', `«${tbl}»: \`sign\` нь 1 эсвэл -1`);
      const mp = isObj(s.map) ? s.map : {};
      let legs = [];
      if (s.legs !== undefined) { if (!Array.isArray(s.legs) || !s.legs.length) bad('ledger_legs', `«${tbl}»: legs — хөлийн жагсаалт (map-ийн давхарга)`); else legs = s.legs; }
      if (!legs.length) legs = [{}];
      for (const leg of legs) {
        if (!isObj(leg)) { bad('ledger_legs', `«${tbl}»: legs-ийн мөр бүр объект`); continue; }
        if (leg.sign !== undefined && leg.sign !== 1 && leg.sign !== -1) bad('ledger_sign', `«${tbl}»: legs.sign нь 1 эсвэл -1`);
        const m2 = { ...mp };
        for (const [k, v] of Object.entries(leg)) if (k !== 'sign' && k !== 'when') m2[k] = v;
        for (const k of Object.keys(m2).sort()) {
          const v = m2[k];
          if (!known.has(k)) { bad('ledger_map', `«${tbl}»: map «${k}» нь dimensions/measures-д алга`); continue; }
          if (typeof v === 'number') continue;
          const b1 = typeof v === 'string' ? valueWalk(v, (x) => (colOk(tbl, x) ? '' : x), '(хоосон)') : JSON.stringify(v);
          if (typeof v !== 'string' || b1) bad('ledger_map', `«${tbl}»: map «${k}» — «${b1}» (багана/FK зам алга)`);
        }
        const cost0 = str(s.cost);
        for (const m of measures) if (!(m in m2) && !(cost0 && m === str(s.amount))) bad('ledger_map', `«${tbl}»: хэмжигдэхүүн «${m}» map-д алга`);
      }
      const cost = str(s.cost);
      if (cost) {
        if (cost !== 'average' && cost !== 'fifo') bad('ledger_cost', `«${tbl}»: \`cost\` нь average | fifo`);
        const q = str(s.quantity), a = str(s.amount);
        if (!known.has(q) || !known.has(a) || q === a || !(q in mp)) bad('ledger_cost', `«${tbl}»: \`quantity\` (map-д) ба \`amount\` нь өөр өөр хэмжигдэхүүн байх ёстой`);
      }
      srcPlan.push({ s, tbl, mp, legs });
    }
    if (blocked) { if (!ext) out.blocked.add(name); continue; }
    // apply: эх бүрийн date (FK зам ≤ 4) ба map-ийн утга — эхний алдаагаар тэр эх алгасагдана
    const measureSet = new Set(measures);
    for (const { s, tbl, mp, legs } of srcPlan) {
      if (!own.has(tbl)) continue;
      const warn = (m) => out.push({ code: 'ledger_skip', message: `ledgers.yaml «${name}» / «${str(s.table)}»: ${m} (эх алгасав)` });
      if (!pathOk(S, tbl, str(s.date), 4)) { warn('`date` багана / FK зам алга'); continue; }
      const leaf = (v) => (pathOk(S, tbl, v, 4) ? '' : `багана / FK зам «${v}» алга`);
      let skip = false;
      for (const leg of legs) {
        const m2 = { ...mp };
        for (const [k, v] of Object.entries(leg)) if (k !== 'sign' && k !== 'when') m2[k] = v;
        for (const k of Object.keys(m2).sort()) {
          const v = m2[k];
          if (typeof v === 'number') continue;
          if (typeof v !== 'string') { warn(`map «${k}» — утга буруу`); skip = true; break; }
          const t = v.trim();
          const e = measureSet.has(k) ? valueWalk(t, leaf, 'хоосон утга') : t.length >= 2 && t[0] === "'" && t.endsWith("'") ? '' : leaf(t);
          if (e) { warn(`map «${k}» — ${e}`); skip = true; break; }
        }
        if (skip) break;
      }
    }
  }
  return out;
}

const OPERAND_FN = new Set(['year', 'month', 'day', 'quarter', 'hours', 'distance', 'root', 'depth']); // T3b WP-K: root/depth
// огнооны токен (`month_start(today)`) — шүүлтээс өмнө утгаар солигдоно; жагсаалт нь expr/DateTokens.h (DATE_TOKENS) — T4: `tomorrow` г.м. биш
const DATE_TOKEN = { test: (n) => DATE_TOKENS.has(n) };
const FILTER_WORDS = new Set(['and', 'or', 'not', 'in', 'null', 'true', 'false', 'like', 'between', 'is']);
// T4 (DataPolicy.cpp operand): харагдацын шүүлтийн латин нэр — багана, огнооны токен, түлхүүр үг биш бол сервер «зам '<x>.<нэр>'» гэж алгасна
function bareWordError(S, tbl, f) {
  const plain = f.replace(/'[^']*'|"[^"]*"/g, "''");
  for (const m of plain.matchAll(/(^|[^\p{L}\p{N}_.])([a-z_][a-z0-9_]*)(?![\p{L}\p{N}_.(])/gu)) {
    const w = m[2];
    if (FILTER_WORDS.has(w) || DATE_TOKENS.has(w) || S.column(tbl, w)) continue;
    return `зам '${w}.<нэр>' хэлбэртэй байх ёстой`;
  }
  return '';
}

// T4 WP-U (Тоду todu-mobile S-M09-005): харагдацын шүүлтийн `user.<Контекст>[.<Багана|FK зам>]` — SolutionDeploy.cpp rowFilterCtxPaths-тай ижил:
//   контекстын нэр (хамгийн урт), араас нь context.yaml-ийн хүснэгтийн багана/FK зам (хамгийн урт баганын нэр). Шийдэгдээгүй бол алдааны текст.
//   contexts: Map<нэр, хүснэгт|''> (null — шалгахгүй)
export function userCtxPathError(S, contexts, f) {
  if (!contexts) return '';
  const plain = f.replace(/'[^']*'|"[^"]*"/g, (m) => ' '.repeat(m.length));
  const isL = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
  for (let i = plain.indexOf('user.'); i >= 0; i = plain.indexOf('user.', i + 5)) {
    if (i > 0 && (isL(plain[i - 1]) || plain[i - 1] === '.')) continue;
    const rest = plain.slice(i + 5);
    if (!rest || rest.charCodeAt(0) < 0x80) continue; // user.code, user.orgCode …
    let cname = '';
    for (const n of contexts.keys()) if (rest.startsWith(n) && !isL(rest[n.length]) && n.length > cname.length) cname = n;
    if (!cname) return `user.<…> — context.yaml-д ийм контекст алга («${rest.split(/\s*(==|!=|<=|>=|<|>|\)|,| and | or )/)[0].trim()}»)`;
    if (rest[cname.length] !== '.') continue;
    let cur = contexts.get(cname) ? S.table(contexts.get(cname)) : '';
    if (!cur) return `user.${cname}.<…> — контекст хүснэгтгүй (context.yaml table)`;
    let q = cname.length, ok = false;
    while (rest[q] === '.' && cur) {
      let best = '';
      for (const c of S.columnsOf(cur)) if (c.length > best.length && rest.startsWith(c, q + 1) && !isL(rest[q + 1 + c.length])) best = c;
      if (!best) { ok = false; break; }
      q += 1 + best.length;
      ok = true;
      const next = S.fk(cur, best);
      if (rest[q] === '.' && !next) { ok = false; break; }
      cur = next;
    }
    if (!ok) return `user.${cname}.<…> — «${contexts.get(cname)}» хүснэгтийн багана/FK зам шийдэгдсэнгүй («${rest.slice(cname.length + 1).split(/\s*(==|!=|<=|>=|<|>|\)|,| and | or )/)[0].trim()}»)`;
  }
  return '';
}

// P-WP-10: системийн аудит баганын (Бүртгэсэн/Зассан хүн, огноо) хоригийн мессеж — SolutionDeploy.cpp kAuditReadOnly-тэй ижил
const AUDIT_RO = 'системийн багана (зөвхөн унших)';

// мөрийн шүүлт (X0 → DataPolicy.cpp compileRowFilter) болох илэрхийллийн алдаа: харагдацын шүүлт, P-WP-4 highlight.when — '' бол зөв
function rowFilterError(S, tbl, contexts, f) {
  if (/(^|[^\p{L}\p{N}_.])id(?![\p{L}\p{N}_.])/u.test(f.replace(/'[^']*'|"[^"]*"/g, "''"))) return "зам 'id.<нэр>' хэлбэртэй байх ёстой";
  { const e = bareWordError(S, tbl, f); if (e) return e; }
  { const e = userCtxPathError(S, contexts, f); if (e) return e; }
  for (const m of f.matchAll(/([\p{L}_][\p{L}\p{N}_]*)\s*\(/gu)) {
    const fn = m[1];
    if (OPERAND_FN.has(fn) || DATE_TOKEN.test(fn)) continue;
    let d = 0, j = m.index + m[0].length - 1;
    for (; j < f.length; j++) { if (f[j] === '(') d++; else if (f[j] === ')' && --d === 0) break; }
    const before = f.slice(0, m.index).trimEnd(), after = f.slice(j + 1).trimStart();
    if (/(==|!=|<=|>=|<|>|=)$/.test(before) || /^(==|!=|<=|>=|<|>|=)/.test(after))
      return `'${fn}()' операнд мөрийн шүүлтэд дэмжигдээгүй (year, month, day, quarter, hours, distance, root, depth)`;
  }
  return '';
}

// P-WP-4: X0 нөхцөлийн кирилл нэр (литерал, user.<…>-ээс гадна) — багана эсвэл FK зам биш бол (SolutionDeploy.cpp translateExpr «шийдэгдээгүй нэр»)
function unresolvedNames(S, tbl, f) {
  if (/(^|[^\p{L}\p{N}_.])(exists|member)\s*\(/u.test(f)) return []; // хүснэгтийн нэртэй функц — серверт
  const plain = f.replace(/'[^']*'|"[^"]*"/g, "''");
  const out = [];
  for (const m of plain.matchAll(/[^\x00-\x7F][^\x00-\x7F .-]*(?:[ .-][^\x00-\x7F][^\x00-\x7F .-]*)*/gu)) {
    const before = plain.slice(0, m.index);
    if (/[.\p{L}\p{N}_]$/u.test(before)) continue; // user.<Контекст>, record.<Нэр> — тусдаа шалгана
    const name = m[0].trim();
    if (name && !pathOk(S, tbl, name)) out.push(name);
  }
  return out;
}

// P-WP-4: list/childGrid-ийн `footer: {<Багана>: fn}` ба `highlight: [{when, style, columns}]` — SolutionDeploy.cpp presentation()-тэй ижил мессеж
function presentationErrors(S, tbl, contexts, o, warn, pre) {
  if (isObj(o.footer)) for (const k of Object.keys(o.footer)) if (!S.column(tbl, k)) warn(`${pre}footer «${k}» — багана алга`);
  for (const h of asList(o.highlight)) {
    if (!isObj(h)) continue;
    const w = str(h.when);
    const un = w.trim() ? unresolvedNames(S, tbl, w) : [];
    const e = !w.trim() ? 'X0 нөхцөл (текст) хүлээгдэж байна' : un.length ? `шийдэгдээгүй нэр: ${un.join(', ')}` : rowFilterError(S, tbl, contexts, w);
    if (e) { warn(`${pre}highlight «${w}» — ${e} (алгасав)`); continue; }
    for (const c of asList(h.columns)) if (!S.column(tbl, str(c))) warn(`${pre}highlight «${w}»: багана «${str(c)}» алга`);
  }
}

// screens.yaml — form/list дэлгэцийн талбар, багана, хүү grid, lookup, kanban/calendar
//   groups: багцын бүлгийн нэрс (жижиг үсгээр; roles.csv ∪ seed groups/users.roles ∪ states `хэн`) — null бол үүргийг шалгахгүй
// P-WP-23 (A3-1): screen/GridLink.cpp layoutMasterError-тэй ижил дүрэм/мессеж — `master` нь эхлээд ИЖИЛ табын тэр хүснэгтийн grid,
// ижил табд алга бол дэлгэцийн цорын ганц grid; ижил табд олон, эсвэл (ижил табд алга ба) дэлгэцэд олон → олон утгатай
export function layoutMasterError(layout) {
  if (!isObj(layout)) return '';
  const refs = [];
  const add = (g, tab) => { if (isObj(g)) refs.push({ tab, table: str(g.table).trim(), master: typeof g.master === 'string' ? g.master.trim() : '', has: g.master !== undefined }); };
  for (const x of asList(layout.sections)) if (isObj(x)) add(x.childGrid, -1);
  asList(layout.tabs).forEach((t, ti) => {
    if (!isObj(t)) return;
    add(t.childGrid, ti);
    for (const x of asList(t.sections)) if (isObj(x)) add(x.childGrid, ti);
  });
  for (const [i, r] of refs.entries()) {
    if (!r.has) continue;
    const all = refs.filter((o, j) => j !== i && o.table === r.master), same = all.filter((o) => o.tab === r.tab);
    const res = !r.master || r.master === r.table ? -1 : same.length === 1 ? 0 : same.length > 1 ? -2 : all.length === 1 ? 0 : all.length ? -2 : -1;
    if (res === -1) return `childGrid «${r.table}»: master «${r.master}» — энэ дэлгэцийн өөр childGrid-ийн хүснэгт байх ёстой`;
    if (res === -2) return `childGrid «${r.table}»: master «${r.master}» — энэ дэлгэцэд «${r.master}»-ийн хэд хэдэн grid байна; master grid-тэй нэг табд байрлуулна уу (таб \`stacked: true\`)`;
  }
  return '';
}

export function screenErrors(S, screens, groups = null, contexts = null, xref = {}) {
  const out = [];
  const roleCheck = (warn, roles) => { if (groups && Array.isArray(roles)) for (const r of roles) if (typeof r === 'string' && !groups.has(r.trim().toLowerCase())) warn(`үүрэг «${r}» олдсонгүй`); };
  const fkTo = (ct, parent) => S.columnsOf(ct).find((c) => S.fk(ct, c) === parent);
  // P-WP-29: тодорхой маягт (`form`) — энэ хүснэгтийн form дэлгэц байх ёстой (SolutionDeploy.cpp formScreenTable-тэй ижил мессеж)
  const formRef = (warn, where, fid, tname) => {
    const t = xref.formTableOf?.(str(fid));
    if (t === undefined) return;
    if (t === null) warn(`${where}form «${str(fid)}» — form дэлгэц алга`);
    else if (S.table(t) !== S.table(tname)) warn(`${where}form «${str(fid)}» — «${tname}» хүснэгтийн маягт биш`);
  };
  // P-WP-29 (G-FTREE): lookup `tree` — лавлахын модны (эцэгтэй) хүснэгт рүү FK
  const treeRef = (warn, where, ref, t) => {
    const cn = typeof t === 'string' ? t : isObj(t) ? str(t.column) : '';
    if (!ref || S.opaque(ref)) return;
    const tt = S.column(ref, cn) ? S.fk(ref, cn) : '';
    if (!tt || (!S.opaque(tt) && !S.treeParent(tt))) warn(`${where}tree «${cn}» — лавлахын модны (эцэгтэй) хүснэгт рүү FK биш`);
  };
  for (const s of screens) {
    if (!isObj(s)) continue;
    const kind = s.type === undefined ? 'form' : s.type;
    if (kind === 'task' || s.process !== undefined) continue;
    if (kind === 'page') { if (s.back !== undefined && typeof s.back !== 'boolean' && !(typeof s.back === 'string' && s.back.trim())) out.push({ code: 'screen_skip', message: `screens.yaml «${str(s.id)}»: back — true эсвэл товчны бичиг` }); continue; }
    const id = str(s.id), tname = str(s.table), tbl = S.table(tname);
    if (!tbl || S.opaque(tbl)) continue;
    const warn = (m) => out.push({ code: 'screen_skip', message: `screens.yaml «${id}»: ${m}` });
    if (kind === 'list') {
      for (const c of asList(s.columns)) if (typeof c === 'string' && !S.column(tbl, c)) warn(`багана «${c}» алга`);
      for (const o of asList(s.sort)) if (isObj(o) && !S.column(tbl, str(o.field))) warn(`sort «${str(o.field)}» алга`); // P-WP-10: SolutionDeploy.cpp translateListScreen
      if (isObj(s.kanban) && !S.column(tbl, str(s.kanban.by))) warn(`kanban.by «${str(s.kanban.by)}» алга`);
      if (isObj(s.calendar) && !S.column(tbl, str(s.calendar.start))) warn(`calendar.start «${str(s.calendar.start)}» алга`);
      // харагдацын шүүлт: мөрийн шүүлтэд (DataPolicy.cpp) харьцуулалтын операнд функц зөвхөн year/month/day/quarter/hours/distance/root/depth
      for (const v of asList(s.views)) { const e = rowFilterError(S, tbl, contexts, str(v?.filter)); if (e) warn(`харагдац «${str(v?.name)}»: шүүлт «${str(v?.filter)}» — ${e} (алгасав)`); }
      // P-WP-4: баганын объект {column, …}, footer, highlight (SolutionDeploy.cpp translateListScreen)
      for (const c of asList(s.columns)) if (isObj(c) && c.expr === undefined && !S.column(tbl, str(c.column))) warn(`багана «${str(c.column)}» алга`);
      presentationErrors(S, tbl, contexts, s, warn, '');
      if (s.form !== undefined) formRef(warn, '', s.form, tname); // P-WP-29 (G-LISTFORM)
      continue;
    }
    const layout = isObj(s.layout) ? s.layout : {};
    // T3 WP-D / P-WP-23 (A3-1): master — эхлээд ижил табын grid; олдоогүй/олон утгатай → plan-ийн алдаа (SolutionDeploy.cpp screenMasterError, screen/GridLink.cpp)
    { const me = layoutMasterError(layout); if (me) out.push({ code: 'screen_master', message: `screens.yaml «${id}»: ${me}` }); }
    for (const t of asList(layout.tabs)) if (isObj(t) && t.stacked !== undefined && typeof t.stacked !== 'boolean') warn(`таб «${str(t.title)}»: stacked — true | false`);
    const grid = (g) => {
      const ct = S.table(str(g.table));
      if (!ct) { warn(`хүү хүснэгт «${str(g.table)}» олдсонгүй`); return; }
      if (S.opaque(ct)) return;
      const master = typeof g.master === 'string' ? S.table(g.master) : '';
      if (g.master !== undefined && !master) { warn(`childGrid «${str(g.table)}»: master хүснэгт олдсонгүй`); return; }
      // P-WP-12: `via: <FK багана>` — эцэг рүү хоёр+ FK-тай хүү хүснэгтэд аль FK-аар (SolutionDeploy.cpp grid-тэй ижил мессеж)
      if (g.via !== undefined) {
        const vc = str(g.via);
        if (!S.column(ct, vc) || S.fk(ct, vc) !== (master || tbl)) { warn(`childGrid «${str(g.table)}»: via «${vc}» — «${master ? str(g.master) : tname}» руу FK багана биш — хүү grid алгасав`); return; }
      } else if (!fkTo(ct, master || tbl)) { warn(`«${str(g.table)}» нь «${master ? str(g.master) : tname}» руу FK-гүй — хүү grid алгасав`); return; }
      // P-WP-12: тооцоолсон багана {label, expr} — серверт (тайлангийн илэрхийллийн хэл: FK зам, арифметик, sum(<Хүүхэд>.<Багана>), iff); нэрийг deploy шалгана
      for (const c0 of asList(g.columns)) { if (isObj(c0) && c0.expr !== undefined && c0.column === undefined) continue; const c = isObj(c0) ? str(c0.column) : c0; if (typeof c === 'string' && !S.column(ct, c)) warn(`«${str(g.table)}»: багана «${c}» алга`); }
      presentationErrors(S, ct, contexts, g, warn, `childGrid «${str(g.table)}»: `); // P-WP-4
      // T4: childGrid.editableWhen — эцэг бичлэгийн нөхцөл (нэрсийн шийдэл/хөрвүүлэлтийг deploy шалгана)
      if (g.editableWhen !== undefined && (typeof g.editableWhen !== 'string' || !g.editableWhen.trim() || master))
        warn(`childGrid «${str(g.table)}»: editableWhen — ${typeof g.editableWhen !== 'string' || !g.editableWhen.trim() ? 'X0 нөхцөл (текст) хүлээгдэж байна' : 'master-тэй grid-д дэмжигдэхгүй'} (алгасав)`);
      // T4: childGrid.lookups — FK баганын сонгогч (SolutionDeploy.cpp translateFormScreen grid-тэй ижил мессеж)
      if (isObj(g.lookups)) for (const [k, lk] of Object.entries(g.lookups)) {
        if (S.audit?.(ct, k)) { warn(`childGrid «${str(g.table)}»: lookups «${k}» — ${AUDIT_RO}, алгасав`); continue; } // P-WP-10
        const ref = S.column(ct, k) ? S.fk(ct, k) : '';
        if (!ref || !isObj(lk)) { warn(`childGrid «${str(g.table)}»: lookups «${k}» — FK багана биш, алгасав`); continue; }
        if (lk.display !== undefined && !S.opaque(ref) && !S.column(ref, str(lk.display))) warn(`lookups.display «${str(lk.display)}» алга`);
        if (lk.tree !== undefined) treeRef(warn, `childGrid «${str(g.table)}»: lookups «${k}»: `, ref, lk.tree);
      }
      if (g.form !== undefined) formRef(warn, `childGrid «${str(g.table)}»: `, g.form, str(g.table)); // P-WP-29 (G-ALTFORM)
      // P-WP-33 (G-POSADD): quickAdd {column: FK, qty: тоон багана, barcode: лавлахын багана} — SolutionDeploy.cpp grid-тэй ижил мессеж
      if (isObj(g.quickAdd)) {
        const qa = g.quickAdd, pre = `childGrid «${str(g.table)}»: quickAdd`;
        const cn = str(qa.column), ref = S.column(ct, cn) && !S.audit?.(ct, cn) ? S.fk(ct, cn) : '';
        if (!ref) warn(`${pre}.column «${cn}» — «${str(g.table)}»-ийн FK багана биш (алгасав)`);
        else {
          if (qa.qty !== undefined && (!S.column(ct, str(qa.qty)) || S.fk(ct, str(qa.qty)) || colKind(S.colType(ct, str(qa.qty))) !== 'number')) warn(`${pre}.qty «${str(qa.qty)}» — тоон багана биш (алгасав)`);
          if (qa.barcode !== undefined && !S.opaque(ref) && !S.column(ref, str(qa.barcode))) warn(`${pre}.barcode «${str(qa.barcode)}» «${ref}»-д алга (алгасав)`);
        }
      }
    };
    const tabs = Array.isArray(layout.tabs) ? layout.tabs : [{ sections: asList(layout.sections) }];
    for (const t of tabs) {
      if (!isObj(t)) continue;
      roleCheck(warn, t.roles);
      if (isObj(t.childGrid)) { grid(t.childGrid); continue; }
      for (const sec of asList(t.sections)) {
        if (!isObj(sec)) continue;
        roleCheck(warn, sec.roles); // T4: childGrid хэсгийн roles ч (deploy табад шилжүүлнэ)
        if (isObj(sec.childGrid)) { grid(sec.childGrid); continue; }
        for (const f0 of asList(sec.fields)) {
          const f = typeof f0 === 'string' ? { field: f0 } : f0;
          if (!isObj(f) || (f.expr !== undefined && f.field === undefined)) continue;
          const fld = str(f.field);
          if (!S.column(tbl, fld)) { warn(`талбар «${fld}» «${tname}»-д алга — алгасав`); continue; }
          roleCheck(warn, f.roles);
          // P-WP-10: системийн аудит багана — үргэлж зөвхөн унших (deploy readOnly-г хүчилнэ); засах/заавал/сонгогч — SolutionDeploy.cpp-тэй ижил мессеж
          if (S.audit?.(tbl, fld)) {
            const why = f.readOnly === false ? 'readOnly: false' : f.required !== undefined && f.required !== false ? 'required' : f.requiredWhen !== undefined ? 'requiredWhen' : f.lookup !== undefined ? 'lookup' : '';
            if (why) warn(`талбар «${fld}»: ${why} — ${AUDIT_RO}, алгасав`);
            continue;
          }
          if (isObj(f.lookup)) {
            const ref = S.fk(tbl, fld);
            if (!ref) warn(`талбар «${fld}»: lookup — FK багана биш, алгасав`);
            else if (f.lookup.display !== undefined && !S.opaque(ref) && !S.column(ref, str(f.lookup.display))) warn(`lookup.display «${str(f.lookup.display)}» алга`);
            if (ref && f.lookup.tree !== undefined) treeRef(warn, `талбар «${fld}»: lookup `, ref, f.lookup.tree);
          }
        }
      }
    }
    for (const a of asList(s.actions)) if (isObj(a)) roleCheck(warn, a.roles);
    // P-WP-29 (G-SETBTN): set — талбар (аудит/төлвийн биш), {where} зөвхөн FK талбарт, нөхцөлийн нэр лавлах хүснэгтэд (SolutionDeploy.cpp-тэй ижил мессеж)
    for (const a of asList(s.actions)) {
      if (!isObj(a) || a.type !== 'set') continue;
      const lbl = str(a.label);
      if (!isObj(a.set) || !Object.keys(a.set).length) { warn(`товч «${lbl}»: set — {<Талбар>: <илэрхийлэл>} заавал`); continue; }
      for (const [k, v] of Object.entries(a.set)) {
        if (!S.column(tbl, k) || S.audit?.(tbl, k)) { warn(`товч «${lbl}»: set «${k}» — талбар алга (аудит/төлвийн багана хориотой)`); continue; }
        if (!isObj(v)) continue;
        const ref = S.fk(tbl, k);
        if (!ref || !str(v.where).trim()) { warn(`товч «${lbl}»: set «${k}» — {where} зөвхөн FK талбарт, нөхцөл заавал`); continue; }
        const un = S.opaque(ref) ? [] : unresolvedNames(S, ref, str(v.where));
        const e = S.opaque(ref) ? '' : un.length ? `шийдэгдээгүй нэр: ${un[0]}` : rowFilterError(S, ref, contexts, str(v.where));
        if (e) warn(`товч «${lbl}»: set «${k}».where «${str(v.where)}» — ${e}`);
      }
    }
    // P-WP-29 (G-APPFORM): хувилбарын `apps`
    for (const ap of asList(s.apps)) if (xref.appKnown?.(str(ap)) === false) out.push({ code: 'action_target_pending', severity: 'warning', message: `screens.yaml «${id}»: apps: апп «${str(ap)}»${PENDING_HINT}` }); // P-WP-51
    if (s.apps !== undefined && s.variant !== true) warn('apps: зөвхөн хувилбар форм (`variant: true`)-д');
    roleCheck(warn, s.roles);
  }
  return out;
}

// WP-T: form дэлгэцийн (screens.yaml, нэрээр) таб/хэсэг/товчны гарчиг — SolutionDeploy.cpp translateFormScreen-ийн табын хуваалттай ижил
// (хэсэг дэх childGrid → тусдаа таб; табгүй layout → гарчиггүй нэг таб). tabs: [{title, sections: [гарчиг] | null}], actions: [label]
export function screenOutline(s) {
  const layout = isObj(s?.layout) ? s.layout : {};
  const tabsIn = Array.isArray(layout.tabs) ? layout.tabs : [{ title: '', sections: asList(layout.sections) }];
  const tabs = [];
  for (const t of tabsIn) {
    if (!isObj(t)) continue;
    const tt = str(t.title);
    if (isObj(t.childGrid) || t.block !== undefined) { tabs.push({ title: tt, sections: null }); continue; }
    let cur = null;
    for (const sec of asList(t.sections)) {
      if (!isObj(sec)) continue;
      if (isObj(sec.childGrid)) { cur = null; tabs.push({ title: sec.title !== undefined ? str(sec.title) : tt, sections: null }); continue; }
      if (!cur) { cur = { title: tt, sections: [] }; tabs.push(cur); }
      cur.sections.push(str(sec.title));
    }
  }
  return { tabs, actions: asList(s?.actions).filter(isObj).map((a) => str(a.label)) };
}

// WP-T: screens.yaml `extends` — өргөтгөлийн хэсгүүдийг эзэмшигчийн outline дээр (tabs → sections → actions дарааллаар) байрлуулж шалгана.
// SolutionDeploy.cpp extensionPlanErrors-тэй ижил код/мессеж: screen_extends_conflict (эзэмшигчийн/өмнөх таб, хэсэг, товчтой ижил нэр),
// screen_extends_anchor (tab/after олдсонгүй). outline-ийг өөрчилнө (дараагийн өргөтгөл энэ өргөтгөлийн хэсгийг байрлал болгож болно).
export function extensionErrors(ext, outline) {
  const out = [];
  const ref = str(ext?.extends);
  const bad = (code, m) => out.push({ code, message: `screens.yaml extends «${ref}»: ${m}` });
  const addTab = (title, after) => {
    if (title && outline.tabs.some((t) => t.title === title)) { bad('screen_extends_conflict', `таб «${title}» дэлгэцэд аль хэдийн байна (өргөтгөл дахин тодорхойлохгүй)`); return; }
    if (after && !outline.tabs.some((t) => t.title === after)) { bad('screen_extends_anchor', `таб «${after}» (after) олдсонгүй`); return; }
    outline.tabs.push({ title, sections: null });
  };
  for (const t of asList(ext?.tabs)) if (isObj(t)) addTab(str(t.title), str(t.after));
  for (const sec of asList(ext?.sections)) {
    if (!isObj(sec)) continue;
    if (isObj(sec.childGrid)) { addTab(str(sec.title), str(sec.after)); continue; }
    const tab = str(sec.tab), after = str(sec.after), title = str(sec.title);
    const cands = outline.tabs.filter((t) => t.sections && (!tab || t.title === tab));
    if (!cands.length) { bad('screen_extends_anchor', tab ? `таб «${tab}» (tab) олдсонгүй` : 'хэсэгтэй таб алга'); continue; }
    const target = after ? cands.find((t) => t.sections.includes(after)) : cands[0];
    if (!target) { bad('screen_extends_anchor', `хэсэг «${after}» (after) «${tab || cands[0].title}» табд олдсонгүй`); continue; }
    if (title && target.sections.includes(title)) { bad('screen_extends_conflict', `хэсэг «${title}» дэлгэцэд аль хэдийн байна (өргөтгөл дахин тодорхойлохгүй)`); continue; }
    target.sections.push(title);
  }
  for (const f of asList(ext?.fields)) { // P-WP-51 (EXT-FIELDS): ScreenExtension.cpp placeErrors-тэй ижил мессеж
    if (!isObj(f)) continue;
    const section = str(f.section), name = str(f.field) || str(f.label);
    if (!section) { bad('screen_extends_anchor', `талбар «${name}»: section — эзэмшигчийн хэсгийн гарчиг заавал`); continue; }
    if (!outline.tabs.some((t) => t.sections && t.sections.includes(section))) bad('screen_extends_anchor', `талбар «${name}»: хэсэг «${section}» (section) олдсонгүй`);
  }
  for (const a of asList(ext?.actions)) {
    if (!isObj(a)) continue;
    const label = str(a.label), after = str(a.after);
    if (label && outline.actions.includes(label)) { bad('screen_extends_conflict', `товч «${label}» дэлгэцэд аль хэдийн байна (өргөтгөл дахин тодорхойлохгүй)`); continue; }
    if (after && !outline.actions.includes(after)) { bad('screen_extends_anchor', `товч «${after}» (after) олдсонгүй`); continue; }
    outline.actions.push(label);
  }
  return out;
}

// P-WP-27 (A2-8): list дэлгэцийн outline (нэрээр) — баганы нэр/шошго, шүүлтийн нэр/шошго, товч. SolutionDeploy.cpp listOutlineOf-тэй ижил утга.
export function listOutline(s) {
  const columns = [], filters = [], actions = [];
  for (const c of asList(s?.columns)) {
    if (typeof c === 'string') { columns.push(c.trim()); continue; }
    if (!isObj(c)) continue;
    if (c.label !== undefined) columns.push(str(c.label));
    if (c.column !== undefined) columns.push(str(c.column));
  }
  for (const f of asList(s?.filters)) if (isObj(f)) { filters.push(filterName(f)); if (f.label !== undefined) filters.push(str(f.label)); }
  for (const a of asList(s?.actions)) if (isObj(a)) actions.push(str(a.label));
  return { columns, filters, actions, tree: isObj(s?.tree) }; // P-WP-31 (G-EXTTREE)
}
// P-WP-27 (A2-8): list өргөтгөлийн байрлал/давхцал — ScreenExtension.cpp placeListErrors-тэй ижил код/мессеж (outline-ийг шинэчилнэ)
export function listExtensionErrors(ext, o) {
  const out = [];
  const ref = str(ext?.extends);
  const bad = (code, m) => out.push({ code, message: `screens.yaml extends «${ref}»: ${m}` });
  if (ext?.tabs !== undefined || ext?.sections !== undefined) bad('screen_extends', 'list дэлгэцэд tabs/sections биш — columns, filters, actions, tree, back');
  if (ext?.tree !== undefined) { // P-WP-31 (G-EXTTREE): ScreenExtension.cpp placeListErrors-тэй ижил
    if (o.tree) bad('screen_extends_conflict', 'дэлгэц аль хэдийн модтой (tree — өргөтгөл дахин тодорхойлохгүй)');
    o.tree = true;
  }
  for (const c of asList(ext?.columns)) {
    if (!isObj(c) && typeof c !== 'string') continue;
    const label = typeof c === 'string' ? c.trim() : str(c.label) || str(c.column);
    const after = isObj(c) ? str(c.after) : '';
    if (after && !o.columns.includes(after)) { bad('screen_extends_anchor', `багана «${after}» (after) олдсонгүй`); continue; }
    o.columns.push(label);
  }
  for (const f of asList(ext?.filters)) {
    if (!isObj(f)) continue;
    const name = filterName(f), after = str(f.after);
    if (name && o.filters.includes(name)) { bad('screen_extends_conflict', `шүүлт «${name}» дэлгэцэд аль хэдийн байна (өргөтгөл дахин тодорхойлохгүй)`); continue; }
    if (after && !o.filters.includes(after)) { bad('screen_extends_anchor', `шүүлт «${after}» (after) олдсонгүй`); continue; }
    o.filters.push(name);
  }
  for (const a of asList(ext?.actions)) {
    if (!isObj(a)) continue;
    const label = str(a.label), after = str(a.after);
    if (label && o.actions.includes(label)) { bad('screen_extends_conflict', `товч «${label}» дэлгэцэд аль хэдийн байна (өргөтгөл дахин тодорхойлохгүй)`); continue; }
    if (after && !o.actions.includes(after)) { bad('screen_extends_anchor', `товч «${after}» (after) олдсонгүй`); continue; }
    o.actions.push(label);
  }
  return out;
}
// P-WP-27 (A2-8): list өргөтгөлийг эзэмшигчийн хүснэгт дээрх list дэлгэц болгоно (uiErrors/screenErrors-ийн нэрийн шалгалтад)
export function listExtensionAsScreen(ext, ownerId, ownerTable, ownerFilters = []) {
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'after'));
  return { id: ownerId, type: 'list', table: ownerTable, __ownerFilters: ownerFilters, // P-WP-51 (EXT-OWNFILTER): товчны filter.<эзэмшигчийн шүүлт>
    columns: asList(ext?.columns).map((c) => (isObj(c) ? strip(c) : c)), filters: asList(ext?.filters).filter(isObj).map(strip), actions: asList(ext?.actions).filter(isObj).map(strip),
    ...(isObj(ext?.tree) ? { tree: ext.tree } : {}), ...(ext?.back !== undefined ? { back: ext.back } : {}) }; // P-WP-31 (G-EXTTREE, E-BACK)
}

// WP-T: өргөтгөлийг эзэмшигчийн хүснэгт дээрх form дэлгэц болгоно (screenErrors-ийн нэрийн шалгалтад; сервер translateFormScreen-д ижил)
export function extensionAsScreen(ext, ownerId, ownerTable) {
  const strip = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  const tabs = asList(ext?.tabs).filter(isObj).map((t) => strip(t, ['after']));
  for (const sec of asList(ext?.sections)) {
    if (!isObj(sec)) continue;
    if (isObj(sec.childGrid)) tabs.push({ title: str(sec.title), childGrid: sec.childGrid, ...(sec.roles ? { roles: sec.roles } : {}) });
    else tabs.push({ title: '', sections: [strip(sec, ['tab', 'after'])] });
  }
  const fields = asList(ext?.fields).filter(isObj).map((f) => strip(f, ['section', 'after'])); // P-WP-51 (EXT-FIELDS): нэрийн шалгалтад нэг хэсэг
  if (fields.length) tabs.push({ title: '', sections: [{ title: '', fields }] });
  return { id: ownerId, type: 'form', table: ownerTable, layout: { tabs }, actions: asList(ext?.actions).filter(isObj).map((a) => strip(a, ['after'])) };
}

// reports.yaml — join/union/layout-гүй тайлангийн groupBy, measures.field, columns (эх хүснэгтээс FK зам); join-ийн хүснэгтийн талбар серверт
export function reportErrors(S, reports, ledgers = []) {
  const out = [];
  for (const y of reports) {
    if (isObj(y) && y.layout === undefined) out.push(...reportTailErrors(y));
    else if (isObj(y) && y.highlight !== undefined) out.push({ code: 'report_skip', message: `Тайлан «${str(y.name)}»: highlight — бүтэцтэй (layout) тайланд дэмжигдэхгүй` }); // P-WP-4
    if (isObj(y) && y.layout === undefined && str(y.source)) out.push(...reportExprErrors(y));
    if (isObj(y) && isObj(y.balance) && y.balance.columns !== undefined) out.push(...balanceColumnErrors(y, ledgers)); // P-WP-24
    if (isObj(y) && y.layout === undefined) out.push(...reportDynamicErrors(y)); // P-WP-26
    if (!isObj(y) || y.layout !== undefined || !str(y.source) || y.union !== undefined) continue;
    const tbl = S.table(str(y.source));
    if (!tbl || S.opaque(tbl)) continue;
    const joins = new Set(asList(y.join).map((j) => (typeof j === 'string' ? str(j) : isObj(j) ? str(j.as ?? j.table) : '')).filter(Boolean));
    const name = str(y.name);
    const chk = (p) => {
      const d = p.indexOf('.');
      if (d > 0 && joins.has(p.slice(0, d).trim())) return;
      if (!pathOk(S, tbl, p)) out.push({ code: 'report_skip', message: `Тайлан «${name}»: багана «${p}» олдсонгүй` });
    };
    for (const g of asList(y.groupBy)) if (typeof g === 'string') chk(g);
    for (const m of asList(y.measures)) if (isObj(m) && typeof m.field === 'string') chk(m.field);
    for (const c of asList(y.columns)) if (typeof c === 'string') chk(c);
    // шүүлт (buildSpec compileCond): and/or/хаалт; зүүн тал — багана/FK зам (date(X) зөвшөөрнө); баруун тал функц бол огнооны токен л
    if (y.balance !== undefined || joins.size) continue;
    const bad = (part, why) => out.push({ code: 'report_skip', message: `Тайлан «${name}»: шүүлт «${part}» ${why}` });
    const params = new Set(asList(y.params).map((p) => str(p?.name)));
    const lhsOk = (l) => { l = l.trim(); const dm = /^date\(\s*(.+?)\s*\)$/.exec(l); return pathOk(S, tbl, dm ? dm[1].trim() : l); };
    const cond = (part0) => {
      const part = stripOuterParens(part0);
      const ors = splitTopKw(part, ' or ');
      if (ors.length > 1) { for (const alt of ors) for (const a of splitTopKw(stripOuterParens(alt), ' and ')) if (!cond(a)) return false; return true; }
      const ands = splitTopKw(part, ' and ');
      if (ands.length > 1) { for (const a of ands) if (!cond(a)) return false; return true; }
      let m;
      // T3b WP-K: under(<багана|FK зам>, param.<Нэр>|'<id>') → {op: under}; модны эсэхийг сервер ажиллах үед (treeOfColumn) шалгана
      if ((m = /^under\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/.exec(part))) { if (pathOk(S, tbl, m[1].trim())) return true; bad(part, 'орчуулагдсангүй'); return false; }
      if (/^member\(/.test(part)) return true; // серверт (гишүүнчлэлийн хүснэгт)
      if (/^(exists|inside)\s*\(/.test(part)) return true; // P-WP-32 (R-AREAP): мөрийн шүүлтийн X0 — нэрсийг сервер (translateExpr) шалгана
      { // P-WP-25 (R-PCOND): параметр нэг талд, нөгөө тал литерал — report/ReportDsl.cpp parseParamCond-тэй ижил
        const pc = paramCond(part);
        if (pc) { if (params.has(pc)) return true; bad(part, `— параметр «${pc}» тодорхойлоогүй`); return false; }
      }
      if ((m = /^(not\s+)?empty\(\s*(.+?)\s*\)$/.exec(part)) || (m = /^(.+?)\s*(==|!=|=)\s*null$/.exec(part))) {
        if (lhsOk(part.includes('empty(') && /^(not\s+)?empty\(/.test(part) ? m[2] : m[1])) return true;
        bad(part, 'орчуулагдсангүй'); return false;
      }
      if ((m = /^(.+?)\s+(not\s+)?in\s*\((.+)\)$/.exec(part))) { if (lhsOk(m[1])) return true; bad(part, 'орчуулагдсангүй'); return false; }
      if ((m = /^(.+?)\s*(==|!=|>=|<=|>|<|=)\s*(.+)$/.exec(part))) {
        if (!lhsOk(m[1])) { if (m[1].includes('(') && !/^date\(/.test(m[1].trim())) return true; bad(part, 'орчуулагдсангүй'); return false; } // reportCalc — серверт
        const rhs = m[3].trim();
        if (rhs.startsWith('param.') || /^user\.(code|orgCode)$/.test(rhs) || dateToken(rhs)) return true;
        // T4 (todu-pricing `org == user.org`): өөр user.* токен утга (текст) болж хэзээ ч таарахгүй — SolutionDeploy.cpp-тэй ижил
        if (/^user\./.test(rhs)) { bad(part, 'user.<…> — тайлангийн шүүлтэд зөвхөн user.code, user.orgCode'); return false; }
        if (rhs.includes('(')) { bad(part, '(функц) алгасав'); return false; }
        return true;
      }
      bad(part, 'орчуулагдсангүй');
      return false;
    };
    for (const part of splitTopKw(str(y.filter), ' and ')) cond(part);
  }
  return out;
}

// P-WP-25 (R-PCOND): `param.<Нэр> <op> <литерал>` | `<литерал> <op> param.<Нэр>` | `param.<Нэр> [not] in (<литерал>, …)` → параметрийн нэр; бусад — null
// (литерал: '…' | "…" | тоо | true | false | null | огнооны токен; хоёр тал параметр эсвэл багана — null). report/ReportDsl.cpp parseParamCond-тэй ижил.
function paramCond(part) {
  const lit = (x) => { x = x.trim(); return /^'[^']*'$|^"[^"]*"$/.test(x) || /^(null|true|false)$/.test(x) || /^-?\d+(\.\d+)?$/.test(x) || dateToken(x); };
  let m = /^param\.(.+?)\s+(not\s+)?in\s*[(\[](.*)[)\]]$/u.exec(part);
  if (m) return m[3].split(',').every((v) => lit(v) && v.trim() !== 'null') ? m[1].trim() : null;
  m = /^(.+?)\s*(==|!=|<>|>=|<=|>|<|=)\s*(.+)$/u.exec(part);
  if (!m) return null;
  const pl = /^param\.([^()'"=!<>]+)$/u.exec(m[1].trim()), pr = /^param\.([^()'"=!<>]+)$/u.exec(m[3].trim());
  if (!!pl === !!pr) return null;
  return lit(pl ? m[3] : m[1]) ? (pl ?? pr)[1].trim() : null;
}
const REPORT_TEXT_FN = new Set(['concat', 'concat_ws']); // P-WP-25 (R-CONCAT)
// T4: илэрхийлэлт багана `{expr}` — SolutionDeploy.cpp reportCalc-ийн функцууд л (iff, round … алга → багана алгасагдаж, union-ы баганын тоо зөрнө);
// union хэсгийн баганын тоо үндсэнийхтэй тэнцүү (report_skip)
const REPORT_FN = new Set(['days', 'hours', 'year', 'quarter', 'month', 'day', 'week', 'period', 'coalesce', 'iff', 'distance', 'inside', 'share', 'running', 'max', 'min', 'sum', 'count', 'avg']); // P-WP-12: iff; P-WP-24: share; P-WP-26: running
function reportExprErrors(y) {
  const out = [], name = str(y.name);
  const exprFns = (cols) => {
    for (const c of asList(cols)) {
      if (!isObj(c) || typeof c.expr !== 'string' || /^\s*calc\s/.test(c.expr)) continue;
      const plain = c.expr.replace(/'[^']*'|"[^"]*"/g, "''");
      for (const m of plain.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        if (m[1] === 'days' || m[1] === 'hours') { // reportCalc: days(A - B) | hours(A - B) — таслалтай (X0-ийн hours(A, B)) хэлбэр биш
          let d = 0, j = m.index + m[0].length - 1, top = '';
          for (; j < plain.length; j++) { const ch = plain[j]; if (ch === '(') { if (d++ > 0) top += ' '; } else if (ch === ')') { if (--d === 0) break; top += ' '; } else top += d === 1 ? ch : ' '; }
          if (!/ - /.test(top)) { out.push({ code: 'report_skip', message: `Тайлан «${name}»: илэрхийлэлт багана «${c.expr}» — ${m[1]}(A - B) хэлбэртэй байх ёстой` }); break; }
          continue;
        }
        if (m[1] === 'running') { // P-WP-26: running(<утга>, <эрэмбэ>[, <бүлэг>…]) — 2–6 аргумент
          let d = 0, j = m.index + m[0].length - 1, commas = 0;
          for (; j < plain.length; j++) { const ch = plain[j]; if (ch === '(') d++; else if (ch === ')') { if (--d === 0) break; } else if (ch === ',' && d === 1) commas++; }
          if (commas < 1 || commas > 5) { out.push({ code: 'report_skip', message: `Тайлан «${name}»: илэрхийлэлт багана «${c.expr}» — running(<утга>, <эрэмбэ>[, <бүлэг>…]) — 2–6 аргумент` }); break; }
          continue;
        }
        if (m[1] === 'share' && /^share\s*\(\s*\)/.test(plain.slice(m.index))) { out.push({ code: 'report_skip', message: `Тайлан «${name}»: илэрхийлэлт багана «${c.expr}» — share(<утга>[, <бүлэг>…]) — 1–5 аргумент` }); break; }
        if (m[1] === 'concat_ws') { // P-WP-25: тусгаарлагч + дор хаяж нэг утга
          let d = 0, j = m.index + m[0].length - 1, commas = 0;
          for (; j < plain.length; j++) { const ch = plain[j]; if (ch === '(') d++; else if (ch === ')') { if (--d === 0) break; } else if (ch === ',' && d === 1) commas++; }
          if (commas < 1) { out.push({ code: 'report_skip', message: `Тайлан «${name}»: илэрхийлэлт багана «${c.expr}» — concat_ws(<тусгаарлагч>, a, b, …) — тусгаарлагч ба 1–20 утга` }); break; }
          continue;
        }
        if (REPORT_FN.has(m[1]) || REPORT_TEXT_FN.has(m[1]) || DATE_TOKENS.has(m[1])) continue;
        out.push({ code: 'report_skip', message: `Тайлан «${name}»: илэрхийлэлт багана «${c.expr}» — функц «${m[1]}» дэмжигдэхгүй (${[...REPORT_FN].join(', ')})` });
        break;
      }
    }
  };
  exprFns(y.columns);
  const n = asList(y.columns).length;
  for (const u of asList(y.union)) {
    if (!isObj(u)) continue;
    exprFns(u.columns);
    if (Array.isArray(u.columns) && Array.isArray(y.columns) && u.columns.length !== n)
      out.push({ code: 'report_skip', message: `Тайлан «${name}»: union «${str(u.source)}» баганын тоо (${u.columns.length}) үндсэнийхтэй (${n}) зөрүүтэй — алгасав` });
  }
  return out;
}

// P-WP-26 (G-DYN): `when` (параметрийн нөхцөл — and/or/not/хаалт), илэрхийлэл дэх `param.<Нэр>`, `sort[].dir: param.<Нэр>` — SolutionDeploy.cpp reports()
// (report/ReportDsl.cpp parseWhen-тэй ижил: зөвхөн `param.X <op> <литерал>` / `param.X [not] in (…)`, огнооны токенгүй)
export function whenError(text, params) {
  const rec = (raw, depth) => {
    if (depth > 12) return 'when — хэт гүн';
    const t = stripOuterParens(String(raw ?? '').trim());
    if (!t) return 'when — хоосон нөхцөл';
    for (const kw of [' or ', ' and ']) { const ps = splitTopKw(t, kw); if (ps.length > 1) { for (const x of ps) { const e = rec(x, depth + 1); if (e) return e; } return ''; } }
    if (t.startsWith('not ')) return rec(t.slice(4), depth + 1);
    const pc = paramCond(t);
    if (!pc || dateToken((/(==|!=|<>|>=|<=|>|<|=)\s*(.+)$/u.exec(t)?.[2] ?? '').trim())) return `«${t}» — зөвхөн параметрийн нөхцөл (param.<Нэр> == 'утга', != null, in (…)), and/or/not`;
    if (!params.has(pc)) return `параметр «${pc}» тодорхойлоогүй`;
    return '';
  };
  return typeof text === 'string' ? rec(text, 0) : 'текст нөхцөл байх ёстой';
}
function reportDynamicErrors(y) {
  const out = [], name = str(y.name), params = new Set(asList(y.params).map((p) => str(p?.name)));
  const skip = (m) => out.push({ code: 'report_skip', message: `Тайлан «${name}»: ${m}` });
  const label = (c) => (typeof c === 'string' ? c : str(c.label ?? c.expr ?? c.field));
  for (const c of [...asList(y.measures), ...asList(y.columns)]) {
    if (!isObj(c)) continue;
    if (c.when !== undefined) { const e = whenError(c.when, params); if (e) skip(`багана «${label(c)}»-ийн when — ${e}`); }
    if (typeof c.expr === 'string') for (const m of c.expr.replace(/'[^']*'|"[^"]*"/g, "''").matchAll(/param\.(.+?)(?=\s*(?:==|!=|<=|>=|<>|<|>|=|\)|,|\s[-+*/]\s|$))/gu))
      if (!params.has(m[1].trim())) { skip(`багана «${label(c)}» — параметр «${m[1].trim()}» тодорхойлоогүй (params)`); break; }
  }
  if (isObj(y.balance)) for (const c of asList(y.balance.columns)) if (isObj(c) && c.when !== undefined) { const e = whenError(c.when, params); if (e) skip(`balance.columns «${label(c)}»-ийн when — ${e}`); }
  for (const srt of asList(y.sort)) {
    const d = isObj(srt) && typeof srt.dir === 'string' ? srt.dir.trim() : '';
    if (d.startsWith('param.') && !params.has(d.slice(6).trim())) skip(`sort.dir — параметр «${d.slice(6).trim()}» тодорхойлоогүй`);
  }
  return out;
}

// P-WP-24 (R-BAL): calc илэрхийллийн навч (нэр) ба функцууд — SolutionDeploy.cpp reportCalc-ийн бүтэцтэй ижил задлал (дээд түвшний or/and/харьцуулалт/арифметик, функц)
function calcLeaves(e0, names, fns, depth = 0) {
  let e = String(e0 ?? '').trim();
  if (depth > 16 || !e) return;
  const wrapped = (t) => { if (t.length < 2 || t[0] !== '(' || t[t.length - 1] !== ')') return false; let p = 0, q = ''; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === q) q = ''; continue; } if (ch === "'" || ch === '"') q = ch; else if (ch === '(') p++; else if (ch === ')' && --p === 0 && i + 1 < t.length) return false; } return true; };
  while (wrapped(e)) e = e.slice(1, -1).trim();
  if (/^(null|true|false)$/.test(e) || /^-?[0-9]+(\.[0-9]+)?$/.test(e) || /^(['"]).*\1$/.test(e) || dateToken(e)) return;
  const top = (pred) => { let p = 0, q = ''; for (let i = 0; i < e.length; i++) { const ch = e[i]; if (q) { if (ch === q) q = ''; continue; } if (ch === "'" || ch === '"') { q = ch; continue; } if (ch === '(') { p++; continue; } if (ch === ')') { p--; continue; } if (p === 0) { const n = pred(i); if (n) return [i, n]; } } return null; };
  for (const kw of [' or ', ' and ']) { const t = top((i) => (e.startsWith(kw, i) ? kw.length : 0)); if (t) { calcLeaves(e.slice(0, t[0]), names, fns, depth + 1); calcLeaves(e.slice(t[0] + t[1]), names, fns, depth + 1); return; } }
  if (e.startsWith('not ')) { calcLeaves(e.slice(4), names, fns, depth + 1); return; }
  const c = top((i) => (['==', '!=', '<=', '>=', '<>'].includes(e.slice(i, i + 2)) ? 2 : '<>='.includes(e[i]) ? 1 : 0));
  if (c && c[0] > 0) { calcLeaves(e.slice(0, c[0]), names, fns, depth + 1); calcLeaves(e.slice(c[0] + c[1]), names, fns, depth + 1); return; }
  for (const ops of ['+-', '*/']) {
    let p = 0;
    for (let i = e.length - 1; i >= 1; i--) {
      const ch = e[i];
      if (ch === ')') p++; else if (ch === '(') p--;
      if (p !== 0 || !ops.includes(ch) || e[i - 1] !== ' ' || i + 1 >= e.length || e[i + 1] !== ' ') continue;
      calcLeaves(e.slice(0, i), names, fns, depth + 1); calcLeaves(e.slice(i + 1), names, fns, depth + 1); return;
    }
  }
  if (e.length > 1 && e[0] === '-' && e[1] !== ' ') { calcLeaves(e.slice(1), names, fns, depth + 1); return; }
  const fm = /^([A-Za-z_]+)\s*\((.*)\)$/s.exec(e);
  if (fm && ['max', 'min', 'sum', 'count', 'avg'].includes(fm[1])) { // P-WP-36 (R-BALPRICE): өөр хүснэгтийн нэгтгэл — `<agg>(<Хүснэгт>.<Талбар>, where … row.<нэр> …)`:
    // тэр хүснэгтийн нэрийг энэ мөрийн нэр гэж шалгахгүй; корреляцын гадна тал (`row.<нэр>`) л энэ мөрийн (by-ийн хэмжээс/шинж) нэр
    const w = /,\s*where\s+([\s\S]+)$/.exec(fm[2]);
    if (w && /(^|[^\p{L}\p{N}_.])row\./u.test(w[1].replace(/'[^']*'|"[^"]*"/g, "''"))) {
      fns.push('tableAgg');
      for (const part of splitTopKw(w[1], ' and ')) {
        const m = /^\(?\s*(.+?)\s*(==|!=|<=|>=|<>|<|>|=)\s*(.+?)\s*\)?$/su.exec(part.trim());
        if (!m) continue;
        for (const side0 of [m[1], m[3]]) { // P-WP-37 (R-AGGDATE): `date(row.<…>)` — ороолтыг авна
          const side = side0.trim().replace(/^date\s*\(\s*/u, '').replace(/\s*\)$/u, '');
          if (side.startsWith('row.')) names.push(side.slice(4));
        }
      }
      return;
    }
  }
  if (fm) {
    fns.push(fm[1]);
    let p = 0, q = '', from = 0;
    const inner = fm[2];
    for (let i = 0; i <= inner.length; i++) { const ch = i < inner.length ? inner[i] : ','; if (q) { if (ch === q) q = ''; continue; } if (ch === "'" || ch === '"') q = ch; else if (ch === '(') p++; else if (ch === ')') p--; else if (ch === ',' && p === 0) { calcLeaves(inner.slice(from, i), names, fns, depth + 1); from = i + 1; } }
    return;
  }
  names.push(e);
}
const BAL_MEASURES = ['Эхний үлдэгдэл', 'Орлого', 'Зарлага', 'Эцсийн үлдэгдэл'];
function balanceColumnErrors(y, ledgers = []) {
  const out = [], name = str(y.name), b = y.balance;
  const skip = (m) => out.push({ code: 'report_skip', message: `Тайлан «${name}»: ${m}` });
  if ((b.kind !== undefined && str(b.kind) !== 'balance') || b.rollup !== undefined) { skip('balance.columns — зөвхөн kind: balance (rollup-гүй) — алгасав'); return out; }
  const by = asList(b.by).filter((d) => typeof d === 'string').map((d) => d.trim());
  const plain = new Set(by.filter((d) => !d.includes('.')));
  const nameOk = (n) => { n = n.trim(); if (BAL_MEASURES.includes(n) || by.includes(n)) return true; const d = n.indexOf('.'); return d > 0 && plain.has(n.slice(0, d).trim()) && !!n.slice(d + 1).trim(); };
  // P-WP-37 (R-BAL2M): {measure, value} — энэ багцын ledgers.yaml-д тодорхойлсон ledger бол хэмжигдэхүүн тэнд байх ёстой (өөр багцынх — серверт)
  const led = asList(ledgers).find((l) => isObj(l) && str(l.name ?? l.extends) === str(b.ledger));
  const ledMs = led ? asList(led.measures).map((m) => (typeof m === 'string' ? m.trim() : isObj(m) ? str(m.name) : '')).filter(Boolean) : [];
  const extra = new Set();
  for (const c of asList(b.columns)) {
    if (isObj(c) && c.measure !== undefined) {
      const mn = typeof c.measure === 'string' ? c.measure.trim() : '', mv = c.value === undefined ? 'Эцсийн үлдэгдэл' : str(c.value);
      if (!mn) skip('balance.columns — measure: хэмжигдэхүүний нэр (текст)');
      else if (!BAL_MEASURES.includes(mv)) skip(`balance.columns «${mn}» — value «${mv}» (${BAL_MEASURES.join(', ')})`);
      else if (ledMs.length && !ledMs.includes(mn)) skip(`balance.columns — хэмжигдэхүүн «${mn}» ledger «${str(b.ledger)}»-д алга (${ledMs.join(', ')})`);
      else if (extra.add(mn).size > 8) skip(`balance.columns «${mn}» — өөр хэмжигдэхүүн ≤ 8`);
      continue;
    }
    const src = typeof c === 'string' ? c : isObj(c) ? str(c.expr ?? c.field) : '';
    const names = [], fns = [];
    calcLeaves(src, names, fns);
    const bad = names.find((n) => !nameOk(n));
    const badFn = fns.find((f) => !['iff', 'share', 'coalesce', 'tableAgg', ...DATE_TOKENS].includes(f)); // P-WP-36: tableAgg
    if (bad) skip(`balance.columns «${src}» — багана «${bad}» олдсонгүй (by-ийн хэмжээс, «<хэмжээс>.<багана>» эсвэл ${BAL_MEASURES.join(', ')})`);
    else if (badFn) skip(`balance.columns «${src}» — функц «${badFn}» дэмжигдэхгүй (iff, share, coalesce; бүлгийн нэгтгэл — хэмжигдэхүүн аль хэдийн нэгтгэгдсэн)`);
  }
  return out;
}

// T3b WP-O (N-15): `limit` (1..5000 | param.<нэр>), `having` (баганын гарчгаар), үлдэгдлийн тайлангийн `sort` — SolutionDeploy.cpp reports() (report_skip)
function reportLabels(y) {
  if (isObj(y.balance) && Array.isArray(y.balance.columns) && y.balance.columns.length && (y.balance.kind === undefined || y.balance.kind === 'balance') && y.balance.rollup === undefined)
    return y.balance.columns.map((c) => (typeof c === 'string' ? c : isObj(c) ? str(c.label ?? c.expr ?? c.field ?? (c.measure !== undefined ? str(c.measure) + (c.value === undefined || str(c.value) === 'Эцсийн үлдэгдэл' ? '' : ` (${str(c.value)})`) : '')) : '')); // P-WP-24; P-WP-37 measure
  if (isObj(y.balance)) {
    const b = y.balance, kind = b.kind === undefined ? 'balance' : str(b.kind);
    const by = asList(b.by).map((d) => (typeof d === 'string' ? d : JSON.stringify(d)));
    const head = kind === 'balance' && b.rollup === 'tree' ? [...by.slice(0, 1), 'Түвшин'] : by;
    const fixed = kind === 'available' ? ['Үлдэгдэл', 'Нөөцлөгдсөн', 'Боломжит'] : kind === 'openItems' ? ['Огноо', 'Хоног', 'Дүн', 'Үлдэгдэл'] : ['Эхний үлдэгдэл', 'Орлого', 'Зарлага', 'Эцсийн үлдэгдэл'];
    return [...head, ...fixed];
  }
  const out = [];
  for (const g of asList(y.groupBy)) if (typeof g === 'string') out.push(g);
  for (const m of asList(y.measures)) if (isObj(m)) out.push(m.fn === 'count' && m.field === undefined ? str(m.label ?? 'Тоо') : str(m.label) || str(m.field));
  for (const c of asList(y.columns)) {
    if (typeof c === 'string') out.push(c);
    else if (isObj(c) && c.expr !== undefined) out.push(str(c.label ?? c.expr));
    else if (isObj(c)) out.push(str(c.label) || str(c.field));
  }
  return out;
}
function reportTailErrors(y) {
  const out = [], name = str(y.name), params = new Set(asList(y.params).map((p) => str(p?.name)));
  const skip = (m) => out.push({ code: 'report_skip', message: `Тайлан «${name}»: ${m}` });
  const needs = y.limit !== undefined || y.having !== undefined || isObj(y.balance) || y.highlight !== undefined || isObj(y.chart);
  if (!needs) return out;
  const labels = reportLabels(y);
  if (y.limit !== undefined && y.limit !== null) {
    const l = y.limit, ls = typeof l === 'string' ? l.trim() : '';
    const ok = (Number.isInteger(l) && l >= 1 && l <= 5000) || (ls.startsWith('param.') && params.has(ls.slice(6).trim()));
    if (!ok) skip(`limit «${typeof l === 'string' ? ls : JSON.stringify(l)}» — 1..5000 бүхэл тоо эсвэл param.<параметр>`);
  }
  if (isObj(y.balance)) for (const srt of asList(y.sort)) if (isObj(srt) && !labels.includes(str(srt.field))) skip(`sort «${str(srt.field)}» багана алга`);
  if (isObj(y.chart)) { // P-WP-26 (CH-DONUT/CH-MULTI): chart.x / chart.y — баганын гарчгаар
    if (y.chart.x !== undefined && !labels.includes(str(y.chart.x))) skip(`chart.x «${str(y.chart.x)}» багана алга`);
    for (const v of asList(y.chart.y)) if (!labels.includes(str(v))) skip(`chart.y «${str(v)}» багана алга`);
  }
  let bad = '';
  const cond = (part0) => {
    const part = stripOuterParens(part0);
    for (const kw of [' or ', ' and ']) { const ps = splitTopKw(part, kw); if (ps.length > 1) return ps.every(cond); }
    let m = /^(.+?)\s*(==|!=|=)\s*null$/u.exec(part);
    const isNull = !!m;
    if (!m) m = /^(.+?)\s*(==|!=|>=|<=|>|<|=)\s*(.+)$/u.exec(part);
    if (!m) { bad = part; return false; }
    const lbl = m[1].trim();
    if (!labels.includes(lbl)) { bad = `${part}» — багана «${lbl}» алга (баганын гарчгаар бичнэ`; return false; }
    if (isNull) return true;
    const rhs = m[3].trim();
    if (rhs.startsWith('param.')) { if (params.has(rhs.slice(6).trim())) return true; bad = `${part}» — параметр «${rhs.slice(6)}» алга`; return false; }
    if (dateToken(rhs) || /^(['"]).*\1$/.test(rhs)) return true;
    if (rhs.includes('(')) { bad = `${part}» — функц дэмжигдэхгүй`; return false; }
    return true;
  };
  if (typeof y.having === 'string' && y.having.trim() && !cond(y.having)) skip(`having «${bad}» орчуулагдсангүй`);
  // P-WP-4: `highlight: [{when: <having-тэй ижил — баганын гарчгаар>, style, columns: [<гарчиг>]}]` — SolutionDeploy.cpp reports()
  for (const h of asList(y.highlight)) {
    if (!isObj(h)) continue;
    if (!cond(str(h.when))) { skip(`highlight «${bad}» орчуулагдсангүй`); continue; }
    for (const c of asList(h.columns)) if (!labels.includes(str(c))) skip(`highlight «${str(h.when)}»: багана «${str(c)}» алга`);
  }
  return out;
}

// SolutionDeploy.cpp splitTopKw / stripOuterParens — хаалт, хашилтын гадна
function splitTopKw(s, kw) {
  const out = [];
  let depth = 0, q1 = false, q2 = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !q2) q1 = !q1; else if (ch === '"' && !q1) q2 = !q2;
    if (!q1 && !q2) { if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--; }
    if (!q1 && !q2 && depth === 0 && s.startsWith(kw, i)) { if (cur.trim()) out.push(cur.trim()); cur = ''; i += kw.length - 1; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function stripOuterParens(s) {
  for (;;) {
    s = s.trim();
    if (s.length < 2 || s[0] !== '(' || !s.endsWith(')')) return s;
    let depth = 0, q1 = false, q2 = false, whole = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "'" && !q2) q1 = !q1; else if (ch === '"' && !q1) q2 = !q2;
      if (q1 || q2) continue;
      if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0 && i + 1 < s.length) { whole = false; break; } }
    }
    if (!whole) return s;
    s = s.slice(1, -1);
  }
}
// expr/DateTokens.h parse: today | now | yesterday | month_start … [(today)] [±N]
const DATE_TOKENS = new Set(['today', 'now', 'yesterday', 'month_start', 'month_end', 'next_month_start', 'year_start', 'year_end']);
function dateToken(raw) {
  const v = raw.replace(/[ \t]/g, '');
  const m = /^([a-z_]*)(\(today\))?([+-]\d{1,5})?$/.exec(v);
  return !!m && DATE_TOKENS.has(m[1]) && !(m[2] && (m[1] === 'today' || m[1] === 'now'));
}

// integrations.yaml endpoints[] (auth/token/perOrg/settings-тай) — нэр латин identifier (серверийн integration_skip)
export function endpointErrors(ig) {
  const out = [];
  for (const e of asList(ig?.endpoints)) {
    if (!isObj(e)) continue;
    const en = str(e.name);
    if (!en || !(e.auth !== undefined || e.token !== undefined || e.perOrg !== undefined || e.settings !== undefined)) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(en)) out.push({ code: 'integration_skip', message: `integrations.yaml endpoint «${en}»: нэр латин identifier байх ёстой` });
  }
  return out;
}

// ---- P-WP-5/6 (T4-UI P5/P6): жагсаалтын `filters`, `tree`, `actions`; хуудасны `params`, report блокийн `params`
// SolutionDeploy.cpp translateListUi / translatePageScreen-ийн screen_skip мессежтэй ижил.
export const colKind = (ty) => {
  const t = str(ty).toLowerCase();
  if (/^(date|datetime|timestamp)/.test(t)) return 'date';
  if (/^(bool|boolean)/.test(t)) return 'boolean';
  if (/^(varchar|text|char|string|nvarchar)/.test(t) || !t) return 'text';
  return 'number';
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const filterName = (f) => str(f?.name) || str(f?.label) || str(f?.column);
// утга: filter.<шүүлт> | selected.<Багана> | selected.id | page.<параметр> | '<литерал>' | тоо/bool → {kind, name} | null
export function uiValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return { kind: 'value', name: String(v) };
  const s = str(v);
  let m = /^(filter|selected|page)\.(.+)$/u.exec(s);
  if (m) return { kind: m[1], name: m[2].trim() };
  m = /^'(.*)'$/su.exec(s) ?? /^"(.*)"$/su.exec(s);
  if (m) return { kind: 'value', name: m[1] };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'value', name: s };
  return null;
}
export function uiErrors(S, screens, reports, foreign = [], generators = []) {
  const out = [];
  const scr = asList(screens).filter(isObj);
  const all = [...scr, ...foreign.flatMap((f) => asList(f.screens).filter(isObj))];
  const lenient = foreign.length > 0; // requires-ийн багцын дэлгэц/тайлан — deploy (DB) шийднэ
  const byId = (id, type) => all.find((x) => (x.type ?? 'form') === type && (str(x.id) === id || (type === 'page' && str(x.slug) === id)));
  const reportOf = (n) => asList(reports).find((r) => isObj(r) && str(r.name).toLowerCase() === str(n).toLowerCase());
  const tokenOk = (v) => typeof v !== 'string' || ISO_DATE.test(v.trim()) || dateToken(v.trim());
  // P-WP-51 (EXT-OWNFILTER): list өргөтгөлийн дэлгэц (listExtensionAsScreen) — эзэмшигчийн шүүлтийг ч (өргөтгөл эзэмшигчийн list-ийг далдлахгүй)
  const listKeys = (x) => [...asList(x.filters).filter(isObj).map(filterName), ...asList(x.__ownerFilters).map(str)];
  // P-WP-25 (G-GENBTN): товчоор ажиллах `on`-гүй генератор → параметрийн нэрс | {err} (SolutionDeploy.cpp uiGenerator-тэй ижил)
  const genOf = (n) => {
    const g = asList(generators).find((x) => isObj(x) && str(x.name) === n);
    if (!g) return lenient ? null : { err: `генератор «${n}» алга` };
    if (str(g.on)) return { err: `генератор «${n}» нь баримтын (\`on:\`) — формын \`type: generate\` товчоор` };
    return { keys: asList(g.params).map((p) => str(p?.name)) };
  };
  const ownIds = new Set(scr.filter((x) => x.extends === undefined).flatMap((x) => [str(x.id), str(x.slug)]).filter(Boolean));
  for (const s of scr) {
    const kind = s.type ?? 'form', id = str(s.id);
    const warn = (m) => out.push({ code: 'screen_skip', message: `screens.yaml «${id}»: ${m}` });
    const pending = (m) => out.push({ code: 'action_target_pending', severity: 'warning', message: `screens.yaml «${id}»: ${m}${PENDING_HINT}` }); // P-WP-51
    if (kind === 'list') {
      const tbl = S.table(str(s.table));
      if (!tbl || S.opaque(tbl)) continue;
      const names = new Set();
      // P-WP-27 (G-LFP): хүүхдийн шүүлт/мод — child, via (FK зам), of; SolutionDeploy.cpp translateListUi childOf-тэй ижил мессеж. → {tbl} | null
      const childOf = (f, who) => {
        const ct = S.table(str(f.child));
        if (!ct) { warn(`${who}: child — хүснэгт «${str(f.child)}» алга`); return null; }
        if (ct === tbl) { warn(`${who}: child — өөр (хүүхэд) хүснэгт заана уу`); return null; }
        if (S.opaque(ct)) return { tbl: ct };
        let target = tbl;
        const ORGT = new Set(['Хэсэг', 'Байгууллага']); // P-WP-31 (G-LFPORG): байгууллагын хүрээний багана (org, ST000501) → Хэсэг (ST0005)
        const same = (a, b) => a === b || (ORGT.has(a) && ORGT.has(b));
        if (f.of !== undefined) {
          const of = str(f.of);
          if (!S.column(tbl, of)) { warn(`${who}: of — багана «${of}» алга`); return null; }
          target = S.fk(tbl, of) || tbl;
        }
        if (f.via !== undefined) {
          const end = pathEnd(S, ct, str(f.via));
          if (!end) { warn(`${who}: via — «${str(f.via)}» алга`); return null; }
          if (!S.opaque(end.tbl) && !same(S.fk(end.tbl, end.col), target)) { warn(`${who}: via «${str(f.via)}» — «${target}» рүү FK биш`); return null; }
        } else {
          const n = S.fksTo ? S.fksTo(ct, target).length : 1;
          if (n !== 1) { warn(`${who}: via — «${str(f.child)}»-ээс энэ хүснэгт рүү FK ${n ? 'олон (via заана уу)' : 'алга'}`); return null; }
        }
        return { tbl: ct };
      };
      // P-WP-31 (G-LFPX): `where`-ийн `filter.<нэр>` — энэ жагсаалтын шүүлт (хамгийн урт нэр); SolutionDeploy.cpp withFilterRefs-тэй ижил мессеж → {w: литерал болгосон, err}
      const allNames = asList(s.filters).filter(isObj).map(filterName).filter(Boolean).sort((a, b) => b.length - a.length);
      for (const n of asList(s.__ownerFilters)) if (str(n)) names.add(str(n)); // P-WP-51 (EXT-OWNFILTER): list өргөтгөлийн товчны filter.<эзэмшигчийн шүүлт>
      const refs = (w0) => {
        let out = '', q = '', err = '';
        const isL = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
        for (let i = 0; i < w0.length;) {
          const ch = w0[i];
          if (q) { out += ch; if (ch === q) q = ''; i++; continue; }
          if (ch === "'" || ch === '"') { q = ch; out += ch; i++; continue; }
          if (!(w0.startsWith('filter.', i) && !(i > 0 && (isL(w0[i - 1]) || w0[i - 1] === '.')))) { out += ch; i++; continue; }
          const hit = allNames.find((n) => w0.startsWith(n, i + 7) && !isL(w0[i + 7 + n.length]));
          if (!hit) { err = `шүүлт «${w0.slice(i + 7).split(/\s*(==|!=|<=|>=|<|>|\)|,| and | or )/)[0].trim()}» алга (filter.<нэр>)`; break; }
          out += "''"; i += 7 + hit.length;
        }
        return { w: out, err };
      };
      const KINDS = ['text', 'number', 'date', 'datetime', 'boolean', 'ref'];
      for (const f of asList(s.filters)) {
        if (!isObj(f)) continue;
        const nm = filterName(f), col = str(f.column);
        if (!nm) { warn('шүүлт: name/label/column заавал'); continue; }
        if (names.has(nm)) { warn(`шүүлтийн нэр «${nm}» давхцсан`); continue; }
        names.add(nm);
        if (f.kind !== undefined && !KINDS.includes(str(f.kind))) { warn(`шүүлт «${nm}»: kind «${str(f.kind)}» — text | number | date | datetime | boolean | ref`); continue; }
        if (str(f.kind) === 'ref' && !col && !S.table(str(f.ref))) { warn(`шүүлт «${nm}»: ref — хүснэгт «${str(f.ref)}» алга`); continue; }
        let base = tbl;
        const whereOk = (t) => { // P-WP-31: where — filter.<нэр> ба нэрс (exists/member — серверт)
          if (f.where === undefined) return true;
          const r = refs(str(f.where));
          if (r.err) { warn(`шүүлт «${nm}»: where «${str(f.where)}» — ${r.err}`); return false; }
          const un = S.opaque(t) ? [] : unresolvedNames(S, t, r.w);
          if (un.length) { warn(`шүүлт «${nm}»: where «${str(f.where)}» — нэр шийдэгдсэнгүй: ${un.join(', ')}`); return false; }
          return true;
        };
        if (f.child !== undefined) { const c = childOf(f, `шүүлт «${nm}»`); if (!c) continue; base = c.tbl; if (!whereOk(c.tbl)) continue; if (!col) continue; }
        else if (!col && f.expr === undefined) { // P-WP-31 (G-LFPX): баганагүй — `where` (энэ хүснэгтийн X0) эсвэл `param: true`
          if (f.where !== undefined) { whereOk(tbl); continue; }
          if (f.param === true) { if (f.kind === undefined && f.options === undefined) warn(`шүүлт «${nm}»: param — kind (text | number | date | ref …) эсвэл column заавал`); continue; }
          warn(`шүүлт «${nm}»: багана «» алга (column, where эсвэл param: true заана)`);
          continue;
        } else if (f.where !== undefined) { warn(`шүүлт «${nm}»: where — column-гүй (эсвэл child-тэй) шүүлтэд`); continue; }
        // P-WP-31 (L-FCALC): тооцоолсон багана — жагсаалтын {label, expr} баганын шошго эсвэл `expr:` (нэрсийг сервер шалгана)
        if (base === tbl && (f.expr !== undefined || (!pathEnd(S, base, col) && asList(s.columns).some((c) => isObj(c) && c.expr !== undefined && str(c.label) === col)))) {
          if (f.op !== undefined && !['==', '!=', '>=', '<=', '>', '<', 'empty'].includes(str(f.op))) warn(`шүүлт «${nm}»: тооцоолсон баганад op «${str(f.op)}» — ==, !=, >=, <=, >, <, empty`);
          continue;
        }
        const end = pathEnd(S, base, col);
        if (!end) { warn(`шүүлт «${nm}»: багана «${col}» алга`); continue; }
        if (S.opaque(end.tbl)) continue;
        const ck = colKind(S.colType(end.tbl, end.col)), op = str(f.op);
        if (op === 'contains' && (ck !== 'text' || S.fk(end.tbl, end.col))) warn(`шүүлт «${nm}»: contains — текст багана биш`);
        if (op === 'under') { const ref = S.fk(end.tbl, end.col); if (!ref || (!S.opaque(ref) && !S.treeParent(ref))) warn(`шүүлт «${nm}»: under — «${col}» модны (эцэгтэй) хүснэгт рүү FK биш`); }
        if (ck === 'date' && f.default !== undefined && !tokenOk(f.default)) warn(`шүүлт «${nm}»: default «${str(f.default)}» — огноо (YYYY-MM-DD) эсвэл огнооны токен`);
      }
      if (isObj(s.tree)) {
        // P-WP-33 (G-TREE2): `column: [A, B]` — ижил модны хүснэгт рүү (SolutionDeploy.cpp translateListUi-тэй ижил мессеж)
        const cols = Array.isArray(s.tree.column) ? s.tree.column.map(str) : [str(s.tree.column)];
        const col = cols[0] ?? '';
        let base = tbl, ok = true;
        if (s.tree.child !== undefined) { const c = childOf(s.tree, 'tree'); if (!c) ok = false; else base = c.tbl; }
        const end = ok ? pathEnd(S, base, col) : null;
        const ref = end ? (S.opaque(end.tbl) ? '*' : S.fk(end.tbl, end.col)) : '';
        if (!ok) { /* childOf мессеж */ }
        else if (!ref || (ref !== '*' && !S.opaque(ref) && !S.treeParent(ref))) warn(`tree.column «${col}» — модны (эцэгтэй) хүснэгт рүү FK биш`);
        else if (ref !== '*' && s.tree.display !== undefined && !S.opaque(ref) && !S.column(ref, str(s.tree.display))) warn(`tree.display «${str(s.tree.display)}» «${ref}»-д алга`);
        else if (cols.length > 5) warn('tree.column — ≤ 5 багана');
        else for (const c2 of cols.slice(1)) {
          const e2 = pathEnd(S, base, c2);
          const r2 = e2 ? (S.opaque(e2.tbl) ? '*' : S.fk(e2.tbl, e2.col)) : '';
          if (ref === '*' || r2 === '*') continue;
          if (!r2 || r2 !== ref) { warn(`tree.column «${c2}» — «${col}»-тэй ижил модны (эцэгтэй) хүснэгт рүү FK биш`); break; }
        }
      }
      for (const a of asList(s.actions)) {
        if (!isObj(a)) continue;
        const label = str(a.label);
        const tk = ['screen', 'page', 'report', 'form', 'generate', 'transition', 'update', 'print'].filter((k) => a[k] !== undefined);
        if (tk.length !== 1) { warn(`товч «${label}»: зорилт (screen | page | report | form | generate | transition | update | print) яг нэг`); continue; }
        if (!label) { warn('товч: label заавал'); continue; }
        const t = tk[0], ref = str(a[t]);
        // P-WP-27 (G-BULK/PRINT): бөөн шилжилт, талбар солих, хэвлэх — SolutionDeploy.cpp translateListUi-тэй ижил мессеж
        if (t === 'transition') { if (S.transitionOf && !S.transitionOf(tbl, ref)) warn(`товч «${label}»: шилжилт «${ref}» энэ хүснэгтийн төлвийн машинд алга`); continue; }
        if (t === 'update') {
          if (!isObj(a.update) || !Object.keys(a.update).length) { warn(`товч «${label}»: update — {<Багана>: ask | '<утга>'} объект`); continue; }
          for (const [k, v] of Object.entries(a.update)) {
            if (!S.column(tbl, k) || S.audit(tbl, k)) { warn(`товч «${label}»: update «${k}» — энэ хүснэгтийн засагдах багана биш (түлхүүр, аудит, төлөв — шилжилтээр)`); continue; }
            if (!(v === null || str(v) === 'ask' || (uiValue(v)?.kind === 'value'))) warn(`товч «${label}»: update «${k}» — ask | '<литерал>' | тоо | null`);
          }
          continue;
        }
        if (t === 'print') { if (!(a.print === true || (typeof a.print === 'string' && a.print.trim()))) warn(`товч «${label}»: print — true эсвэл баримтын загварын нэр`); continue; }
        if (a.bulk !== undefined && a.bulk && t !== 'generate') { warn(`товч «${label}»: bulk — зөвхөн generate | transition | update`); continue; }
        let keys = null, tgtTable = '';
        if (t === 'generate') { const g = genOf(ref); if (g?.err) { warn(`товч «${label}»: ${g.err}`); continue; } keys = g?.keys ?? null; }
        else if (t === 'report') { const r = reportOf(ref); if (!r) { if (!lenient && ref) pending(`товч «${label}»: тайлан «${ref}»`); else if (!ref) warn(`товч «${label}»: тайлан «${ref}» алга`); continue; } keys = asList(r.params).map((p) => str(p?.name)); }
        else {
          const x = byId(ref, t === 'screen' ? 'list' : t);
          if (!x && ref && !ownIds.has(ref) && !(t === 'form' && isObj(a.params) && Object.keys(a.params).length)) { if (!lenient) pending(`товч «${label}»: ${t === 'page' ? 'хуудас' : 'дэлгэц'} «${ref}»`); continue; } // P-WP-51
          if (!x) { if (!lenient || scr.some((y) => str(y.id) === ref)) warn(`товч «${label}»: ${t === 'page' ? 'хуудас' : 'дэлгэц'} «${ref}» алга`); continue; }
          if (t === 'screen') keys = listKeys(x);
          else if (t === 'page') keys = asList(x.params).map((p) => str(p?.name));
          else tgtTable = S.table(str(x.table));
        }
        for (const [k, v] of Object.entries(isObj(a.params) ? a.params : {})) {
          const pv = uiValue(v);
          if (!pv || pv.kind === 'page') { warn(`товч «${label}»: параметр «${k}» — утга «${str(v)}» (filter.<шүүлт> | selected.<Багана> | '<литерал>')`); continue; }
          if (pv.kind === 'filter' && !names.has(pv.name)) warn(`товч «${label}»: параметр «${k}» — шүүлт «${pv.name}» алга`);
          if (pv.kind === 'selected' && pv.name === 'ids') { if (t !== 'generate' || a.bulk) warn(`товч «${label}»: параметр «${k}» — selected.ids зөвхөн generate-д (bulk-гүй)`); }
          else if (pv.kind === 'selected' && pv.name !== 'id' && !S.column(tbl, pv.name)) warn(`товч «${label}»: параметр «${k}» — багана «${pv.name}» алга`);
          if (keys && !keys.includes(k)) warn(`товч «${label}»: «${ref}»-д параметр/шүүлт «${k}» алга`);
          if (t === 'form' && tgtTable && !S.opaque(tgtTable) && !S.column(tgtTable, k)) warn(`товч «${label}»: «${ref}»-ийн хүснэгтэд багана «${k}» алга`);
        }
      }
    } else if (kind === 'form') { // P-WP-27 (A1-2): `type: screen` — шүүлттэй жагсаалт руу (SolutionDeploy.cpp translateFormScreen-тэй ижил мессеж)
      const tbl = S.table(str(s.table));
      for (const a of asList(s.actions)) { // P-WP-31 (F-GENBTN): `type: generate` + `on`-гүй генератор — params (id | record.<Талбар> | '<литерал>')
        if (!isObj(a) || a.type !== 'generate' || a.params === undefined) continue;
        const label = str(a.label), gn = str(a.generator);
        const g = asList(generators).find((x) => isObj(x) && str(x.name) === gn);
        if (!g) continue; // суусан генератор — сервер
        if (str(g.on)) { warn(`товч «${label}»: params — зөвхөн \`on\`-гүй генераторт (баримтын генератор doc.*-аар)`); continue; }
        const keys = asList(g.params).map((p) => str(p?.name));
        for (const [k, v] of Object.entries(isObj(a.params) ? a.params : {})) {
          if (!keys.includes(k)) { warn(`товч «${label}»: «${gn}»-д параметр «${k}» алга`); continue; }
          if (uiValue(v)?.kind === 'value') continue;
          const src = str(v).replace(/^record\./, '');
          if (src !== 'id' && !(tbl && (S.opaque(tbl) || S.column(tbl, src)))) warn(`товч «${label}»: параметр «${k}» — багана «${src}» алга (id | record.<Талбар> | '<литерал>')`);
        }
      }
      for (const a of asList(s.actions)) { // P-WP-51: `type: page | report` — энэ багц/requires-д алга бол дараа суух (анхааруулга)
        if (!isObj(a) || (a.type !== 'page' && a.type !== 'report') || lenient) continue;
        const label = str(a.label), ref = str(a.type === 'page' ? a.page : a.report);
        if (!ref) continue;
        if (a.type === 'report' ? !reportOf(ref) : !(ownIds.has(ref) || byId(ref, 'page') || byId(ref, 'form'))) pending(`товч «${label}»: ${a.type === 'report' ? `тайлан «${ref}»` : `хуудас/дэлгэц «${ref}»`}`);
      }
      for (const a of asList(s.actions)) {
        if (!isObj(a) || a.type !== 'screen') continue;
        const label = str(a.label), ref = str(a.screen);
        const x = byId(ref, 'list');
        if (!x && ref && !ownIds.has(ref)) { if (!lenient) pending(`товч «${label}»: жагсаалтын дэлгэц «${ref}»`); continue; } // P-WP-51
        if (!x) { if (!lenient || scr.some((y) => str(y.id) === ref)) warn(`товч «${label}»: жагсаалтын дэлгэц «${ref}» алга`); continue; }
        const keys = listKeys(x);
        for (const [k, v] of Object.entries(isObj(a.filter) ? a.filter : {})) {
          if (!keys.includes(k)) { warn(`товч «${label}»: «${ref}»-д шүүлт «${k}» алга`); continue; }
          const src = str(v).replace(/^record\./, '');
          if (src === 'id' || (tbl && S.column(tbl, src))) continue;
          if (uiValue(v)?.kind !== 'value') warn(`товч «${label}»: шүүлт «${k}» — id | record.<Талбар> | '<литерал>'`);
        }
      }
    } else if (kind === 'page') {
      const pnames = new Set();
      for (const p of asList(s.params)) {
        if (!isObj(p)) continue;
        const nm = str(p.name);
        if (pnames.has(nm)) warn(`хуудасны параметр «${nm}» давхцсан`);
        pnames.add(nm);
        if (str(p.type) === 'ref' && !str(p.table)) warn(`хуудасны параметр «${nm}»: ref — table заавал`);
        if (str(p.type) === 'date' && p.default !== undefined && !tokenOk(p.default)) warn(`хуудасны параметр «${nm}»: default «${str(p.default)}» — огноо (YYYY-MM-DD) эсвэл огнооны токен`);
        // P-WP-22 (Тоду G-PGF): модон параметр — ref + эцэгтэй (өөр рүүгээ FK) хүснэгт
        if (p.tree === true) {
          if (str(p.type) !== 'ref') warn(`хуудасны параметр «${nm}»: tree — зөвхөн ref параметрт`);
          else { const t = S.table(str(p.table)); if (t && !S.opaque(t) && !S.treeParent(t)) warn(`хуудасны параметр «${nm}»: tree — «${str(p.table)}» модны (эцэгтэй) хүснэгт биш`); }
        }
      }
      if (isObj(s.filterPanel)) { // P-WP-22: хумисан бүлэг нь параметрийн group-ийн нэг
        const groups = new Set(asList(s.params).filter(isObj).map((p) => str(p.group)).filter(Boolean));
        for (const g of asList(s.filterPanel.collapsed)) if (!groups.has(str(g))) warn(`filterPanel.collapsed «${str(g)}» — бүлэг алга (параметрийн group)`);
      }
      // P-WP-26 (G-BLK): блокийн `toggle: shown | hidden | {label, default}`, хуудасны `toggles: {title, collapsed}` (SolutionDeploy.cpp translatePageScreen-тэй ижил мессеж)
      let anyToggle = false;
      for (const b of asList(s.blocks)) {
        if (!isObj(b) || b.toggle === undefined) continue;
        const tg = b.toggle, dv = typeof tg === 'string' ? tg : isObj(tg) ? str(tg.default ?? 'shown') : '';
        const title = str(b.title) || (b.type === 'report' ? str(b.report) : '');
        if (dv !== 'shown' && dv !== 'hidden') { warn(`блок «${title || str(b.type)}»: toggle — shown | hidden | {label, default: shown|hidden}`); continue; }
        if (!(isObj(tg) && str(tg.label).trim()) && !title) { warn(`блок «${str(b.type)}»: toggle — гарчиггүй блокт toggle.label заавал`); continue; }
        anyToggle = true;
      }
      if (s.toggles !== undefined) {
        if (!isObj(s.toggles)) warn('toggles — {title, collapsed} объект');
        else if (!anyToggle) warn('toggles — toggle-тэй блок алга');
      }
      // P-WP-12: `links` блок — items[{label, screen|page|report|table|url, params, roles}] (SolutionDeploy.cpp translatePageScreen-тэй ижил мессеж)
      for (const b of asList(s.blocks)) {
        if (!isObj(b) || b.type !== 'links') continue;
        const items = asList(b.items).filter(isObj);
        if (!items.length) warn('links: items хоосон');
        for (const it of items) {
          const label = str(it.label);
          const tk = ['screen', 'page', 'report', 'table', 'url', 'generate', 'print'].filter((k) => it[k] !== undefined);
          if (!label || tk.length !== 1) { warn(`links «${label}»: label ба зорилт (screen | page | report | table | url | generate | print) яг нэг`); continue; }
          const t = tk[0], ref = str(it[t]);
          if (t === 'print') { if (it.print !== true) warn(`links «${label}»: print — true`); else if (it.params !== undefined) warn(`links «${label}»: print — params-гүй`); continue; } // P-WP-27 (PRINT)
          let keys = null;
          if (t === 'generate') { const g = genOf(ref); if (g?.err) { warn(`links «${label}»: ${g.err}`); continue; } keys = g?.keys ?? null; }
          else if (t === 'url') {
            if (!(/^https?:\/\/\S+$/.test(ref) || (/^\/(?![\/\\])/.test(ref) && !/[\\:]/.test(ref)))) { warn(`links «${label}»: url — http(s)://… эсвэл '/'-ээр эхэлсэн дотоод зам`); continue; }
          } else if (t === 'table') {
            if (!S.table(ref)) { warn(`links «${label}»: хүснэгт «${ref}» алга`); continue; }
            keys = [];
          } else if (t === 'report') {
            const r = reportOf(ref);
            if (!r) { if (!lenient) { if (ref) pending(`links «${label}»: тайлан «${ref}»`); else warn(`links «${label}»: тайлан «${ref}» алга`); } continue; }
            keys = asList(r.params).map((p) => str(p?.name));
          } else if (t === 'page') {
            const x = byId(ref, 'page');
            if (!x) { if (!lenient) { if (ref) pending(`links «${label}»: хуудас «${ref}»`); else warn(`links «${label}»: хуудас «${ref}» алга`); } continue; }
            keys = asList(x.params).map((p) => str(p?.name));
          } else {
            const x = byId(ref, 'list') ?? byId(ref, 'form');
            if (!x) { if (!lenient) { if (ref && !ownIds.has(ref)) pending(`links «${label}»: дэлгэц «${ref}»`); else warn(`links «${label}»: дэлгэц «${ref}» алга`); } continue; }
            if ((x.type ?? 'form') === 'list') keys = listKeys(x);
          }
          for (const [k, v] of Object.entries(isObj(it.params) ? it.params : {})) {
            const pv = uiValue(v);
            if (!pv || (pv.kind !== 'page' && pv.kind !== 'value')) { warn(`links «${label}»: параметр «${k}» — утга (page.<параметр> | '<литерал>' | тоо)`); continue; }
            if (pv.kind === 'page' && !pnames.has(pv.name)) { warn(`links «${label}»: параметр «${k}» — хуудасны параметр «${pv.name}» алга`); continue; }
            if (keys && !keys.includes(k)) warn(`links «${label}»: «${ref}»-д параметр/шүүлт «${k}» алга`);
          }
        }
      }
      for (const b of asList(s.blocks)) {
        if (!isObj(b) || b.type !== 'report' || !isObj(b.params)) continue;
        const r = reportOf(b.report);
        const rp = r ? asList(r.params).map((p) => str(p?.name)) : null;
        for (const [k, v] of Object.entries(b.params)) {
          const pv = uiValue(v);
          if (!pv || (pv.kind !== 'page' && pv.kind !== 'value')) { warn(`блок «${str(b.report)}»: параметр «${k}» — утга «${str(v)}» (page.<параметр> | '<литерал>')`); continue; }
          if (pv.kind === 'page' && !pnames.has(pv.name)) warn(`блок «${str(b.report)}»: параметр «${k}» — хуудасны параметр «${pv.name}» алга`);
          if (rp && !rp.includes(k)) warn(`блок «${str(b.report)}»: тайлангийн параметр «${k}» алга`);
        }
      }
    }
  }
  return out;
}
