// T3b WP-J (N-01) — cgi/src/solution/ExprSql.cpp-ийн нэр шийдвэрлэлтийн JS хуулбар (SQL үүсгэхгүй, зөвхөн алдаа).
// Генератор (generators.yaml), үзүүлэлт (metrics.yaml), бүтэцтэй тайлан (reports.yaml `layout`) сервер дээр deploy үед энэ хэлээр
// хөрвүүлэгддэг — алдааны мессеж нь серверийнхтэй үг үсгээрээ ижил (validate-parity-ийн «…» гарын үсэг таарна).
//   S (схем): {table(n) → нэр|'', column(t, n) → нэр|'', fk(t, col) → лавлах хүснэгт|'', ledger(n) → {dims, measures, refs}|null,
//              opaque(t) → true бол баганыг шалгахгүй (цөмийн хүснэгт — серверт бүрэн, багцад хэсэгчилсэн)}
//   env: {row: Scope|null, scopes: {нэр: Scope}, params: Set, paramRefs: Map(нэр → хүснэгт), ident(n) → bool, call(fn, raw) → {ok}|{err}|null, windows}
//   Scope: {table} | {table, keyed: true} | {fields: Map(нэр → лавлах хүснэгт|'')}
//   S.treeParent(t) → өөр рүүгээ FK баганын нэр | '' (T3b WP-K); env.scopes.user/transition — WP-L генераторын хүрээ (compile.mjs)
// T3b WP-L: regexp()/matches()-ийн каноник загвар — web/src/lib/regexp.ts (= cgi/src/expr/Regexp.h). Top-level await-гүй (studio CJS build):
// платформын ESM оролт (scripts/bj.mjs, validate/test.mjs) `loadRegexpCanonical()`-ыг дуудна; CLI/studio-ийн хуулбарт байхгүй бол шалгахгүй.
let reCanonical = null;
export function setRegexpCanonical(fn) { reCanonical = typeof fn === 'function' ? fn : null; }

const isIdChar = (ch) => ch !== undefined && (/[A-Za-z0-9_]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const isDigit = (ch) => ch !== undefined && ch >= '0' && ch <= '9';
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
const KEYWORDS = new Set(['and', 'or', 'not', 'in']);
const trimS = (s) => String(s ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

function lex(e) {
  const out = [];
  let i = 0;
  const n = e.length;
  const readWord = (p) => {
    let w = '';
    while (p < n) {
      const c = e[p];
      if (isIdChar(c) || c === '.') { w += e[p++]; continue; }
      if (c === '-' && w && p + 1 < n && isIdChar(e[p + 1]) && !isDigit(e[p + 1])) { w += e[p++]; continue; }
      break;
    }
    return [w, p];
  };
  while (i < n) {
    const c = e[i];
    if (isSpace(c)) { i++; continue; }
    if (isDigit(c)) {
      let j = i;
      while (j < n && (isDigit(e[j]) || e[j] === '.')) j++;
      if (j < n && isIdChar(e[j]) && !isDigit(e[j])) { const [w, p] = readWord(i); out.push({ k: 'id', s: w }); i = p; continue; }
      out.push({ k: 'num', s: e.slice(i, j) }); i = j; continue;
    }
    if (c === '`') {
      const j = e.indexOf('`', i + 1);
      if (j < 0) return { err: 'хаагдаагүй ` хашилт' };
      out.push({ k: 'id', s: e.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < n && e[j] !== c) s += e[j++];
      if (j >= n) return { err: 'хаагдаагүй хашилт' };
      out.push({ k: 'str', s }); i = j + 1; continue;
    }
    if (isIdChar(c)) {
      let [w, p] = readWord(i);
      if (KEYWORDS.has(w)) { out.push({ k: 'op', s: w }); i = p; continue; }
      while (p + 1 < n && e[p] === ' ' && isIdChar(e[p + 1])) {
        const [nx, q] = readWord(p + 1);
        if (KEYWORDS.has(nx) || !nx) break;
        w += ` ${nx}`; p = q;
      }
      out.push({ k: 'id', s: w }); i = p; continue;
    }
    const two = ['==', '!=', '<=', '>=', '<>'].find((o) => e.startsWith(o, i));
    if (two) { out.push({ k: 'op', s: two === '<>' ? '!=' : two }); i += 2; continue; }
    if ('+-*/%<>=(),:'.includes(c)) { out.push({ k: 'op', s: c }); i++; continue; }
    return { err: `танигдаагүй тэмдэгт «${c}»` };
  }
  out.push({ k: 'end', s: '' });
  return { toks: out };
}

function parse(t) {
  let i = 0, err = '';
  const isOp = (o) => t[i].k === 'op' && t[i].s === o;
  const fail = (m) => { if (!err) err = m; return { k: 'num', s: '0', kids: [] }; };
  const expr = () => orE();
  const orE = () => { let l = andE(); while (!err && isOp('or')) { i++; l = { k: 'bin', s: 'or', kids: [l, andE()] }; } return l; };
  const andE = () => { let l = notE(); while (!err && isOp('and')) { i++; l = { k: 'bin', s: 'and', kids: [l, notE()] }; } return l; };
  const notE = () => { if (isOp('not')) { i++; return { k: 'not', s: '', kids: [notE()] }; } return cmp(); };
  const cmp = () => {
    const l = add();
    if (err) return l;
    for (const o of ['==', '!=', '<=', '>=', '<', '>', '=']) if (isOp(o)) { i++; return { k: 'bin', s: o === '=' ? '==' : o, kids: [l, add()] }; }
    let neg = false;
    if (isOp('not') && i + 1 < t.length && t[i + 1].k === 'op' && t[i + 1].s === 'in') { neg = true; i++; }
    if (isOp('in')) {
      i++;
      if (!isOp('(')) return fail('in-ий дараа ( … )');
      i++;
      const nd = { k: 'in', s: neg ? 'notin' : 'in', kids: [l] };
      while (!err && !isOp(')')) {
        nd.kids.push(add());
        if (isOp(',')) i++;
        else if (!isOp(')')) return fail('in жагсаалтад таслал эсвэл )');
      }
      i++;
      return nd;
    }
    return l;
  };
  const add = () => { let l = mul(); while (!err && (isOp('+') || isOp('-'))) { const o = t[i++].s; l = { k: 'bin', s: o, kids: [l, mul()] }; } return l; };
  const mul = () => { let l = unary(); while (!err && (isOp('*') || isOp('/') || isOp('%'))) { const o = t[i++].s; l = { k: 'bin', s: o, kids: [l, unary()] }; } return l; };
  const unary = () => { if (isOp('-')) { i++; return { k: 'neg', s: '', kids: [unary()] }; } if (isOp('+')) { i++; return unary(); } return primary(); };
  const primary = () => {
    const tk = t[i];
    if (tk.k === 'num') { i++; return { k: 'num', s: tk.s, kids: [] }; }
    if (tk.k === 'str') { i++; return { k: 'str', s: tk.s, kids: [] }; }
    if (tk.k === 'op' && tk.s === '(') { i++; const e = expr(); if (!isOp(')')) return fail('хаалт ) дутуу'); i++; return e; }
    if (tk.k === 'id') {
      i++;
      if (isOp('(')) {
        i++;
        const c = { k: 'call', s: tk.s, kids: [] };
        while (!err && !isOp(')')) {
          if (t[i].k === 'end') return fail(`функц «${tk.s}»: ) дутуу`);
          if (t[i].k === 'id' && i + 1 < t.length && t[i + 1].k === 'op' && t[i + 1].s === ':') { const nm = t[i].s; i += 2; c.kids.push({ k: 'named', s: nm, kids: [expr()] }); }
          else c.kids.push(expr());
          if (isOp(',')) i++;
          else if (!isOp(')')) return fail(`функц «${tk.s}»: таслал эсвэл )`);
        }
        i++;
        return c;
      }
      return { k: 'id', s: tk.s, kids: [] };
    }
    return fail(tk.k === 'end' ? 'илэрхийлэл дутуу' : `«${tk.s}» энд байх ёсгүй`);
  };
  const node = expr();
  if (!err && t[i].k !== 'end') err = `«${t[i].s}» илүү`;
  return { node, err };
}

// лавлах хэмжээсийн шинж: <Хэмжээс>.<Багана>
export function dimAttr(S, li, name) {
  const d = name.indexOf('.');
  if (d < 0) return null;
  const dim = trimS(name.slice(0, d)), attr = trimS(name.slice(d + 1));
  const rt = li.dims.includes(dim) ? li.refs?.[dim]?.table : '';
  if (!rt) return null;
  return S.column(rt, attr) ? [dim, attr] : null;
}

function compiler(S, root) {
  let err = '';
  const bad = (m) => { if (!err) err = m; return null; };
  const OK = {};                 // утга (баганын мэдээлэлгүй — серверийн Val{sql})
  const OPAQUE = { opaque: true }; // цөмийн хүснэгтийн багана — серверт бүрэн, энд шалгахгүй
  // хүснэгтийн мөр дээрх багана / FK зам (≤ 5 сегмент) → {t, c} (серверийн Val.table/col — модны FK-г олоход)
  const pathIn = (tbl, path) => {
    if (path === 'id') return { t: tbl, c: 'id' };
    if (S.opaque?.(tbl)) return S.secret?.(tbl, path) ? null : OPAQUE;
    if (S.column(tbl, path)) return { t: tbl, c: S.column(tbl, path) };
    const segs = path.split('.').map(trimS);
    if (segs.length < 2 || segs.length > 5) return null;
    let cur = tbl, col = S.column(tbl, segs[0]);
    if (!col) return null;
    for (let i = 1; i < segs.length; i++) {
      const rt = S.fk(cur, col);
      if (!rt) return null;
      if (S.opaque?.(rt)) return segs.slice(i).some((x) => S.secret?.(rt, x)) ? null : OPAQUE; // нууц багана (createdBy.<Нууц үг>) — хаалттай
      const next = segs[i] === 'id' ? 'id' : S.column(rt, segs[i]);
      if (!next) return null;
      cur = rt; col = next;
    }
    return { t: cur, c: col };
  };
  const inScope = (sc, name) => {
    if (sc.fields) {
      if (sc.fields.has(name)) return OK;
      const d = name.indexOf('.');
      if (d < 0) return null;
      const f = name.slice(0, d), rest = name.slice(d + 1);
      if (!sc.fields.has(f) || !sc.fields.get(f)) return null;
      return pathIn(sc.fields.get(f), rest);
    }
    if (!sc.table) return null;
    if (sc.keyed && name === 'id') return OK; // параметр (текст) — серверт баганын мэдээлэлгүй
    return pathIn(sc.table, name);
  };
  const ident = (name, env) => {
    if (['today', 'now', 'true', 'false', 'null'].includes(name)) return OK;
    if (name.startsWith('param.')) {
      const p = name.slice(6);
      if (env.params?.has(p)) return OK;
      for (const [pn, rt] of env.paramRefs ?? new Map()) {
        if (p.length <= pn.length + 1 || !p.startsWith(pn) || p[pn.length] !== '.' || !env.params?.has(pn)) continue;
        return inScope({ table: rt, keyed: true }, p.slice(pn.length + 1)) || bad(`«${name}» олдсонгүй`);
      }
      return bad(`параметр «${p}» тодорхойлогдоогүй`);
    }
    const d = name.indexOf('.');
    if (d >= 0 && env.scopes?.[name.slice(0, d)]) {
      return inScope(env.scopes[name.slice(0, d)], name.slice(d + 1)) || bad(`«${name}» олдсонгүй`);
    }
    if (env.row) { const v = inScope(env.row, name); if (v) return v; }
    if (env.ident && env.ident(name)) return OK;
    if (name === 'user' && env.scopes?.user && inScope(env.scopes.user, 'code')) return OK; // T3b WP-L: `user` = user.code (X0-тэй ижил)
    return bad(`нэр «${name}» олдсонгүй (багана, FK зам, param.<нэр> эсвэл тодорхойлсон нэр)`);
  };
  const ledgerCall = (n, env) => {
    if (n.kids.length < 2 || n.kids[0].k !== 'id' || n.kids[1].k !== 'id') return bad(`${n.s}(<Ledger>, <Хэмжигдэхүүн>, …)`);
    const ln = n.kids[0].s, measure = n.kids[1].s;
    const li = S.ledger?.(ln);
    if (li === undefined) return OK; // ledger тодорхойгүй (requires-ийн багц) — шалгахгүй
    if (!li) return bad(`${n.s}: ledger «${ln}» алга`);
    if (!li.measures.includes(measure)) return bad(`${n.s}: «${ln}»-д хэмжигдэхүүн «${measure}» алга`);
    for (const a of n.kids.slice(2)) {
      if (a.k !== 'named') return bad(`${n.s}: 3 дахь аргументаас хойш <Хэмжээс>: <утга> эсвэл at:/from:/to:`);
      if (['at', 'to', 'from'].includes(a.s)) { if (!node(a.kids[0], env)) return null; continue; }
      if (!li.dims.includes(a.s) && !dimAttr(S, li, a.s)) return bad(`${n.s}: «${ln}»-д хэмжээс «${a.s}» алга (эсвэл <лавлах хэмжээс>.<багана>)`);
      if (a.kids[0].k !== 'str' && !node(a.kids[0], env)) return null;
    }
    return OK;
  };
  // T3b WP-L (N-04): `as: <нэр>` — гадна мөрийг нэрээр (доторх нэгтгэлд ч <нэр>.<Багана>); нөөц нэр хориотой
  const RESERVED_AS = new Set(['row', 'doc', 'param', 'user', 'transition', 'src', 'item', 'root', 'today', 'now', 'true', 'false', 'null', 'id']);
  const bindAs = (fn, k, env, inn) => {
    if (!k.kids.length || k.kids[0].k !== 'id' || k.kids[0].s.includes('.')) return bad(`${fn}: as: <нэр> (цэггүй)`);
    const nm = k.kids[0].s;
    if (RESERVED_AS.has(nm)) return bad(`${fn}: as: «${nm}» нөөц нэр — өөр нэр сонгоно уу`);
    if (!env.row) return bad(`${fn}: as: гадна мөр алга (мөрийн бүлэг/нэгтгэл дотор л)`);
    inn.scopes = { ...inn.scopes, [nm]: env.row };
    return OK;
  };
  // sumof/countof/…; T3b WP-L (N-05): firstof(<Хүснэгт>, <утга>[, <нөхцөл>], order: <илэрхийлэл> [desc|asc])
  const tableAgg = (n, env) => {
    const isCount = n.s === 'countof', isFirst = n.s === 'firstof';
    let orderBy = null;
    if (!n.kids.length || n.kids[0].k !== 'id') return bad(`${n.s}(<Хүснэгт>, …)`);
    const tbl = S.table(n.kids[0].s);
    if (!tbl) return bad(`${n.s}: хүснэгт «${n.kids[0].s}» алга`);
    const inn = { ...env, row: { table: tbl }, scopes: { ...env.scopes, ...(env.row ? { row: env.row } : {}) }, windows: false };
    const pos = [];
    for (const k of n.kids.slice(1)) {
      if (k.k === 'named' && k.s === 'as') { if (!bindAs(n.s, k, env, inn)) return null; continue; }
      if (k.k === 'named' && k.s === 'order' && isFirst) { orderBy = k.kids[0]; continue; }
      if (k.k === 'named') {
        if (k.s !== 'date') return bad(n.s + (isFirst ? ': нэрлэсэн аргумент date:, order:, as:' : ': нэрлэсэн аргумент date:, as:'));
        if (k.kids[0].k === 'id' && k.kids[0].s === 'none') continue;
        if (k.kids[0].k !== 'id' || (!S.opaque?.(tbl) && !S.column(tbl, k.kids[0].s))) return bad(`${n.s}: date — «${tbl}»-ийн багана`);
        continue;
      }
      pos.push(k);
    }
    if (!isCount && !pos.length) return bad(`${n.s}(<Хүснэгт>, <утга>[, <нөхцөл>])`);
    let pi = 0;
    if (!isCount && !node(pos[pi++], inn)) return null;
    if (pi < pos.length && !node(pos[pi++], inn)) return null;
    if (pi < pos.length) return bad(`${n.s}: аргумент илүү`);
    if (isFirst && orderBy) {
      let ob = orderBy;
      if (ob.k === 'id') for (const d of [' desc', ' asc']) if (ob.s.length > d.length && ob.s.endsWith(d)) { ob = { ...ob, s: trimS(ob.s.slice(0, -d.length)) }; break; }
      if (!node(ob, inn)) return null;
    }
    return OK;
  };
  const asofCall = (n, env) => {
    if ((n.kids.length !== 3 && n.kids.length !== 4) || n.kids[0].k !== 'id' || n.kids[1].k !== 'bin' || n.kids[1].s !== '==' || n.kids[1].kids[0].k !== 'id')
      return bad('asof(<Хүснэгт>.<Утга>, <Түлхүүр> = <илэрхийлэл>, <огноо>[, <хүчинтэй багана>])');
    const tv = n.kids[0].s, dot = tv.indexOf('.');
    if (dot < 0) return bad('asof: <Хүснэгт>.<Утга>');
    const rt = S.table(trimS(tv.slice(0, dot)));
    if (!rt) return bad(`asof: хүснэгт «${tv.slice(0, dot)}» алга`);
    if (!S.opaque?.(rt)) {
      const vc = S.column(rt, trimS(tv.slice(dot + 1))), kc = S.column(rt, n.kids[1].kids[0].s);
      const ec = n.kids.length === 4 && n.kids[3].k === 'id' ? S.column(rt, n.kids[3].s) : S.effectiveCol?.(rt) || S.dateCol?.(rt);
      if (!vc || !kc || !ec) return bad(`asof: «${rt}»-ийн утга/түлхүүр/хүчинтэй огнооны багана алга`);
    }
    if (!node(n.kids[1].kids[1], env)) return null;
    return node(n.kids[2], env);
  };
  const nearestCall = (n, env) => {
    const pos = [];
    let within = null;
    for (const k of n.kids) {
      if (k.k === 'named' && k.s === 'as') continue; // inn-д доор
      if (k.k === 'named') { if (k.s !== 'within') return bad('nearest: нэрлэсэн аргумент within:, as:'); within = k.kids[0]; continue; }
      pos.push(k);
    }
    if (pos.length < 3 || pos.length > 4 || pos[0].k !== 'id' || pos[1].k !== 'id') return bad('nearest(<Хүснэгт>, <цэгийн багана>, <цэг>[, <нөхцөл>][, within: <метр>])');
    const tbl = S.table(pos[0].s);
    if (!tbl) return bad(`nearest: хүснэгт «${pos[0].s}» алга`);
    if (!S.opaque?.(tbl) && !S.column(tbl, pos[1].s)) return bad(`nearest: «${pos[1].s}» багана алга`);
    if (!node(pos[2], env)) return null;
    const inn = { ...env, row: { table: tbl }, scopes: { ...env.scopes, ...(env.row ? { row: env.row } : {}) }, windows: false };
    for (const k of n.kids) if (k.k === 'named' && k.s === 'as' && !bindAs('nearest', k, env, inn)) return null;
    if (pos.length === 4 && !node(pos[3], inn)) return null;
    if (within && !node(within, env)) return null;
    return OK;
  };
  const RANGE = { min: [1, 20], max: [1, 20], coalesce: [1, 20], concat: [1, 20], round: [1, 3], power: [2, 2], hour: [1, 1], weekday: [1, 1],
    datetime: [1, 2], hours: [2, 2], abs: [1, 1], floor: [1, 1], ceil: [1, 1], iff: [3, 3],
    year: [1, 1], month: [1, 1], month_start: [1, 1], year_start: [1, 1], month_end: [1, 1], year_end: [1, 1], add_days: [2, 2], add_months: [2, 2],
    days: [2, 2], months: [2, 2], date: [1, 1], distance: [2, 2], inside: [2, 2] };
  const WINDOW = { rownum: [0, 0], prev: [1, 2], cumsum: [1, 1], sumall: [1, 1], allocate: [2, 2], prorate: [2, 3] };
  const args = (n, env, lo, hi) => {
    if (n.kids.length < lo || n.kids.length > hi) return bad(`${n.s}: аргументын тоо ${lo}${hi !== lo ? `..${hi}` : ''}`);
    for (const k of n.kids) { if (k.k === 'named') return bad(`${n.s}: нэрлэсэн аргумент хүлээгээгүй`); if (!node(k, env)) return null; }
    return OK;
  };
  // T3b WP-K: модны хүснэгт — x нь модны (өөр рүүгээ FK-тэй) хүснэгтийн id эсвэл тийшээ заасан FK багана/зам; `type: ref` параметр ч
  const treeOf = (k, v, env) => {
    if (v === OPAQUE) return 'opaque';
    let t = '';
    if (v?.t && v?.c) t = v.c === 'id' ? v.t : S.fk(v.t, v.c);
    else if (k.k === 'id' && k.s.startsWith('param.') && env.paramRefs?.has(k.s.slice(6))) t = env.paramRefs.get(k.s.slice(6));
    return t && S.treeParent?.(t) ? t : '';
  };
  // T3b WP-K (N-02): under(x, <зангилаа>) / root(x) / depth(x)
  const treeCall = (n, env) => {
    const f = n.s, want = f === 'under' ? 2 : 1;
    if (n.kids.length !== want) return bad(f === 'under' ? 'under(<FK багана|id>, <зангилаа>)' : `${f}(<FK багана|id>)`);
    for (const k of n.kids) if (k.k === 'named') return bad(`${f}: нэрлэсэн аргумент хүлээгээгүй`);
    const x = node(n.kids[0], env);
    if (!x) return null;
    let nd = null;
    if (want === 2) { nd = node(n.kids[1], env); if (!nd) return null; }
    let t = treeOf(n.kids[0], x, env);
    if (!t && nd) t = treeOf(n.kids[1], nd, env);
    if (!t) return bad(`${f}: «${n.kids[0].k === 'id' ? n.kids[0].s : 'x'}» модны (өөр рүүгээ FK-тэй) хүснэгтийн id эсвэл тийшээ заасан FK багана биш`);
    return OK;
  };
  // T3b WP-L (N-03): round(x, n, горим) — горим/орны литерал шалгалт; regexp/matches — загвар текст литерал (каноник)
  const ROUND_MODES = new Set(['half-up', 'half-even', 'floor', 'ceil', 'down', 'up']);
  const roundCall = (n, env) => {
    if (n.kids.length === 3 && n.kids[2].k === 'str' && !ROUND_MODES.has(n.kids[2].s)) return bad(`round: горим «${n.kids[2].s}» буруу (half-up | half-even | floor | ceil | down | up)`);
    if (n.kids.length === 2 && n.kids[1].k === 'num' && Math.abs(parseFloat(n.kids[1].s)) > 10) return bad('round: орон −10…10');
    return args(n, env, 1, 3);
  };
  const regexpCall = (n, env) => {
    const f = n.s;
    if (n.kids.length < 2 || n.kids.length > (f === 'regexp' ? 3 : 2) || n.kids[1].k !== 'str') return bad(`${f}(<текст>, '<загвар>'${f === 'regexp' ? '[, <бүлэг>]' : ''}) — загвар текст литерал байх ёстой`);
    let groups = Infinity;
    if (reCanonical) {
      const c = reCanonical(n.kids[1].s);
      if (typeof c === 'string') return bad(c);
      groups = c.groups;
    }
    if (n.kids.length === 3) {
      const g = n.kids[2];
      if (g.k !== 'num' || g.s.includes('.') || parseInt(g.s, 10) > groups) return bad(`regexp: бүлэг 0…${groups} бүхэл тоо (литерал)`);
    }
    return node(n.kids[0], env);
  };
  const call = (n, env) => {
    const f = n.s;
    if (f === 'balance' || f === 'change') return ledgerCall(n, env);
    if (['sumof', 'countof', 'avgof', 'minof', 'maxof', 'firstof'].includes(f)) return tableAgg(n, env);
    if (f === 'asof') return asofCall(n, env);
    if (env.call) {
      const r = env.call(f, n.kids.map((k) => (k.k === 'id' || k.k === 'str' ? k.s : '')));
      if (r?.ok) return OK;
      if (r?.err) return bad(r.err);
    }
    if (f === 'round') return roundCall(n, env);
    if (RANGE[f]) return args(n, env, ...RANGE[f]);
    if (f === 'regexp' || f === 'matches') return regexpCall(n, env);
    if (f === 'like') {
      if (n.kids.length !== 2 || n.kids[1].k !== 'str') return bad("like(<утга>, '<загвар*>[|<загвар2*>]')");
      return node(n.kids[0], env);
    }
    if (f === 'nearest') return nearestCall(n, env);
    if (f === 'under' || f === 'root' || f === 'depth') return treeCall(n, env);
    if (WINDOW[f]) {
      if (!env.windows) return bad(`${f}(): зөвхөн мөрийн бүлэгт (generators.yaml lines/update)`);
      return args(n, env, ...WINDOW[f]);
    }
    return bad(`функц «${f}» танигдсангүй`);
  };
  const node = (n, env) => {
    switch (n.k) {
      case 'num': case 'str': return OK;
      case 'id': return ident(n.s, env);
      case 'call': return call(n, env);
      case 'named': return bad(`нэрлэсэн аргумент «${n.s}:» зөвхөн функцэд`);
      case 'neg': case 'not': return node(n.kids[0], env);
      default: for (const k of n.kids) if (!node(k, env)) return null; return OK;
    }
  };
  return { run: () => (node(root.node, root.env) ? '' : err) };
}

// → '' (зөв) эсвэл серверийн exprsql::compile-ийн err (жишээ «sumof(А, Б)»: нэр «Б» олдсонгүй …)
export function compileExpr(expr, S, env = {}) {
  const e = trimS(expr);
  if (!e) return 'хоосон илэрхийлэл';
  const l = lex(e);
  if (l.err) return `«${e}»: ${l.err}`;
  const p = parse(l.toks);
  if (p.err) return `«${e}»: ${p.err}`;
  const c = compiler(S, { node: p.node, env }).run();
  return c ? `«${e}»: ${c}` : '';
}
