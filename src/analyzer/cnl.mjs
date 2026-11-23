// PLAN15 D1/D2 — загварт хэл (EARS-MN): нэг мөрөнд нэг өгүүлбэр → баримт (IR). LLM-гүй, детерминист.
// Нэр (хүснэгт, үүрэг, төлөв, багана, товч) — багцын загвараас; монгол хэлний тийн ялгалын дагавартай (Захиалга → Захиалгыг, Ажилтан → Ажилтны),
// эсвэл «…» хашилтаар (олон үгтэй/шинэ нэр). Загвар (README «Загварт хэл»):
//   RIGHT   <Үүрэг> <Хүснэгт>-ийг харна|үүсгэнэ|засна|устгана[, …]          — эрх (roles.csv); «…-ийг устгахгүй|устгаж болохгүй» — хориг (-)
//   TRANS   [<Хүснэгт>] <Төлөв1> үед <Үүрэг>[, <Үүрэг>] «Товч»-оор <Төлөв2> болгоно — шилжилт (states.mmd)
//   REQUIRED <Хүснэгт>-ийн <Багана> заавал                                    — not null (erd.dbml)
//   UNIQUE  <Хүснэгт>-ийн <Багана> давтагдахгүй                              — unique (erd.dbml)
//   FINAL   [<Хүснэгт>] <Төлөв> эцсийн төлөв                                  — `<Төлөв> --> [*]`
//   COND    Хэрэв <нөхцөл>[ ба <нөхцөл>] бол <TRANS>                         — шилжилтийн guard (`Товч [guard]`); нөхцөл: `илэрхийлэл`,
//           <Багана> <утга>-аас их|бага|их буюу тэнцүү|…, <Багана> <утга>[ биш], <Багана> хоосон[ биш], тайлбар бичсэн, мөртэй
// Танигдахгүй мөр → unparsed (D3: асуулт). Гарчиг (#), хоосон, код, `>` ишлэл, `%%`/`<!--` тайлбарыг алгасна.
const str = (v) => String(v ?? '').trim();
const VOWELS = 'аэиоуөүыяеёю';
const SUFFIXES = ['ийг', 'ыг', 'г', 'ийн', 'ын', 'гийн', 'ний', 'н', 'ы', 'ий', 'ад', 'эд', 'од', 'өд', 'нд', 'д', 'т', 'аас', 'ээс', 'оос', 'өөс', 'гаас', 'гээс', 'наас', 'нээс',
  'аар', 'ээр', 'оор', 'өөр', 'гаар', 'гээр', 'ээр', 'руу', 'рүү', 'тай', 'тэй', 'той', 'ыхан', 'аа', 'ээ', 'оо', 'өө', ''];
const letter = /[\p{L}\p{N}_]/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// нэрийн боломжит үндэс: бүтэн; эцсийн эгшиггүй (Захиалга → Захиалг); эцсийн гийгүүлэгчийн өмнөх эгшиггүй (Ажилтан → Ажилтн)
export function stems(name) {
  const n = str(name), out = new Set([n]);
  const last = n.slice(-1).toLowerCase(), prev = n.slice(-2, -1).toLowerCase();
  if (VOWELS.includes(last) && n.length > 3) out.add(n.slice(0, -1));
  if (!VOWELS.includes(last) && VOWELS.includes(prev) && n.length > 4 && !VOWELS.includes(n.slice(-3, -2).toLowerCase())) out.add(n.slice(0, -2) + n.slice(-1));
  return [...out];
}

// vocab: [{kind, name, …}] → өгүүлбэр дэх нэрсийг ⟦i⟧ болгоно; found[i] = {name, alts: [ижил нэртэй бүх толь]} — загвар өөрийн хүрээнд сонгоно
// (FK багана хүснэгттэйгээ ижил нэртэй, «Ноорог» олон машинд г.м.). Урт нэр эхэнд; «…» — шууд (толинд байхгүй бол quoted)
export function tag(sentence, vocab) {
  const byName = new Map();
  for (const v of vocab) byName.set(v.name, [...(byName.get(v.name) ?? []), v]);
  const found = [];
  let s = sentence.replace(/«([^»]+)»(?:-?[\p{L}]{0,5})?/gu, (m, inner) => {
    found.push({ name: inner.trim(), alts: byName.get(inner.trim()) ?? [], quoted: true });
    return ` ⟦${found.length - 1}⟧ `;
  });
  const cands = [...byName.keys()].flatMap((name) => stems(name).map((st) => ({ name, st }))).sort((x, y) => y.st.length - x.st.length);
  for (const { name, st } of cands) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_⟦])${esc(st)}(${SUFFIXES.filter(Boolean).map(esc).join('|')}|-(?:[\\p{L}]{1,5}))?(?![\\p{L}\\p{N}_])`, 'gu');
    s = s.replace(re, (m, suf) => {
      if (st !== name && !suf) return m; // богиносгосон үндэс дагавартай л
      found.push({ name, alts: byName.get(name) });
      return ` ⟦${found.length - 1}⟧ `;
    });
  }
  return { text: s.replace(/\s+/g, ' ').trim(), found };
}

const VERBS = [
  [/^(харна|үзнэ|хардаг)$/, 'view'], [/^(үүсгэнэ|бүртгэнэ|нэмнэ)$/, 'create'], [/^(засна|өөрчилнө|засварлана)$/, 'update'], [/^(устгана)$/, 'remove'],
];
const DENY = [[/^(харахгүй|харж болохгүй)$/, 'view'], [/^(үүсгэхгүй|үүсгэж болохгүй|бүртгэхгүй)$/, 'create'], [/^(засахгүй|засаж болохгүй|өөрчлөхгүй)$/, 'update'], [/^(устгахгүй|устгаж болохгүй)$/, 'remove']];

// нөхцөл (тэмдэглэсэн текст) → {guard: [илэрхийлэл], comment} | null. Багана нь шилжилтийн хүснэгтийнх; утга — тоо, багана эсвэл «текст»
const CMP = [[/^их буюу тэнцүү$|^багагүй$/, '>='], [/^бага буюу тэнцүү$|^ихгүй$/, '<='], [/^их$/, '>'], [/^бага$/, '<'], [/^тэнцүү биш$|^биш$/, '!='], [/^тэнцүү$|^$/, '==']];
function condition(t, table, { pick, quoted, nameOf, exprs }) {
  const col = (i) => pick(i, 'column', (a) => a.table === table);
  const val = (v) => {
    const n = /^(-?\d+(?:\.\d+)?)/.exec(v); if (n) return n[1];
    const k = /^⟦(\d+)⟧/.exec(v)?.[1]; if (k == null) return null;
    const c = col(k); if (c && !quoted(k)) return c.name;
    return `"${nameOf(k).replace(/"/g, '\\"')}"`;
  };
  const guard = []; let comment = false;
  for (const p0 of t.split(/\s*,\s*|\s+(?:ба|болон|мөн)\s+/)) {
    const p = str(p0); let x;
    if ((x = /^⟪(\d+)⟫$/.exec(p))) { guard.push(exprs[Number(x[1])]); continue; }
    if (/^(тайлбар (бичсэн|оруулсан)|тайлбартай)$/.test(p)) { comment = true; continue; }
    if (/^(мөртэй|мөр (байгаа|бий|заавал))$/.test(p)) { guard.push('мөр заавал'); continue; }
    if ((x = /^⟦(\d+)⟧ (хоосон биш|бөглөсөн|бөглөгдсөн|сонгосон|хоосон)$/.exec(p))) {
      const c = col(x[1]); if (!c) return null;
      guard.push(`${c.name} ${x[2] === 'хоосон' ? '==' : '!='} null`); continue;
    }
    if ((x = /^⟦(\d+)⟧ (-?\d+(?:\.\d+)?|⟦\d+⟧)(?:-?[\p{L}]{1,4})?(?: (.+))?$/u.exec(p))) {
      const c = col(x[1]); const v = val(x[2]); const op = CMP.find(([re]) => re.test(str(x[3])))?.[1];
      if (!c || v == null || !op) return null;
      if (/^"/.test(v) && !['==', '!='].includes(op)) return null;
      guard.push(`${c.name} ${op} ${v}`); continue;
    }
    return null;
  }
  return guard.length || comment ? { guard, comment } : null;
}

// guard → дээд түвшний «and» хэсгүүд (хаалт, хашилт доторхыг хуваахгүй), хэвийн
export function guardParts(g) {
  const out = []; let depth = 0, q = null, cur = '';
  const s = str(g);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'" || ch === '«') { q = ch === '«' ? '»' : ch; cur += ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (depth === 0 && /^\s+and\s+/i.test(s.slice(i)) && /\s/.test(ch)) { const mm = /^\s+and\s+/i.exec(s.slice(i)); out.push(cur); cur = ''; i += mm[0].length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(normGuard).filter(Boolean);
}
export const normGuard = (s) => str(s).replace(/\s+/g, ' ').replace(/\s*(==|!=|>=|<=|>|<)\s*/g, ' $1 ').replace(/^\((.*)\)$/, '$1').trim();
// шилжилтэд дутуу нөхцөлийн хэсгүүд (баримтын guard/comment) — [] бол бүгд бий
export function missingGuard(fact, t) {
  const have = new Set([...guardParts(t.guard), normGuard(t.guard)]);
  const miss = (fact.guard ?? []).filter((g) => !have.has(normGuard(g)));
  if (fact.comment && !t.requireComment) miss.unshift('тайлбар заавал');
  return miss;
}

// нэг өгүүлбэр → {facts: [...]} | null
export function parseSentence(sentence, vocab) {
  const raw0 = str(sentence).replace(/[.。]+$/, '').trim();
  if (!raw0) return null;
  const exprs = [];
  const raw = raw0.replace(/`([^`]+)`/g, (m, e) => { exprs.push(str(e)); return ` ⟪${exprs.length - 1}⟫ `; });
  const { text, found } = tag(raw, vocab);
  const pick = (i, kind, ok = () => true) => found[Number(i)]?.alts.find((a) => a.kind === kind && ok(a)) ?? null;
  const quoted = (i) => !!found[Number(i)]?.quoted;
  const nameOf = (i) => found[Number(i)]?.name;
  let m;
  // RIGHT: ⟦R⟧ ⟦T⟧ verb[, verb …]
  if ((m = /^⟦(\d+)⟧ ⟦(\d+)⟧ (.+)$/.exec(text))) {
    const role = pick(m[1], 'role'), table = pick(m[2], 'table');
    if (role && table) {
      const words = m[3].split(/\s*,\s*|\s+(?:ба|болон)\s+/).map(str).filter(Boolean);
      const facts = [];
      for (const w of words) {
        const v = VERBS.find(([re]) => re.test(w)), d = DENY.find(([re]) => re.test(w));
        if (!v && !d) { facts.length = 0; break; } // үйл үг биш — дараагийн загвар (жишээ: «Эмч»-ийн «Хэрэглэгч» заавал — үүрэг = хүснэгтийн нэр)
        facts.push({ kind: 'right', role: role.name, table: table.name, op: (v ?? d)[1], value: v ? '1' : '-' });
      }
      if (facts.length) return { facts };
    }
  }
  // TRANS: [⟦T⟧] ⟦S1⟧ үед ⟦R⟧[, ⟦R⟧] ⟦Товч⟧(товчоор)? ⟦S2⟧ болгоно
  const trans = (t) => {
    const x = /^(?:⟦(\d+)⟧ )?⟦(\d+)⟧ (?:төлөвтэй үед|төлөвт|үед) ((?:⟦\d+⟧(?: ?, ?| ба )?)+) ⟦(\d+)⟧ (?:товчоор )?⟦(\d+)⟧ (?:болгоно|руу шилжүүлнэ|шилжүүлнэ|төлөвт шилжүүлнэ)$/.exec(t);
    if (!x) return null;
    const table = x[1] ? pick(x[1], 'table') : null;
    if (x[1] && !table) return null;
    const s1 = pick(x[2], 'state', (a) => !table || a.table === table.name);
    const s2 = s1 && (pick(x[5], 'state', (a) => a.machine === s1.machine) ?? (quoted(x[5]) ? { name: nameOf(x[5]) } : null));
    const capt = pick(x[4], 'transition', (a) => !s1 || a.machine === s1.machine) ?? (quoted(x[4]) ? { name: nameOf(x[4]) } : null);
    const roles = [...x[3].matchAll(/⟦(\d+)⟧/g)].map((y) => pick(y[1], 'role') ?? (/^процесс$/i.test(nameOf(y[1]) ?? '') ? { name: 'процесс' } : null));
    if (!(s1 && s2 && capt && roles.length && roles.every(Boolean))) return null;
    return { kind: 'transition', machine: s1.machine, table: s1.table, from: s1.name, to: s2.name, caption: capt.name, who: roles.map((r) => r.name) };
  };
  { const f = trans(text); if (f) return { facts: [f] }; }
  // COND: Хэрэв <нөхцөл> бол <TRANS> → шилжилт + guard
  if ((m = /^[Хх]эрэв (.+?) бол (.+)$/.exec(text))) {
    const f = trans(m[2]);
    const c = f && condition(m[1], f.table, { pick, quoted, nameOf, exprs });
    if (c) return { facts: [{ ...f, ...(c.guard.length ? { guard: c.guard } : {}), ...(c.comment ? { comment: true } : {}) }] };
  }
  // REQUIRED / UNIQUE: ⟦T⟧ ⟦C⟧ заавал | давтагдахгүй
  if ((m = /^⟦(\d+)⟧ ⟦(\d+)⟧ (заавал(?: бөглөнө)?|давтагдахгүй|давхардахгүй)$/.exec(text))) {
    const table = pick(m[1], 'table'), col = table && pick(m[2], 'column', (a) => a.table === table.name);
    if (col) return { facts: [{ kind: /заавал/.test(m[3]) ? 'required' : 'unique', table: table.name, column: col.name }] };
  }
  // FINAL: [⟦T⟧] ⟦S⟧ (нь )?эцсийн төлөв
  if ((m = /^(?:⟦(\d+)⟧ )?⟦(\d+)⟧ (?:нь )?эцсийн төлөв$/.exec(text))) {
    const table = m[1] ? pick(m[1], 'table') : null;
    const st = (!m[1] || table) && pick(m[2], 'state', (a) => !table || a.table === table.name);
    if (st) return { facts: [{ kind: 'final', machine: st.machine, table: st.table, state: st.name }] };
  }
  return null;
}

// загвараас толь: хүснэгт, багана (хүснэгтээрээ), үүрэг, төлөв (машинаар), шилжилтийн товч
export function vocabulary(model) {
  const v = [];
  for (const [t, tb] of model.tables) { v.push({ kind: 'table', name: t }); for (const c of tb.columns) v.push({ kind: 'column', name: c.name, table: t }); }
  for (const r of new Set(model.roles.filter((x) => x.role && !x.role.startsWith('@')).map((x) => x.role))) v.push({ kind: 'role', name: r });
  for (const m of model.machines) {
    for (const s of m.states) v.push({ kind: 'state', name: s.name, machine: m.name, table: m.table });
    for (const t of m.transitions) if (!t.create) v.push({ kind: 'transition', name: t.caption, machine: m.name, table: m.table });
  }
  // ижил нэртэй олон төлөв/товч (өөр машинд) — бүгд үлдэнэ; загвар хүснэгтээр сонгоно (хүснэгтийг эхэнд бичвэл ялгагдана)
  const seen = new Set();
  return v.filter((x) => { const k = `${x.kind}\u0000${x.name}\u0000${x.table ?? ''}\u0000${x.machine ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// текст (brd.md) → {facts: [{…, line}], unparsed: [{line, text}]}
export function parseDocument(text, model) {
  const vocab = vocabulary(model);
  const facts = [], unparsed = [];
  let fence = false;
  String(text ?? '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (/^```/.test(line)) { fence = !fence; return; }
    if (fence || !line || /^(#|>|%%|<!--|\|)/.test(line)) return;
    const sentence = line.replace(/^([-*+]|\d+[.)])\s+/, '');
    const r = parseSentence(sentence, vocab);
    if (!r) { unparsed.push({ line: i + 1, text: sentence }); return; }
    for (const f of r.facts) facts.push({ ...f, line: i + 1 });
  });
  return { facts, unparsed };
}

// баримт ↔ загвар: present | missing (patch хийж болно) | conflict (загвар эсрэг)
export function compare(fact, model) {
  if (fact.kind === 'right') {
    const rows = model.roles.filter((r) => r.role.toLowerCase() === fact.role.toLowerCase() && (r.table === fact.table || r.table === '*') && !r.object);
    const raw = rows.map((r) => r.raw?.[fact.op]);
    if (fact.value === '1') return raw.includes('-') ? 'conflict' : rows.some((r) => r[fact.op]) ? 'present' : 'missing';
    // хориг: олгоогүй (0, «-», мөргүй) бол биелсэн; олгосон бол зөрчил
    return rows.some((r) => r[fact.op]) && !raw.includes('-') ? 'conflict' : 'present';
  }
  if (fact.kind === 'transition') {
    const m = model.machines.find((x) => x.name === fact.machine);
    if (!m) return 'missing';
    const t = m.transitions.find((x) => x.from === fact.from && x.caption === fact.caption);
    if (!t) return 'missing';
    if (t.to !== fact.to) return 'conflict';
    const who = str(t.who).split(',').map((x) => str(x).toLowerCase()).filter(Boolean);
    const st = fact.who.every((w) => who.includes(w.toLowerCase())) ? 'present' : who.length ? 'conflict' : 'missing';
    return st === 'present' && missingGuard(fact, t).length ? 'missing' : st;
  }
  if (fact.kind === 'required' || fact.kind === 'unique') {
    const c = model.tables.get(fact.table)?.columns.find((x) => x.name === fact.column);
    if (!c) return 'missing';
    const has = fact.kind === 'required' ? !!c.required : !!c.unique || (c.tags ?? []).some((g) => String(g.tag).toLowerCase() === 'unique');
    return has ? 'present' : 'missing';
  }
  if (fact.kind === 'final') {
    const m = model.machines.find((x) => x.name === fact.machine);
    return m?.states.find((s) => s.name === fact.state)?.final ? 'present' : 'missing';
  }
  return 'missing';
}

// загвар → загварт хэлний мөрүүд (эсрэг чиглэл: bj cnl export; хэмжилтэд)
const OPWORD = { view: 'харна', create: 'үүсгэнэ', update: 'засна', remove: 'устгана' };
const DENYWORD = { view: 'харахгүй', create: 'үүсгэхгүй', update: 'засахгүй', remove: 'устгахгүй' };
const q = (s) => `«${s}»`;
export function renderCnl(model) {
  const out = [];
  for (const r of model.roles) {
    if (!r.role || r.role.startsWith('@') || r.object || r.table === '*' || !model.tables.has(r.table)) continue;
    const words = ['view', 'create', 'update', 'remove'].map((op) => (r.raw?.[op] === '-' ? DENYWORD[op] : r[op] ? OPWORD[op] : null)).filter(Boolean);
    if (words.length) out.push({ kind: 'right', text: `${q(r.role)} ${q(r.table)}-ийг ${words.join(', ')}.` });
  }
  for (const m of model.machines) {
    for (const t of m.transitions) {
      if (t.create || t.from === '[*]' || !str(t.who)) continue;
      const conds = [t.requireComment ? 'тайлбар бичсэн' : null, str(t.guard) && !t.guard.includes('`') ? `\`${str(t.guard)}\`` : null].filter(Boolean);
      out.push({ kind: 'transition', text: `${conds.length ? `Хэрэв ${conds.join(' ба ')} бол ` : ''}${q(m.table)} ${q(t.from)} үед ${str(t.who).split(',').map((w) => q(str(w))).join(', ')} ${q(t.caption)}-оор ${q(t.to)} болгоно.` });
    }
    for (const s of m.states) if (s.final) out.push({ kind: 'final', text: `${q(m.table)} ${q(s.name)} эцсийн төлөв.` });
  }
  for (const [t, tb] of model.tables) for (const c of tb.columns) {
    if (c.required && !c.pk) out.push({ kind: 'required', text: `${q(t)}-ийн ${q(c.name)} заавал.` });
    if (c.unique) out.push({ kind: 'unique', text: `${q(t)}-ийн ${q(c.name)} давтагдахгүй.` });
  }
  return out;
}
