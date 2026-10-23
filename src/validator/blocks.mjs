// T3b WP-J (N-01) — блокуудын баганын нэрийн шалгалт (сервергүй), серверийн мессежтэй ижил:
//   ledgers.yaml — plan (SolutionDeploy.cpp 7c: ledger_*) + apply (ledgers(): эх бүрийн date/map, ledger_skip)
//   screens.yaml — translateFormScreen / translateListScreen (screen_skip)
//   reports.yaml — reports() buildSpec (report_skip): groupBy, measures.field, columns
// S — compile.mjs makeSchema (цөмийн хүснэгт opaque).

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
const DATE_TOKEN = /^(today|now|yesterday|tomorrow|[a-z]+_(start|end))$/; // огнооны токен (`month_start(today)`) — шүүлтээс өмнө утгаар солигдоно

// screens.yaml — form/list дэлгэцийн талбар, багана, хүү grid, lookup, kanban/calendar
//   groups: багцын бүлгийн нэрс (жижиг үсгээр; roles.csv ∪ seed groups/users.roles ∪ states `хэн`) — null бол үүргийг шалгахгүй
export function screenErrors(S, screens, groups = null) {
  const out = [];
  const roleCheck = (warn, roles) => { if (groups && Array.isArray(roles)) for (const r of roles) if (typeof r === 'string' && !groups.has(r.trim().toLowerCase())) warn(`үүрэг «${r}» олдсонгүй`); };
  const fkTo = (ct, parent) => S.columnsOf(ct).find((c) => S.fk(ct, c) === parent);
  for (const s of screens) {
    if (!isObj(s)) continue;
    const kind = s.type === undefined ? 'form' : s.type;
    if (kind === 'task' || kind === 'page' || s.process !== undefined) continue;
    const id = str(s.id), tname = str(s.table), tbl = S.table(tname);
    if (!tbl || S.opaque(tbl)) continue;
    const warn = (m) => out.push({ code: 'screen_skip', message: `screens.yaml «${id}»: ${m}` });
    if (kind === 'list') {
      for (const c of asList(s.columns)) if (typeof c === 'string' && !S.column(tbl, c)) warn(`багана «${c}» алга`);
      if (isObj(s.kanban) && !S.column(tbl, str(s.kanban.by))) warn(`kanban.by «${str(s.kanban.by)}» алга`);
      if (isObj(s.calendar) && !S.column(tbl, str(s.calendar.start))) warn(`calendar.start «${str(s.calendar.start)}» алга`);
      // харагдацын шүүлт: мөрийн шүүлтэд (DataPolicy.cpp) харьцуулалтын операнд функц зөвхөн year/month/day/quarter/hours/distance/root/depth
      for (const v of asList(s.views)) {
        const f = str(v?.filter);
        if (/(^|[^\p{L}\p{N}_.])id(?![\p{L}\p{N}_.])/u.test(f.replace(/'[^']*'|"[^"]*"/g, "''"))) { warn(`харагдац «${str(v.name)}»: шүүлт «${f}» — зам 'id.<нэр>' хэлбэртэй байх ёстой (алгасав)`); continue; }
        for (const m of f.matchAll(/([\p{L}_][\p{L}\p{N}_]*)\s*\(/gu)) {
          const fn = m[1];
          if (OPERAND_FN.has(fn) || DATE_TOKEN.test(fn)) continue;
          let d = 0, j = m.index + m[0].length - 1;
          for (; j < f.length; j++) { if (f[j] === '(') d++; else if (f[j] === ')' && --d === 0) break; }
          const before = f.slice(0, m.index).trimEnd(), after = f.slice(j + 1).trimStart();
          if (/(==|!=|<=|>=|<|>|=)$/.test(before) || /^(==|!=|<=|>=|<|>|=)/.test(after)) {
            warn(`харагдац «${str(v.name)}»: шүүлт «${f}» — '${fn}()' операнд мөрийн шүүлтэд дэмжигдээгүй (year, month, day, quarter, hours, distance, root, depth) (алгасав)`);
            break;
          }
        }
      }
      continue;
    }
    const layout = isObj(s.layout) ? s.layout : {};
    const grid = (g) => {
      const ct = S.table(str(g.table));
      if (!ct) { warn(`хүү хүснэгт «${str(g.table)}» олдсонгүй`); return; }
      if (S.opaque(ct)) return;
      const master = typeof g.master === 'string' ? S.table(g.master) : '';
      if (g.master !== undefined && !master) { warn(`childGrid «${str(g.table)}»: master хүснэгт олдсонгүй`); return; }
      if (!fkTo(ct, master || tbl)) { warn(`«${str(g.table)}» нь «${master ? str(g.master) : tname}» руу FK-гүй — хүү grid алгасав`); return; }
      for (const c of asList(g.columns)) if (typeof c === 'string' && !S.column(ct, c)) warn(`«${str(g.table)}»: багана «${c}» алга`);
    };
    const tabs = Array.isArray(layout.tabs) ? layout.tabs : [{ sections: asList(layout.sections) }];
    for (const t of tabs) {
      if (!isObj(t)) continue;
      roleCheck(warn, t.roles);
      if (isObj(t.childGrid)) { grid(t.childGrid); continue; }
      for (const sec of asList(t.sections)) {
        if (!isObj(sec)) continue;
        if (isObj(sec.childGrid)) { grid(sec.childGrid); continue; }
        roleCheck(warn, sec.roles);
        for (const f0 of asList(sec.fields)) {
          const f = typeof f0 === 'string' ? { field: f0 } : f0;
          if (!isObj(f) || (f.expr !== undefined && f.field === undefined)) continue;
          const fld = str(f.field);
          if (!S.column(tbl, fld)) { warn(`талбар «${fld}» «${tname}»-д алга — алгасав`); continue; }
          roleCheck(warn, f.roles);
          if (isObj(f.lookup)) {
            const ref = S.fk(tbl, fld);
            if (!ref) warn(`талбар «${fld}»: lookup — FK багана биш, алгасав`);
            else if (f.lookup.display !== undefined && !S.opaque(ref) && !S.column(ref, str(f.lookup.display))) warn(`lookup.display «${str(f.lookup.display)}» алга`);
          }
        }
      }
    }
    for (const a of asList(s.actions)) if (isObj(a)) roleCheck(warn, a.roles);
    roleCheck(warn, s.roles);
  }
  return out;
}

// reports.yaml — join/union/layout-гүй тайлангийн groupBy, measures.field, columns (эх хүснэгтээс FK зам); join-ийн хүснэгтийн талбар серверт
export function reportErrors(S, reports) {
  const out = [];
  for (const y of reports) {
    if (isObj(y) && y.layout === undefined) out.push(...reportTailErrors(y));
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
      if ((m = /^(not\s+)?empty\(\s*(.+?)\s*\)$/.exec(part)) || (m = /^(.+?)\s*(==|!=|=)\s*null$/.exec(part))) {
        if (lhsOk(part.includes('empty(') && /^(not\s+)?empty\(/.test(part) ? m[2] : m[1])) return true;
        bad(part, 'орчуулагдсангүй'); return false;
      }
      if ((m = /^(.+?)\s+(not\s+)?in\s*\((.+)\)$/.exec(part))) { if (lhsOk(m[1])) return true; bad(part, 'орчуулагдсангүй'); return false; }
      if ((m = /^(.+?)\s*(==|!=|>=|<=|>|<|=)\s*(.+)$/.exec(part))) {
        if (!lhsOk(m[1])) { if (m[1].includes('(') && !/^date\(/.test(m[1].trim())) return true; bad(part, 'орчуулагдсангүй'); return false; } // reportCalc — серверт
        const rhs = m[3].trim();
        if (rhs.startsWith('param.') || /^user\.(code|orgCode)$/.test(rhs) || dateToken(rhs)) return true;
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

// T3b WP-O (N-15): `limit` (1..5000 | param.<нэр>), `having` (баганын гарчгаар), үлдэгдлийн тайлангийн `sort` — SolutionDeploy.cpp reports() (report_skip)
function reportLabels(y) {
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
  const needs = y.limit !== undefined || y.having !== undefined || isObj(y.balance);
  if (!needs) return out;
  const labels = reportLabels(y);
  if (y.limit !== undefined && y.limit !== null) {
    const l = y.limit, ls = typeof l === 'string' ? l.trim() : '';
    const ok = (Number.isInteger(l) && l >= 1 && l <= 5000) || (ls.startsWith('param.') && params.has(ls.slice(6).trim()));
    if (!ok) skip(`limit «${typeof l === 'string' ? ls : JSON.stringify(l)}» — 1..5000 бүхэл тоо эсвэл param.<параметр>`);
  }
  if (isObj(y.balance)) for (const srt of asList(y.sort)) if (isObj(srt) && !labels.includes(str(srt.field))) skip(`sort «${str(srt.field)}» багана алга`);
  if (typeof y.having === 'string' && y.having.trim()) {
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
    if (!cond(y.having)) skip(`having «${bad}» орчуулагдсангүй`);
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
