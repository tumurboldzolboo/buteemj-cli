// web/src/lib/expr.ts-ийн хуулбар (төрөл хассан) — гараар засахгүй: npm run sync-validator
// PLAN4 Phase X0 — нэгдсэн илэрхийллийн хэл (клиент тал). cgi/src/expr/Expr.cpp-тэй ЯГ ИЖИЛ семантик:
// cgi/tests/expr/vectors.json нэг файлыг хоёр тал (buteemj_expr_tests, web/e2e/expr_vectors.mjs) ажиллуулна.
// Хэлний бүрэн тодорхойлолт Expr.cpp-ийн толгой тайлбарт. Энэ файл зөвхөн import-гүй ./geo.ts-ийг импортолно, зөвхөн erasable
// TypeScript (enum/parameter property байхгүй) — Node шууд ажиллуулж чадна (e2e/expr_vectors.mjs).
import { geoDistance, geoInside } from './geo.mjs';
import { canonical as reCanonical, find as reFind } from './regexp.mjs';

                                                                                       

                        
                             
                                                                                

                    
               
              
              
 
                   
              
              
 

const MAX_LENGTH = 10000;
const MAX_DEPTH = 200;

const parseErr = (msg        , pos        )           => ({ tag: 'parse', msg, pos });
const evalErr = (msg        )          => ({ tag: 'eval', msg });

// ---------------------------------------------------------------------------------- Lexer
                                                      

                 
                
               
              
                 
              
 

const isDigit = (c        ) => c >= '0' && c <= '9' && c.length === 1;
// PLAN7 P7.4 M4a: кирилл (ASCII бус) үсэг identifier-т зөвшөөрөгдөнө (C++ Expr.cpp-тэй ижил)
const isIdentStart = (c        ) => c.length >= 1 && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c.codePointAt(0)  >= 0x80);
const isIdentPart = (c        ) => isIdentStart(c) || isDigit(c);

function hexVal(c        )         {
  if (c.length !== 1) return -1;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 97 + 10;
  if (c >= 'A' && c <= 'F') return c.charCodeAt(0) - 65 + 10;
  return -1;
}

function lex(src          )          {
  const out          = [];
  const n = src.length;
  let i = 0;
  while (true) {
    while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++;
    if (i >= n) break;
    const c = src[i];
    const t        = { kind: 'end', text: '', num: 0, isInt: false, pos: i };

    if (isDigit(c)) {
      let j = i;
      while (j < n && isDigit(src[j])) j++;
      let isInt = true;
      if (j + 1 < n && src[j] === '.' && isDigit(src[j + 1])) {
        isInt = false;
        j++;
        while (j < n && isDigit(src[j])) j++;
      }
      if (j < n && (src[j] === 'e' || src[j] === 'E')) {
        let k = j + 1;
        if (k < n && (src[k] === '+' || src[k] === '-')) k++;
        if (k < n && isDigit(src[k])) {
          isInt = false;
          while (k < n && isDigit(src[k])) k++;
          j = k;
        }
      }
      if (j < n && isIdentPart(src[j])) throw parseErr('тоо ба үсэг залгаа бичигдсэн', j);
      const num = Number(src.slice(i, j).join(''));
      if (!Number.isFinite(num)) throw parseErr('тоо хэт том', i);
      t.kind = 'num';
      t.num = num;
      t.isInt = isInt;
      i = j;
    } else if (isIdentStart(c)) {
      let j = i;
      while (j < n && isIdentPart(src[j])) j++;
      t.kind = 'ident';
      t.text = src.slice(i, j).join('');
      i = j;
    } else if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let val = '';
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === quote) {
          closed = true;
          j++;
          break;
        }
        if (d === '\\') {
          if (j + 1 >= n) throw parseErr('текст дуусаагүй', i);
          const e = src[j + 1];
          if (e === 'n') { val += '\n'; j += 2; }
          else if (e === 't') { val += '\t'; j += 2; }
          else if (e === 'r') { val += '\r'; j += 2; }
          else if (e === '"' || e === "'" || e === '\\') { val += e; j += 2; }
          else if (e === 'u') {
            if (j + 5 >= n) throw parseErr('\\u escape буруу', j);
            let cp = 0;
            for (let k = 0; k < 4; k++) {
              const h = hexVal(src[j + 2 + k]);
              if (h < 0) throw parseErr('\\u escape буруу', j);
              cp = cp * 16 + h;
            }
            if (cp >= 0xd800 && cp <= 0xdfff) throw parseErr('\\u surrogate дэмжигдэхгүй', j);
            val += String.fromCodePoint(cp);
            j += 6;
          } else {
            throw parseErr('escape буруу', j);
          }
          continue;
        }
        val += d;
        j++;
      }
      if (!closed) throw parseErr('текст дуусаагүй', i);
      t.kind = 'str';
      t.text = val;
      i = j;
    } else {
      t.kind = 'op';
      const two = i + 1 < n ? c + src[i + 1] : '';
      if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
        t.text = two;
        i += 2;
      } else if ('<>+-*/%()[],.'.includes(c) && c.length === 1) {
        t.text = c;
        i++;
      } else {
        throw parseErr('тэмдэгт буруу', i);
      }
    }
    out.push(t);
  }
  out.push({ kind: 'end', text: '', num: 0, isInt: false, pos: n });
  return out;
}

// ---------------------------------------------------------------------------------- AST
               
                   
              
              
 

                
                                                                                   
            
               
              
             
               
                  
 

const mk = (kind              )       => ({ kind, lit: null, root: '', segs: [], op: '', kids: [], negate: false });

const FNS                                   = {
  len: [1, 1],
  lower: [1, 1],
  upper: [1, 1],
  contains: [2, 2],
  startsWith: [2, 2],
  endsWith: [2, 2],
  between: [3, 3],
  coalesce: [1, -1],
  iff: [3, 3],
  hours: [2, 2],
  empty: [1, 1],
  abs: [1, 1],
  nvl: [2, 2], // PLAN8: parse үед coalesce
  power: [2, 2],
  round: [1, 3], // GAPS G11: round(x[, орон[, горим]]) — сервертэй ижил
  year: [1, 1], // PLAN8 C3.1: огнооны хэсэг (сервертэй ижил)
  month: [1, 1],
  day: [1, 1],
  quarter: [1, 1],
  distance: [2, 2], // T3 WP-F G-T3-14/15: гео (geo.ts) — сервертэй ижил
  inside: [2, 2],
  under: [2, 2], // T3b WP-K: мод — зөвхөн серверт (өгөгдлийн сан); клиентэд eval алдаа (serverOnly)
  root: [1, 1],
  depth: [1, 1],
  min: [1, -1],
  max: [1, -1],
  number: [1, 1],
  text: [1, 2],
  concat: [1, -1],
  date: [1, 1],
  changed: [1, 1],
  hour: [1, 1], // T3b WP-L (N-03): цаг (0–23), ISO гараг, огноо + цаг — сервертэй ижил
  weekday: [1, 1],
  datetime: [1, 2],
  regexp: [2, 3], // T3b WP-L: regexp(x, загвар[, бүлэг]) / matches(x, загвар) — regexp.ts (Regexp.h-тэй ижил)
  matches: [2, 2],
  hmac: [3, 4], // T3b WP-R (N-18): hmac(alg, түлхүүр, мессеж[, hex|base64]) / digest(alg, мессеж[, …]) — зөвхөн серверт (OpenSSL hook)
  digest: [2, 3],
};

// ---------------------------------------------------------------------------------- Parser
class Parser {
  t         ;
  i = 0;
  depth = 0;

  constructor(toks         ) {
    this.t = toks;
  }

  cur()        {
    return this.t[this.i];
  }
  next()       {
    if (this.t[this.i].kind !== 'end') this.i++;
  }
  isOp(op        )          {
    return this.cur().kind === 'op' && this.cur().text === op;
  }
  isKw(kw        )          {
    return this.cur().kind === 'ident' && this.cur().text === kw;
  }
  enter()       {
    if (++this.depth > MAX_DEPTH) throw parseErr('илэрхийлэл хэт гүн', this.cur().pos);
  }
  leave()       {
    this.depth--;
  }

  parse()       {
    const n = this.parseOr();
    if (this.cur().kind !== 'end') throw parseErr('илүү тэмдэгт', this.cur().pos);
    return n;
  }

  parseOr()       {
    this.enter();
    try {
      let left = this.parseAnd();
      while (this.isKw('or')) {
        this.next();
        const b = mk('bin');
        b.op = 'or';
        b.kids = [left, this.parseAnd()];
        left = b;
      }
      return left;
    } finally {
      this.leave();
    }
  }

  parseAnd()       {
    let left = this.parseNot();
    while (this.isKw('and')) {
      this.next();
      const b = mk('bin');
      b.op = 'and';
      b.kids = [left, this.parseNot()];
      left = b;
    }
    return left;
  }

  parseNot()       {
    this.enter();
    try {
      if (this.isKw('not')) {
        this.next();
        const n = mk('not');
        n.kids = [this.parseNot()];
        return n;
      }
      return this.parseCmp();
    } finally {
      this.leave();
    }
  }

  isCmpOp()          {
    if (this.cur().kind !== 'op') return false;
    const s = this.cur().text;
    return s === '==' || s === '!=' || s === '<' || s === '<=' || s === '>' || s === '>=';
  }

  parseCmp()       {
    const left = this.parseAdd();
    let result      ;
    if (this.isCmpOp()) {
      const b = mk('bin');
      b.op = this.cur().text;
      this.next();
      b.kids = [left, this.parseAdd()];
      result = b;
    } else if (this.isKw('in') || (this.isKw('not') && this.t[this.i + 1]?.kind === 'ident' && this.t[this.i + 1]?.text === 'in')) {
      // PLAN8: `X not in L` = not (X in L); `in ('A', 'B')` — хаалттай жагсаалт = ['A', 'B'] (C++-тэй ижил)
      const neg = this.isKw('not');
      if (neg) this.next();
      this.next();
      const n = mk('in');
      if (this.isOp('(')) {
        this.next();
        const l = mk('list');
        l.kids = this.parseArgs(')');
        n.kids = [left, l];
      } else n.kids = [left, this.parseAdd()];
      if (neg) {
        const x = mk('not');
        x.kids = [n];
        result = x;
      } else result = n;
    } else if (this.isKw('is')) {
      this.next();
      const n = mk('isnull');
      if (this.isKw('not')) {
        n.negate = true;
        this.next();
      }
      if (!this.isKw('null')) throw parseErr("'is' дараа 'null' хүлээгдэж байна", this.cur().pos);
      this.next();
      n.kids = [left];
      result = n;
    } else {
      return left;
    }
    if (this.isCmpOp() || this.isKw('in') || this.isKw('is')) throw parseErr('харьцуулалтыг гинжлэх боломжгүй', this.cur().pos);
    return result;
  }

  parseAdd()       {
    let left = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const b = mk('bin');
      b.op = this.cur().text;
      this.next();
      b.kids = [left, this.parseMul()];
      left = b;
    }
    return left;
  }

  parseMul()       {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const b = mk('bin');
      b.op = this.cur().text;
      this.next();
      b.kids = [left, this.parseUnary()];
      left = b;
    }
    return left;
  }

  parseUnary()       {
    this.enter();
    try {
      if (this.isOp('-')) {
        this.next();
        const n = mk('neg');
        n.kids = [this.parseUnary()];
        return n;
      }
      return this.parsePrimary();
    } finally {
      this.leave();
    }
  }

  parseArgs(closer        )         {
    const args         = [];
    if (this.isOp(closer)) {
      this.next();
      return args;
    }
    while (true) {
      args.push(this.parseOr());
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      if (this.isOp(closer)) {
        this.next();
        break;
      }
      throw parseErr(`'${closer}' эсвэл ',' хүлээгдэж байна`, this.cur().pos);
    }
    return args;
  }

  parsePrimary()       {
    const tk = this.cur();
    if (tk.kind === 'num') {
      this.next();
      const n = mk('lit');
      n.lit = tk.num;
      return n;
    }
    if (tk.kind === 'str') {
      this.next();
      const n = mk('lit');
      n.lit = tk.text;
      return n;
    }
    if (this.isOp('(')) {
      this.next();
      const inner = this.parseOr();
      if (!this.isOp(')')) throw parseErr("')' хүлээгдэж байна", this.cur().pos);
      this.next();
      return inner;
    }
    if (this.isOp('[')) {
      this.next();
      const n = mk('list');
      n.kids = this.parseArgs(']');
      return n;
    }
    if (tk.kind === 'ident') {
      if (tk.text === 'true' || tk.text === 'false') {
        this.next();
        const n = mk('lit');
        n.lit = tk.text === 'true';
        return n;
      }
      if (tk.text === 'null') {
        this.next();
        return mk('lit');
      }
      if (tk.text === 'and' || tk.text === 'or' || tk.text === 'not' || tk.text === 'in' || tk.text === 'is')
        throw parseErr(`'${tk.text}' түлхүүр үг энд байж болохгүй`, tk.pos);
      this.next();
      if (this.isOp('(')) {
        const spec = Object.prototype.hasOwnProperty.call(FNS, tk.text) ? FNS[tk.text] : undefined;
        if (!spec) throw parseErr(`тодорхойгүй функц: ${tk.text}`, tk.pos);
        this.next();
        const n = mk('call');
        n.op = tk.text === 'nvl' ? 'coalesce' : tk.text; // PLAN8: C++-тэй ижил
        n.kids = this.parseArgs(')');
        const argc = n.kids.length;
        if (argc < spec[0] || (spec[1] >= 0 && argc > spec[1])) throw parseErr(`функцийн аргын тоо буруу: ${tk.text}`, tk.pos);
        return n;
      }
      const n = mk('path');
      n.root = tk.text;
      while (true) {
        if (this.isOp('.')) {
          this.next();
          if (this.cur().kind !== 'ident') throw parseErr("'.' дараа нэр хүлээгдэж байна", this.cur().pos);
          // PLAN7 P7.4 M4c: коллекцийн арга <зам>.all(expr) | any(expr) | count([expr]) | sum(expr) (C++ Expr.cpp-тэй ижил)
          const mname = this.cur().text;
          const nx = this.t[this.i + 1];
          if ((mname === 'all' || mname === 'any' || mname === 'count' || mname === 'sum') && nx && nx.kind === 'op' && nx.text === '(') {
            const mpos = this.cur().pos;
            this.next(); this.next();
            const call = mk('call');
            call.op = `coll:${mname}`;
            call.kids.push(n);
            if (!this.isOp(')')) call.kids.push(this.parseOr());
            if (!this.isOp(')')) throw parseErr("')' хүлээгдэж байна", this.cur().pos);
            this.next();
            if (mname !== 'count' && call.kids.length < 2) throw parseErr(`'${mname}(' дотор илэрхийлэл хүлээгдэж байна`, mpos);
            return call;
          }
          n.segs.push({ isIndex: false, idx: 0, key: this.cur().text });
          this.next();
        } else if (this.isOp('[')) {
          this.next();
          let s     ;
          if (this.cur().kind === 'num' && this.cur().isInt && this.cur().num >= 0) {
            s = { isIndex: true, idx: this.cur().num, key: '' };
          } else if (this.cur().kind === 'str') {
            s = { isIndex: false, idx: 0, key: this.cur().text };
          } else {
            throw parseErr("'[' дотор бүхэл тоо эсвэл текст хүлээгдэж байна", this.cur().pos);
          }
          this.next();
          if (!this.isOp(']')) throw parseErr("']' хүлээгдэж байна", this.cur().pos);
          this.next();
          n.segs.push(s);
        } else {
          break;
        }
      }
      return n;
    }
    if (tk.kind === 'end') throw parseErr('илэрхийлэл дутуу', tk.pos);
    throw parseErr('тэмдэгт буруу', tk.pos);
  }
}

// ---------------------------------------------------------------------------------- Утгын туслахууд
const isObj = (v      )                               => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStructured = (v      ) => Array.isArray(v) || isObj(v);
const hasOwn = (o        , k        ) => Object.prototype.hasOwnProperty.call(o, k);

const NUMERIC_RE = /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

function numericLike(v      )                     {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && NUMERIC_RE.test(v)) {
    const d = Number(v);
    if (Number.isFinite(d)) return d;
  }
  return undefined;
}

function formatNumber(x        )         {
  if (x === 0) return '0';
  return String(x);
}

function textOf(v      )         {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return v;
  throw evalErr('массив/объектыг текст болгох боломжгүй');
}

function looseEq(a      , b      )          {
  if (isStructured(a) || isStructured(b)) {
    if (a === null || b === null) return false;
    throw evalErr('массив/объектыг тэнцүүгээр харьцуулах боломжгүй');
  }
  // PostgreSQL-ийн boolean текст хэлбэр ('t'/'f') ↔ true/false (C++ Expr.cpp-тэй ижил)
  if ((typeof a === 'boolean') !== (typeof b === 'boolean')) {
    const s = typeof a === 'boolean' ? b : a;
    const bv = typeof a === 'boolean' ? a : b;
    if (s === 't' || s === 'f') return (s === 't') === bv;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const na = numericLike(a);
    const nb = numericLike(b);
    if (na !== undefined && nb !== undefined) return na === nb;
    return textOf(a) === textOf(b);
  }
  return textOf(a) === textOf(b);
}

// "YYYY-MM-DD[T| ]HH:MM[:SS[.fff]][Z|±HH[:MM]]" → UTC секунд; бүсгүй (огноо л бол 00:00) утга — байгууллагын бүс (setOrgTimeZone) өгсөн бол
// тэр бүсийн цаг, эс бөгөөс UTC гэж (C++ isoSeconds-тэй ижил — P-WP-21 «бүсгүй огноо-цаг = байгууллагын бүс»)
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/;
function isoWall(s        )                                              {
  const m = ISO_RE.exec(s);
  if (!m) return undefined;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
  const z = m[7];
  if (z && z !== 'Z' && z !== 'z') {
    const off = +z.slice(1, 3) * 3600 + +(z.replace(':', '').slice(3, 5) || 0) * 60;
    t += z[0] === '+' ? -off : off;
  }
  return { sec: t, zoned: !!z };
}
// P-WP-21: байгууллагын бүсийн «орон нутаг − UTC» (секунд); fromLocal — `sec` орон нутгийн цагийн секунд
function tzOffset(sec        , fromLocal         )         {
  if (!orgTimeZone) return 0;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: orgTimeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const wall = (u        ) => {
      const p                         = {};
      for (const x of f.formatToParts(new Date(u * 1000))) if (x.type !== 'literal') p[x.type] = +x.value;
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
    };
    if (!fromLocal) return wall(sec) - sec;
    const o1 = wall(sec) - sec; // ойролцоо; шилжилтийн ойролцоо дахин
    return wall(sec - o1) - (sec - o1);
  } catch {
    return 0;
  }
}
function isoSeconds(s        )                     {
  const w = isoWall(s);
  if (!w) return undefined;
  return w.zoned || !orgTimeZone ? w.sec : w.sec - tzOffset(w.sec, true);
}
// P-WP-21: бүстэй огноо-цаг → байгууллагын бүсийн «YYYY-MM-DDTHH:MM:SS» (C++ orgLocal, SQL bj_local_ts); бусад нь хэвээр
function orgLocal(v      )       {
  if (!orgTimeZone || typeof v !== 'string' || v.length <= 10) return v;
  const w = isoWall(v);
  if (!w || !w.zoned) return v;
  return new Date((w.sec + tzOffset(w.sec, false)) * 1000).toISOString().slice(0, 19);
}

function compareOrd(a      , b      )                     {
  if (a === null || b === null) return undefined;
  if (isStructured(a) || isStructured(b)) throw evalErr('массив/объектыг эрэмбэлэн харьцуулах боломжгүй');
  const na = numericLike(a);
  const nb = numericLike(b);
  if (na !== undefined && nb !== undefined) return na < nb ? -1 : na > nb ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string' && (a.length > 10 || b.length > 10)) {
    // огноо/огноо-цаг: бичлэгийн хэлбэрээс үл хамааран агшноор нь (C++ Expr.cpp-тэй ижил)
    const sa = isoSeconds(a), sb = isoSeconds(b);
    if (sa !== undefined && sb !== undefined) return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const ua = Array.from(a);
    const ub = Array.from(b);
    const n = Math.min(ua.length, ub.length);
    for (let i = 0; i < n; i++) {
      if (ua[i] !== ub[i]) return ua[i].codePointAt(0)  < ub[i].codePointAt(0)  ? -1 : 1;
    }
    return ua.length < ub.length ? -1 : ua.length > ub.length ? 1 : 0;
  }
  return undefined;
}

function toBool(v      )          {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'string') {
    if (v === 'true' || v === 't') return true;
    if (v === 'false' || v === 'f') return false;
  }
  throw evalErr('bool биш утга');
}

function checkedNumber(d        )         {
  if (!Number.isFinite(d)) throw evalErr('тооцооллын үр дүн хязгаараас хэтэрсэн');
  return d;
}

function arith(op        , a      , b      )       {
  if (a === null || b === null) return null;
  const na = numericLike(a);
  const nb = numericLike(b);
  if (na === undefined || nb === undefined) throw evalErr('тоон биш утгатай арифметик');
  if (op === '+') return checkedNumber(na + nb);
  if (op === '-') return checkedNumber(na - nb);
  if (op === '*') return checkedNumber(na * nb);
  if (op === '/') {
    if (nb === 0) throw evalErr('0-д хуваасан');
    return checkedNumber(na / nb);
  }
  if (nb === 0) throw evalErr('0-д хуваасан');
  return checkedNumber(na % nb);
}

function lowerCp(c        )         {
  if (c >= 0x41 && c <= 0x5a) return c + 32;
  if (c >= 0x0410 && c <= 0x042f) return c + 32;
  if (c >= 0x0400 && c <= 0x040f) return c + 80;
  if (c === 0x04e8 || c === 0x04ae) return c + 1;
  return c;
}

function upperCp(c        )         {
  if (c >= 0x61 && c <= 0x7a) return c - 32;
  if (c >= 0x0430 && c <= 0x044f) return c - 32;
  if (c >= 0x0450 && c <= 0x045f) return c - 80;
  if (c === 0x04e9 || c === 0x04af) return c - 1;
  return c;
}

function validDate(s        )          {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let maxD = dim[m - 1];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (m === 2 && leap) maxD = 29;
  return d <= maxD;
}

// ---------------------------------------------------------------------------------- Үнэлгээ
// `now` / `today` — контекстэд өгөөгүй бол системийн цаг. T4 (99zd): `today` — байгууллагын цагийн бүсийн өдөр (C++ Expr.cpp — requireAuth-ийн
// bj_org_today-тай ижил); бүсийг setOrgTimeZone()-оор (байгууллагын тохиргоо), эс бөгөөс хөтчийн орон нутгийн бүс.
let orgTimeZone                    ;
export function setOrgTimeZone(tz                           )       { orgTimeZone = tz || undefined; }
function clockValue(name        )         {
  const d = new Date();
  if (name === 'now') return d.toISOString().slice(0, 19) + 'Z';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: orgTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function resolvePath(n      , ctx      )       {
  let cur       = null;
  if (isObj(ctx) && hasOwn(ctx, n.root)) cur = ctx[n.root];
  else if (n.segs.length === 0 && (n.root === 'now' || n.root === 'today')) return clockValue(n.root);
  for (const s of n.segs) {
    if (s.isIndex) {
      if (Array.isArray(cur) && s.idx >= 0 && s.idx < cur.length) cur = cur[s.idx];
      else return null;
    } else {
      if (isObj(cur) && hasOwn(cur, s.key)) cur = cur[s.key];
      else return null;
    }
  }
  return cur;
}

function requireScalarText(v      )         {
  if (isStructured(v)) throw evalErr('скаляр утга хүлээгдэж байна');
  return textOf(v);
}

function callFn(n      , ctx      )       {
  const f = n.op;
  const arg = (i        ) => evalNode(n.kids[i], ctx);

  if (f === 'iff') return toBool(arg(0)) ? arg(1) : arg(2); // зөвхөн сонгогдсон салаа
  // T3b WP-K: модны функц — сервер (cgi Expr.cpp TreeHook) өгөгдлийн сангаас үнэлнэ; клиентэд мод алга (C++ hook-гүй горимтой ижил алдаа)
  if (f === 'under' || f === 'root' || f === 'depth') throw evalErr(`${f}(): модны функц зөвхөн серверийн контекстод (өгөгдлийн сангаас) үнэлэгдэнэ`);
  // T3b WP-R: hmac/digest — сервер (Expr.cpp CryptoHook, нууц SecretScope-оос); клиентэд нууц/OpenSSL алга (C++ hook-гүй горимтой ижил алдаа)
  if (f === 'hmac' || f === 'digest') throw evalErr(`${f}(): зөвхөн серверийн контекстод (гарах дуудлагын бие/толгой, орох гарын үсэг) үнэлэгдэнэ`);
  if (f === 'year' || f === 'month' || f === 'day' || f === 'quarter') { // PLAN8 C3.1; P-WP-21: бүстэй — байгууллагын бүсийн өдөр
    const v = orgLocal(arg(0));
    if (v === null) return null;
    const s = typeof v === 'string' ? v : '';
    if (s.length < 10 || !validDate(s.slice(0, 10))) throw evalErr(`${f}: огноо (YYYY-MM-DD) хүлээгдэж байна`);
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    return f === 'year' ? y : f === 'month' ? m : f === 'day' ? d : Math.floor((m - 1) / 3) + 1;
  }
  if (f === 'hour' || f === 'weekday') { // T3b WP-L (N-03, Тоду P-G07): бичигдсэн цаг; P-WP-21: бүстэй — байгууллагын бүсийн цаг (сервертэй ижил)
    const v = orgLocal(arg(0));
    if (v === null) return null;
    const s = typeof v === 'string' ? v : '';
    if (s.length < 10 || !validDate(s.slice(0, 10)) || (s.length > 10 && s[10] !== 'T' && s[10] !== ' ')) throw evalErr(`${f}: огноо/цаг (YYYY-MM-DD[THH:MM]) хүлээгдэж байна`);
    if (f === 'weekday') { const d = Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000); return ((d % 7) + 7 + 3) % 7 + 1; }
    if (s.length === 10) return 0;
    if (s.length < 13 || !/^\d\d$/.test(s.slice(11, 13)) || +s.slice(11, 13) > 23) throw evalErr('hour: цаг (THH:MM) буруу');
    return +s.slice(11, 13);
  }
  if (f === 'datetime') { // T3b WP-L (N-03): огноо + цаг → 'YYYY-MM-DDTHH:MM:SS' (сервертэй ижил)
    const d = orgLocal(arg(0)), t = n.kids.length > 1 ? orgLocal(arg(1)) : '00:00';
    if (d === null || t === null) return null;
    const ds = typeof d === 'string' ? d : '';
    if (ds.length < 10 || !validDate(ds.slice(0, 10)) || (ds.length > 10 && ds[10] !== 'T' && ds[10] !== ' ')) throw evalErr('datetime: огноо (YYYY-MM-DD) хүлээгдэж байна');
    let ts = typeof t === 'string' ? t : '';
    if (ts.length >= 10 && validDate(ts.slice(0, 10))) ts = ts.length === 10 ? '00:00' : ts[10] === 'T' || ts[10] === ' ' ? ts.slice(11) : '';
    const two = (at        , hi        ) => { const x = ts.slice(at, at + 2); if (!/^\d\d$/.test(x)) return -1; return +x > hi ? -1 : +x; };
    const hh = two(0, 23), mm = ts.length > 2 && ts[2] === ':' ? two(3, 59) : -1;
    let ss = 0, rest = 5;
    if (ts.length > 5 && ts[5] === ':') { ss = two(6, 59); rest = 8; }
    if (hh < 0 || mm < 0 || ss < 0 || (ts.length > rest && !'.Z+-'.includes(ts[rest]))) throw evalErr('datetime: цаг (HH:MM[:SS]) хүлээгдэж байна');
    const p2 = (x        ) => String(x).padStart(2, '0');
    return `${ds.slice(0, 10)}T${p2(hh)}:${p2(mm)}:${p2(ss)}`;
  }
  if (f === 'regexp' || f === 'matches') { // T3b WP-L (N-03, Тоду integration G-04)
    const x = arg(0), pv = arg(1);
    if (typeof pv !== 'string') throw evalErr(`${f}: загвар (текст) хүлээгдэж байна`);
    const c = reCanonical(pv);
    if (typeof c === 'string') throw evalErr(c);
    let g = 0;
    if (n.kids.length > 2) {
      const gv = numericLike(arg(2));
      if (gv === undefined || Math.floor(gv) !== gv || gv < 0 || gv > c.groups) throw evalErr(`regexp: бүлэг 0…${c.groups} бүхэл тоо`);
      g = gv;
    }
    if (x === null) return f === 'matches' ? false : null;
    const xs = requireScalarText(x);
    if (xs.length > 100000) throw evalErr(`${f}: текст хэт урт`);
    const m = reFind(xs, c, g);
    return f === 'matches' ? m !== null : m;
  }
  if (f === 'hours') { // P7.8 M4: хоёр огноо/цагийн хоорондох цаг (сервертэй ижил)
    const a = arg(0), b = arg(1);
    if (a === null || b === null) return null;
    // P-WP-21: C++ isoSeconds-тэй ижил (өмнө нь Date.parse — бүсгүй утга хөтчийн бүсээр)
    const ta = typeof a === 'string' ? isoSeconds(a) : undefined, tb = typeof b === 'string' ? isoSeconds(b) : undefined;
    if (ta === undefined || tb === undefined) throw evalErr('hours: огноо/цаг (YYYY-MM-DDTHH:MM) хүлээгдэж байна');
    return (tb - ta) / 3600;
  }
  if (f === 'coalesce') {
    for (let i = 0; i < n.kids.length; i++) {
      const v = arg(i);
      if (v !== null) return v;
    }
    return null;
  }
  if (f === 'len') {
    const v = arg(0);
    if (v === null) return 0;
    if (typeof v === 'string') return Array.from(v).length;
    if (Array.isArray(v)) return v.length;
    throw evalErr('len: текст эсвэл массив хүлээгдэж байна');
  }
  if (f === 'lower' || f === 'upper') {
    const v = arg(0);
    if (v === null) return null;
    if (typeof v !== 'string') throw evalErr(`${f}: текст хүлээгдэж байна`);
    return Array.from(v)
      .map((ch) => String.fromCodePoint((f === 'lower' ? lowerCp : upperCp)(ch.codePointAt(0) )))
      .join('');
  }
  if (f === 'contains' || f === 'startsWith' || f === 'endsWith') {
    const a = arg(0);
    const b = arg(1);
    if (a === null) return false;
    const s = requireScalarText(a);
    const sub = requireScalarText(b);
    if (f === 'contains') return s.includes(sub);
    if (f === 'startsWith') return s.startsWith(sub);
    return s.endsWith(sub);
  }
  if (f === 'between') {
    const x = arg(0);
    const lo = arg(1);
    const hi = arg(2);
    const c1 = compareOrd(x, lo);
    const c2 = compareOrd(x, hi);
    return c1 !== undefined && c2 !== undefined && c1 >= 0 && c2 <= 0;
  }
  if (f === 'empty') {
    const v = arg(0);
    if (v === null) return true;
    if (typeof v === 'string') return v.length === 0;
    if (Array.isArray(v)) return v.length === 0;
    if (isObj(v)) return Object.keys(v).length === 0;
    return false;
  }
  if (f === 'power') {
    const a = arg(0), b = arg(1);
    if (a === null || b === null) return null;
    const x = numericLike(a), y = numericLike(b);
    if (x === undefined || y === undefined) throw evalErr('power: тоо хүлээгдэж байна');
    const r = Math.pow(x, y);
    if (!Number.isFinite(r)) throw evalErr('power: үр дүн тодорхойгүй');
    return r;
  }
  if (f === 'round') {
    const v = arg(0);
    if (v === null) return null;
    const d = numericLike(v);
    if (d === undefined) throw evalErr('round: тоо хүлээгдэж байна');
    let scale = 0;
    if (n.kids.length > 1) {
      const sd = numericLike(arg(1));
      if (sd === undefined || sd < -10 || sd > 10 || Math.floor(sd) !== sd) throw evalErr('round: орон −10…10 бүхэл тоо');
      scale = sd;
    }
    let mode = 'half-up';
    if (n.kids.length > 2) {
      const mv = arg(2);
      mode = typeof mv === 'string' ? mv : '';
      if (!['half-up', 'half-even', 'floor', 'ceil', 'down', 'up'].includes(mode)) throw evalErr('round: горим буруу (half-up | half-even | floor | ceil | down | up)');
    }
    const p = Math.pow(10, scale), x = d * p, eps = 1e-9; // хоёртын бутархайн алдааг нөхнө
    const ax = Math.abs(x), sg = x < 0 ? -1 : 1;
    let r        ;
    if (mode === 'floor') r = Math.floor(x + eps);
    else if (mode === 'ceil') r = Math.ceil(x - eps);
    else if (mode === 'down') r = sg * Math.floor(ax + eps);
    else if (mode === 'up') r = sg * Math.ceil(ax - eps);
    else if (mode === 'half-even') {
      const fl = Math.floor(ax + eps), fr = ax - fl;
      r = sg * (Math.abs(fr - 0.5) < eps ? (fl % 2 === 0 ? fl : fl + 1) : Math.round(ax));
    } else r = sg * Math.floor(ax + 0.5 + eps);
    r /= p;
    return r === 0 ? 0 : r;
  }
  if (f === 'distance') { // T3 WP-F G-T3-15: метр (0.01); буруу/хоосон цэг → null
    const a = arg(0), b = arg(1);
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    return geoDistance(a, b);
  }
  if (f === 'inside') { // T3 WP-F G-T3-14: GeoJSON полигон; буруу/хоосон → false
    const a = arg(0), b = arg(1);
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    return geoInside(a, b);
  }
  if (f === 'abs') {
    const v = arg(0);
    if (v === null) return null;
    const d = numericLike(v);
    if (d === undefined) throw evalErr('abs: тоо хүлээгдэж байна');
    return Math.abs(d);
  }
  if (f === 'min' || f === 'max') {
    let anyNull = false;
    let best                    ;
    for (let i = 0; i < n.kids.length; i++) {
      const v = arg(i);
      if (v === null) {
        anyNull = true;
        continue;
      }
      const d = numericLike(v);
      if (d === undefined) throw evalErr(`${f}: тоо хүлээгдэж байна`);
      if (best === undefined || (f === 'min' ? d < best : d > best)) best = d;
    }
    if (anyNull || best === undefined) return null;
    return best;
  }
  if (f === 'number') {
    const d = numericLike(arg(0));
    return d === undefined ? null : d;
  }
  if (f === 'text') {
    if (n.kids.length < 2) return requireScalarText(arg(0));
    // WP-B G-T3-09: text(x, '0.00' | '#,##0.00' | '0') — Expr.cpp-тэй ижил (half-up, тэгээс холдуулж); null → ""
    const v = arg(0), fv = arg(1);
    const fmt = typeof fv === 'string' ? fv : '';
    if (!/^(#,##)?0(\.0{1,10})?$/.test(fmt)) throw evalErr("text: загвар буруу ('0', '0.00', '#,##0.00')");
    if (v === null) return '';
    const d = numericLike(v);
    if (d === undefined) throw evalErr('text: тоо хүлээгдэж байна');
    const dot = fmt.indexOf('.');
    const scale = dot < 0 ? 0 : fmt.length - dot - 1;
    const x = d * Math.pow(10, scale), r = Math.floor(Math.abs(x) + 0.5 + Math.max(1e-9, Math.abs(x) * 1e-12));
    if (r >= 9e15) throw evalErr('text: тоо хэт их');
    let digits = String(r);
    if (digits.length <= scale) digits = '0'.repeat(scale + 1 - digits.length) + digits;
    let ip = digits.slice(0, digits.length - scale);
    const fp = digits.slice(digits.length - scale);
    if (fmt[0] === '#') ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (x < 0 && r !== 0 ? '-' : '') + ip + (scale > 0 ? '.' + fp : '');
  }
  if (f === 'concat') {
    let out = '';
    for (let i = 0; i < n.kids.length; i++) out += requireScalarText(arg(i));
    return out;
  }
  if (f === 'date') {
    const v = arg(0);
    if (v === null) return null;
    if (typeof v !== 'string' || !validDate(v)) throw evalErr('date: YYYY-MM-DD хүлээгдэж байна');
    return v;
  }
  if (f === 'changed') {
    const col = arg(0);
    if (typeof col !== 'string') throw evalErr('changed: баганын нэр (текст) хүлээгдэж байна');
    // T4: үүсгэлт (insert) — old байхгүй/null бол хоосон мөр (= `new.<Багана>` ≠ null); BPMN startWhen «регистр бөглөгдөхөд» шинэ бичлэгт ч ажиллана
    if (!isObj(ctx) || !hasOwn(ctx, 'new') || !isObj(ctx.new) || (hasOwn(ctx, 'old') && ctx.old !== null && !isObj(ctx.old))) return false;
    const old = isObj(ctx.old) ? ctx.old : {};
    const a = hasOwn(old, col) ? old[col] : null;
    const b = hasOwn(ctx.new, col) ? ctx.new[col] : null;
    return !looseEq(a, b);
  }
  throw evalErr(`тодорхойгүй функц: ${f}`);
}

function evalNode(n      , ctx      )       {
  switch (n.kind) {
    case 'lit':
      return n.lit;
    case 'path':
      return resolvePath(n, ctx);
    case 'list':
      return n.kids.map((k) => evalNode(k, ctx));
    case 'neg': {
      const v = evalNode(n.kids[0], ctx);
      if (v === null) return null;
      const d = numericLike(v);
      if (d === undefined) throw evalErr('тоон биш утгатай сөрөг');
      return -d === 0 ? 0 : -d;
    }
    case 'not':
      return !toBool(evalNode(n.kids[0], ctx));
    case 'isnull': {
      const isNull = evalNode(n.kids[0], ctx) === null;
      return n.negate ? !isNull : isNull;
    }
    case 'in': {
      const x = evalNode(n.kids[0], ctx);
      const list = evalNode(n.kids[1], ctx);
      if (list === null) return false;
      if (!Array.isArray(list)) throw evalErr("'in' баруун тал массив байх ёстой");
      for (const e of list) {
        if (looseEq(x, e)) return true;
      }
      return false;
    }
    case 'call':
      if (n.op.startsWith('coll:')) { // M4c: коллекцийн арга
        const fn = n.op.slice(5);
        const coll = evalNode(n.kids[0], ctx);
        if (coll === null) return fn === 'all' ? true : fn === 'any' ? false : 0;
        if (!Array.isArray(coll)) throw evalErr(`'${fn}()' массив дээр л ажиллана`);
        if (n.kids.length < 2) return coll.length;
        let cnt = 0, sum = 0;
        for (const item of coll) {
          const ictx                       = ctx !== null && typeof ctx === 'object' && !Array.isArray(ctx) ? { ...(ctx                        ) } : {};
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) Object.assign(ictx, item                        );
          ictx.row = item; ictx.it = item;
          const v = evalNode(n.kids[1], ictx);
          if (fn === 'all') { if (!toBool(v)) return false; }
          else if (fn === 'any') { if (toBool(v)) return true; }
          else if (fn === 'count') { if (toBool(v)) cnt++; }
          else { const d = numericLike(v); if (d !== undefined) sum += d; }
        }
        if (fn === 'all') return true;
        if (fn === 'any') return false;
        if (fn === 'count') return cnt;
        return sum;
      }
      return callFn(n, ctx);
    case 'bin': {
      const op = n.op;
      if (op === 'and') {
        if (!toBool(evalNode(n.kids[0], ctx))) return false;
        return toBool(evalNode(n.kids[1], ctx));
      }
      if (op === 'or') {
        if (toBool(evalNode(n.kids[0], ctx))) return true;
        return toBool(evalNode(n.kids[1], ctx));
      }
      const a = evalNode(n.kids[0], ctx);
      const b = evalNode(n.kids[1], ctx);
      if (op === '==') return looseEq(a, b);
      if (op === '!=') return !looseEq(a, b);
      if (op === '<' || op === '<=' || op === '>' || op === '>=') {
        const c = compareOrd(a, b);
        if (c === undefined) return false;
        if (op === '<') return c < 0;
        if (op === '<=') return c <= 0;
        if (op === '>') return c > 0;
        return c >= 0;
      }
      return arith(op, a, b);
    }
  }
}

function normalize(v      )       {
  if (typeof v === 'number') return v === 0 ? 0 : v;
  if (Array.isArray(v)) return v.map(normalize);
  if (isObj(v)) {
    const out                          = {};
    for (const k of Object.keys(v)) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}

export function evaluate(expression        , context      )             {
  try {
    const src = Array.from(expression);
    if (src.length > MAX_LENGTH) throw parseErr('илэрхийлэл хэт урт', MAX_LENGTH);
    const ast = new Parser(lex(src)).parse();
    return { ok: true, value: normalize(evalNode(ast, context)) };
  } catch (e) {
    const err = e                      ;
    if (err && err.tag === 'parse') return { ok: false, errorKind: 'parse', error: err.msg, errorPos: err.pos };
    if (err && err.tag === 'eval') return { ok: false, errorKind: 'eval', error: err.msg, errorPos: -1 };
    return { ok: false, errorKind: 'eval', error: e instanceof Error ? e.message : String(e), errorPos: -1 };
  }
}

// T3b WP-K: илэрхийлэлд зөвхөн серверт үнэлэгдэх функц (under/root/depth) байгаа эсэх — клиент «мэдэгдэхгүй» гэж үзнэ (товч/талбарыг
// нуухгүй, сервер шийднэ; decision.*-тэй ижил). Литерал доторхыг тооцохгүй.
export function serverOnly(expression        )          {
  const bare = expression.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return /(^|[^.\w])(under|root|depth|hmac|digest)\s*\(/.test(bare) || /(^|[^.\w])decision\./.test(bare);
}

// Нөхцөл: bool бол тэр; алдаа/bool биш бол false.
export function evaluateBool(expression        , context      )          {
  const r = evaluate(expression, context);
  return r.ok && r.value === true;
}
