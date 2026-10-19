// DBML задлагч — серверийн `cgi/src/erd/Dbml.cpp`-ийн JS хуулбар (ижил токен, ижил төрөл). Сервер «алгасав / текст болгов» гэж чимээгүй
// доройтуулдаг бүх газрыг энд `issues` болгож буцаана — баталгаажуулагч тэдгээрийг алдаа болгоно (bj validate).

function lex(s) {
  const out = [];
  let line = 1, i = 0, ws = false;
  const isIdent = (c) => /[A-Za-z0-9_]/.test(c) || c.charCodeAt(0) >= 0x80;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; i++; ws = true; continue; }
    if (/\s/.test(c)) { i++; ws = true; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; ws = true; continue; }
    if (c === '/' && s[i + 1] === '*') { ws = true; i += 2; while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) { if (s[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let v = ''; const l0 = line; i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < s.length) { v += s[i + 1]; i += 2; continue; }
        if (q === "'" && s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2; continue; }
        if (s[i] === '\n') line++;
        v += s[i++];
      }
      if (i >= s.length) return { error: `мөр хаагдаагүй (${l0}-р мөр)`, line: l0 };
      i++;
      out.push({ kind: 'Str', text: v, line: l0, spaced: ws, quote: q }); ws = false;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ kind: 'Num', text: s.slice(i, j), line, spaced: ws }); ws = false; i = j; continue;
    }
    if (isIdent(c)) {
      let j = i;
      while (j < s.length && isIdent(s[j])) j++;
      out.push({ kind: 'Ident', text: s.slice(i, j), line, spaced: ws }); ws = false; i = j; continue;
    }
    out.push({ kind: 'Sym', text: c, line, spaced: ws }); ws = false; i++;
  }
  out.push({ kind: 'End', text: '', line });
  return { tokens: out };
}

export function mapType(raw, args) {
  const t = raw.toLowerCase();
  if (['text', 'varchar', 'string', 'char', 'character'].includes(t)) {
    if (!args || t === 'string') return t === 'text' && !args ? 'longtext' : 'text';
    const n = parseInt(args, 10);
    return n > 200 ? 'longtext' : 'text';
  }
  if (['longtext', 'mediumtext'].includes(t)) return 'longtext';
  if (['file', 'attachment', 'blob', 'binary'].includes(t)) return 'file';
  if (['int', 'integer', 'bigint', 'smallint', 'long'].includes(t)) return 'integer';
  if (['decimal', 'numeric', 'float', 'double', 'money', 'real'].includes(t)) return 'decimal';
  if (['bool', 'boolean', 'bit'].includes(t)) return 'boolean';
  if (t === 'date') return 'date';
  if (['datetime', 'timestamp', 'timestamptz', 'time'].includes(t)) return 'datetime';
  if (t === 'enum') return 'enum';
  return '';
}

// → {tables: [{name, alias, line, note, noteLine, orgScoped, columns: [{name, line, rawType, args, type, enumValues, required, unique, pk, default,
//     note, ref: {table, column, kind}, tags: [{tag, value}]}], uniques: [[..]]}], issues: [{severity, code, line, message}], error}
export function parseDbml(text) {
  const issues = [];
  const add = (severity, code, line, message) => issues.push({ severity, code, line, message });
  const lx = lex(text);
  if (lx.error) return { tables: [], issues, error: lx.error, errorLine: lx.line };
  const t = lx.tokens;
  let p = 0;
  const cur = () => t[p];
  const is = (k, txt) => cur().kind === k && (txt === undefined || cur().text === txt);
  const isCI = (txt) => cur().kind === 'Ident' && cur().text.toLowerCase() === txt;
  const next = () => t[p++];
  const accept = (k, txt) => { if (is(k, txt)) { p++; return true; } return false; };
  const skipBlock = () => {
    if (!accept('Sym', '{')) return;
    let depth = 1;
    while (!is('End') && depth > 0) { if (is('Sym', '{')) depth++; else if (is('Sym', '}')) depth--; p++; }
  };
  const readName = () => (is('Ident') || is('Str') ? next().text : null);
  const readRef = () => {
    let kind = '';
    while (is('Sym') && ['>', '<', '-'].includes(cur().text)) kind += next().text;
    const table = readName();
    if (table === null) return null;
    let column = '';
    if (accept('Sym', '.')) column = readName() ?? '';
    return { table, column, kind };
  };
  const tables = [];
  const refs = [];
  let error = null, errorLine = 0;
  const fail = (msg, line) => { error = msg; errorLine = line; };

  outer: while (!is('End')) {
    if (isCI('project') || isCI('enum') || isCI('tablegroup')) {
      const kw = next().text; readName();
      if (kw.toLowerCase() !== 'project') add('error', 'dbml_unsupported', cur().line, `«${kw}» блок дэмжигдэхгүй — сервер алгасна (enum-ийг баганад \`enum(a,b)\`-ээр)`);
      skipBlock(); continue;
    }
    if (isCI('note')) { next(); if (accept('Sym', ':')) { if (is('Str')) next(); } else skipBlock(); continue; }
    if (isCI('ref')) {
      const line = next().line;
      if ((is('Ident') || is('Str')) && !is('Sym', ':')) readName();
      if (accept('Sym', ':')) {
        const a = readName(); let ac = '';
        if (accept('Sym', '.')) ac = readName() ?? '';
        const r = readRef();
        refs.push({ a, ac, r, line });
      } else { add('error', 'dbml_unsupported', line, 'Ref { … } блок дэмжигдэхгүй — `Ref: "A"."b" > "B".id` эсвэл баганын `ref:`'); skipBlock(); }
      continue;
    }
    if (isCI('table')) {
      next();
      const line = cur().line;
      const tb = { name: readName(), alias: '', line, note: '', noteLine: 0, columns: [], uniques: [] };
      if (tb.name === null) { fail(`Table-ийн нэр алга`, line); break; }
      if (isCI('as')) { next(); tb.alias = readName() ?? ''; }
      if (accept('Sym', '[')) {
        const l = cur().line;
        while (!is('End') && !accept('Sym', ']')) next();
        add('warning', 'dbml_table_settings', l, `«${tb.name}»: хүснэгтийн [тохиргоо] (headercolor г.м.) хэрэгжихгүй — алгасна`);
      }
      if (!accept('Sym', '{')) { fail(`Table '${tb.name}': { хүлээж байсан`, cur().line); break; }
      while (!is('End') && !is('Sym', '}')) {
        if (isCI('note')) {
          const nl = next().line;
          if (accept('Sym', ':')) { if (is('Str')) { tb.note = next().text; tb.noteLine = nl; } }
          else if (accept('Sym', '{')) { if (is('Str')) { tb.note = next().text; tb.noteLine = nl; } while (!is('End') && !accept('Sym', '}')) next(); }
          continue;
        }
        if (isCI('indexes')) {
          next();
          if (!accept('Sym', '{')) continue;
          while (!is('End') && !accept('Sym', '}')) {
            const l = cur().line;
            const names = [];
            if (accept('Sym', '(')) {
              while (!is('End') && !accept('Sym', ')')) { const nm = readName(); if (nm !== null) names.push(nm); else next(); accept('Sym', ','); }
            } else { const nm = readName(); if (nm !== null) names.push(nm); else { next(); continue; } }
            let unique = false;
            if (accept('Sym', '[')) { while (!is('End') && !accept('Sym', ']')) { if (isCI('unique') || isCI('pk')) unique = true; next(); } }
            if (!unique || !names.length) { add('warning', 'dbml_index_ignored', l, `«${tb.name}»: unique биш index — платформ index-ийг өөрөө шийднэ, алгасна`); continue; }
            tb.uniques.push({ names, line: l });
          }
          continue;
        }
        const cl = cur().line;
        const name = readName();
        if (name === null) { fail(`Table '${tb.name}': баганын нэр хүлээж байсан`, cl); break outer; }
        if (!is('Ident')) { fail(`'${tb.name}.${name}': төрөл алга`, cl); break outer; }
        const c = { name, line: cl, rawType: next().text, args: '', required: false, unique: false, pk: false, default: null, note: '', ref: null, tags: [] };
        if (accept('Sym', '(')) {
          let a = '';
          while (!is('End') && !is('Sym', ')')) {
            if (a && !a.endsWith(',') && cur().spaced) a += ' ';
            a += next().text;
            if (is('Sym', ',')) { a += ','; next(); }
          }
          accept('Sym', ')');
          c.args = a;
        }
        if (accept('Sym', '[')) {
          while (!is('End') && !is('Sym', ']')) {
            if (isCI('pk') || isCI('primary')) { next(); if (isCI('key')) next(); c.pk = true; }
            else if (isCI('not')) { next(); if (isCI('null')) next(); c.required = true; }
            else if (isCI('null')) next();
            else if (isCI('unique')) { next(); c.unique = true; }
            else if (isCI('increment')) next();
            else if (isCI('default')) { next(); accept('Sym', ':'); if (is('Str') || is('Num') || is('Ident')) { const d = next(); c.default = { text: d.text, kind: d.kind, quote: d.quote }; } }
            else if (isCI('note')) { next(); accept('Sym', ':'); if (is('Str')) c.note = next().text; }
            else if (isCI('ref')) { next(); accept('Sym', ':'); c.ref = readRef(); }
            else { const x = next(); if (!(x.kind === 'Sym' && x.text === ',')) add('error', 'dbml_column_setting', x.line, `«${tb.name}.${name}»: баганын тохиргоо «${x.text}» танигдахгүй — сервер чимээгүй алгасна (pk, not null, null, unique, increment, default, note, ref)`); }
            accept('Sym', ',');
          }
          accept('Sym', ']');
        }
        tb.columns.push(c);
      }
      accept('Sym', '}');
      tables.push(tb);
      continue;
    }
    add('error', 'dbml_unknown_token', cur().line, `танигдахгүй «${cur().text}» — сервер алгасна`);
    next();
  }
  if (error) return { tables, issues, error, errorLine };

  for (const r of refs) {
    const tb = tables.find((x) => x.name === r.a || x.alias === r.a);
    const c = tb?.columns.find((x) => x.name === r.ac);
    if (c && r.r) c.ref = r.r;
    else add('error', 'dbml_ref', r.line, `Ref: «${r.a}.${r.ac}» багана олдсонгүй`);
  }
  for (const tb of tables) {
    tb.orgScoped = !/orgscoped:\s*false/i.test(tb.note);
    for (const c of tb.columns) {
      c.type = mapType(c.rawType, c.args);
      if (c.type === 'enum') c.enumValues = c.args.split(',').map((s) => s.trim()).filter(Boolean);
      for (const part of (c.note ?? '').split(';')) {
        const s = part.trim();
        if (!s) continue;
        const i = s.indexOf(':');
        c.tags.push({ tag: (i < 0 ? s : s.slice(0, i)).trim().toLowerCase(), value: i < 0 ? '' : s.slice(i + 1).trim() });
      }
    }
  }
  return { tables, issues, error: null };
}
