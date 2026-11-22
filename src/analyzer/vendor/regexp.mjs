// web/src/lib/regexp.ts-ийн хуулбар (төрөл хассан) — гараар засахгүй: npm run sync-validator
// T3b WP-L (N-03; Тоду integration G-04) — `regexp()` / `matches()`-ийн каноник загвар: cgi/src/expr/Regexp.h-тэй ЯГ ИЖИЛ дүрэм
// (ECMAScript ∩ PostgreSQL ARE; \d \w \s — ASCII, `.` — мөр шилжилт биш, lookaround/backreference/lazy — алдаа). vectors.json хоёр тал.
                                                          

const SYNTAX = '.^$|?*+()[]{}\\/-';
const isAlnum = (ch        ) => /^[0-9A-Za-z]$/.test(ch);

export function canonical(src        )                 {
  const p = Array.from(src); // code point
  if (p.length === 0) return 'regexp: хоосон загвар';
  if (p.length > 500) return 'regexp: загвар хэт урт (≤ 500)';
  let o = '', groups = 0, depth = 0, atom = false, quant = false;
  const fail = (m        ) => `regexp: ${m}`;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\') {
      if (i + 1 >= p.length) return fail('төгсгөлийн \\');
      const e = p[++i];
      if (e === 'd') o += '[0-9]';
      else if (e === 'D') o += '[^0-9]';
      else if (e === 'w') o += '[A-Za-z0-9_]';
      else if (e === 'W') o += '[^A-Za-z0-9_]';
      else if (e === 's') o += '[ \\t\\n\\r\\f\\v]';
      else if (e === 'S') o += '[^ \\t\\n\\r\\f\\v]';
      else if ('ntrfv'.includes(e)) o += `\\${e}`;
      else if (e === '/' || e === '-') o += e;
      else if (SYNTAX.includes(e)) o += `\\${e}`;
      else if (isAlnum(e)) return fail(`\\${e} дэмжигдэхгүй`);
      else return fail('escape буруу');
      atom = true; quant = false;
      continue;
    }
    if (ch === '[') {
      o += '[';
      let j = i + 1;
      if (j < p.length && p[j] === '^') { o += '^'; j++; }
      let any = false, closed = false;
      for (; j < p.length; j++) {
        const k = p[j];
        if (k === ']' && any) { closed = true; break; }
        if (k === '\\') {
          if (j + 1 >= p.length) return fail('төгсгөлийн \\');
          const e = p[++j];
          if (e === 'd') o += '0-9';
          else if (e === 'w') o += 'A-Za-z0-9_';
          else if (e === 's') o += ' \\t\\n\\r\\f\\v';
          else if ('ntrfv'.includes(e)) o += `\\${e}`;
          else if (SYNTAX.includes(e)) o += `\\${e}`;
          else if (isAlnum(e)) return fail(`класс дотор \\${e} дэмжигдэхгүй`);
          else o += e;
        } else if (k === '[' || k === ']' || k === '\\' || k === '^') o += `\\${k}`;
        else o += k;
        any = true;
      }
      if (!closed) return fail('[ … ] хаагдаагүй (эсвэл хоосон)');
      o += ']';
      i = j;
      atom = true; quant = false;
      continue;
    }
    if (ch === '(') {
      if (p[i + 1] === '?') {
        if (p[i + 2] === ':') { o += '(?:'; i += 2; } else return fail('(?…) — зөвхөн (?:…) дэмжигдэнэ');
      } else { o += '('; groups++; }
      depth++;
      atom = false; quant = false;
      continue;
    }
    if (ch === ')') {
      if (depth === 0) return fail(') илүү');
      if (o.endsWith('(') || o.endsWith('|') || o.endsWith('(?:')) return fail('хоосон бүлэг/сонголт');
      depth--;
      o += ')';
      atom = true; quant = false;
      continue;
    }
    if (ch === '|') { o += '|'; atom = false; quant = false; continue; }
    if (ch === '^' || ch === '$') { o += ch; atom = false; quant = false; continue; }
    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      if (quant) return fail('lazy/давхар quantifier дэмжигдэхгүй');
      if (!atom) return fail('quantifier-ийн өмнө тэмдэгт алга');
      if (ch === '{') {
        let j = i + 1, a = '', b = '', comma = false;
        for (; j < p.length && p[j] !== '}'; j++) {
          if (p[j] === ',' && !comma) { comma = true; continue; }
          if (p[j] < '0' || p[j] > '9') return fail('{n,m} буруу');
          if (comma) b += p[j]; else a += p[j];
        }
        if (j >= p.length || !a || a.length > 3 || b.length > 3) return fail('{n,m} буруу');
        const na = Number(a), nb = b ? Number(b) : -1;
        if (na > 255 || nb > 255 || (nb >= 0 && nb < na)) return fail('{n,m} — 0 ≤ n ≤ m ≤ 255');
        o += `{${a}${comma ? `,${b}` : ''}}`;
        i = j;
      } else o += ch;
      quant = true; atom = false;
      continue;
    }
    if (ch === '}' || ch === ']') { o += `\\${ch}`; atom = true; quant = false; continue; }
    if (ch === '.') { o += '[^\\n\\r]'; atom = true; quant = false; continue; }
    o += ch;
    atom = true; quant = false;
  }
  if (depth !== 0) return fail('( хаагдаагүй');
  return { pattern: o, groups };
}

// Эхний таарал: бүлэг g (0 = бүтэн); таараагүй/бүлэг оролцоогүй → null
export function find(text        , c       , g        )                {
  const m = new RegExp(c.pattern, 'u').exec(text);
  if (!m) return null;
  return m[g] ?? null;
}
