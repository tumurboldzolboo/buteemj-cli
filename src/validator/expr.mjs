// Илэрхийллийн шалгагч (X0, тооцооны хэл, тайлангийн шүүлт). Сервер илэрхийллийг нэрээр орчуулаад ажиллуулах/SQL болгох үед л алддаг —
// энд урьдчилан: (1) хашилт, хаалтын тэнцвэр; (2) функцийн нэр тухайн хэлний каталогт байгаа эсэх; (3) нэр (багана, хүснэгт, FK зам,
// төлөв, тооцооны зангилаа …) багцад байгаа эсэх. Нэр зайтай байж болох тул эхлээд мэдэгдэж буй нэрсийг (урт нь эхэлж) орлуулна.

const LETTER = /[\p{L}\p{N}_]/u;

// `'…'` / `"…"` мөрийг `§s` болгоно; хаагдаагүй бол error
function stripStrings(src) {
  let out = '', q = null, err = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) { q = null; out += ' §s '; } continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    out += c;
  }
  if (q) err = `хашилт ${q} хаагдаагүй`;
  return { text: out, err };
}

export function balance(text) {
  const st = [];
  const pair = { ')': '(', ']': '[', '}': '{' };
  for (const c of text) {
    if ('([{'.includes(c)) st.push(c);
    else if (')]}'.includes(c)) { if (st.pop() !== pair[c]) return `«${c}» хаалт тэнцвэргүй`; }
  }
  return st.length ? `«${st[st.length - 1]}» хаалт хаагдаагүй` : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// names: мэдэгдэж буй нэрсийн Set (зайтай байж болно). Урт нэр эхэлж орлогдоно; нэрийн хил — үсэг/тоо биш тэмдэгт.
export function makeNameMatcher(names) {
  const list = [...new Set([...names].filter((n) => n && n.trim()))].sort((a, b) => b.length - a.length);
  // хэт урт regex-ээс зайлсхийж 300-аар багцална
  const chunks = [];
  for (let i = 0; i < list.length; i += 300) chunks.push(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.slice(i, i + 300).map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'gu'));
  return (text) => { let t = text; for (const re of chunks) t = t.replace(re, ' §n '); return t; };
}

// → {errors: [string], functions: [name], unknownNames: [string]}
// opts: {functions: Set, keywords: Set, prefixes: [string] (жишээ 'record.', 'param.'), matcher, allowBareUnknown: bool}
export function checkExpr(src, opts) {
  const errors = [];
  const s = stripStrings(String(src ?? ''));
  if (s.err) errors.push(s.err);
  const b = balance(s.text);
  if (b) errors.push(b);
  let t = s.text;
  // угтвартай нэр (`param.Огноо`, `record.Х`, `user.Ээлж`) — угтварын дараах нэрийг шалгахгүй (хүрээ нь ажиллах үед)
  for (const p of opts.prefixes ?? []) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}_.])${escapeRe(p)}[\\p{L}\\p{N}_ ]*?(?=$|[^\\p{L}\\p{N}_ ]|\\s(?:and|or|not|in|==|!=|<|>|\\+|-|\\*|/)\\s)`, 'gu'), ' §p ');
  t = opts.matcher ? opts.matcher(t) : t;
  const functions = [];
  const unknownNames = [];
  // функцийн дуудлага: <нэр>(
  t = t.replace(/([\p{L}_][\p{L}\p{N}_]*)\s*\(/gu, (m, name) => {
    functions.push(name);
    if (!opts.functions.has(name) && !opts.functions.has(name.toLowerCase())) errors.push(`«${name}(…)» функц энэ хэлэнд алга`);
    return ' ( ';
  });
  if (opts.checkNames) {
    // үлдсэн үгс: түлхүүр үг, тоо, мэдэгдэж буй нэр биш бол — танигдахгүй нэр
    const words = t.split(/[^\p{L}\p{N}_.§]+/u).filter(Boolean);
    let run = [];
    const flush = () => { if (run.length) { unknownNames.push(run.join(' ')); run = []; } };
    for (const w of t.split(/(\s+|[^\p{L}\p{N}_.§\s]+)/u)) {
      if (!w || /^\s+$/.test(w)) continue;
      if (!LETTER.test(w) || w.includes('§') || /^-?\d+(\.\d+)?$/.test(w) || opts.keywords.has(w) || opts.keywords.has(w.toLowerCase())) { flush(); continue; }
      run.push(w);
    }
    flush();
    void words;
  }
  return { errors, functions, unknownNames: [...new Set(unknownNames)] };
}
