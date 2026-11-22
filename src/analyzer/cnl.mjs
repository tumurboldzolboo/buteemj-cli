// PLAN15 D1/D2 — загварт хэл (EARS-MN): нэг мөрөнд нэг өгүүлбэр → баримт (IR). LLM-гүй, детерминист.
// Нэр (хүснэгт, үүрэг, төлөв, багана, товч) — багцын загвараас; монгол хэлний тийн ялгалын дагавартай (Захиалга → Захиалгыг, Ажилтан → Ажилтны),
// эсвэл «…» хашилтаар (олон үгтэй/шинэ нэр). Загвар (README «Загварт хэл»):
//   RIGHT   <Үүрэг> <Хүснэгт>-ийг харна|үүсгэнэ|засна|устгана[, …]          — эрх (roles.csv); «…-ийг устгахгүй|устгаж болохгүй» — хориг (-)
//   TRANS   [<Хүснэгт>] <Төлөв1> үед <Үүрэг>[, <Үүрэг>] «Товч»-оор <Төлөв2> болгоно — шилжилт (states.mmd)
//   REQUIRED <Хүснэгт>-ийн <Багана> заавал                                    — not null (erd.dbml)
//   UNIQUE  <Хүснэгт>-ийн <Багана> давтагдахгүй                              — unique (erd.dbml)
//   FINAL   [<Хүснэгт>] <Төлөв> эцсийн төлөв                                  — `<Төлөв> --> [*]`
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

// нэг өгүүлбэр → {facts: [...]} | null
export function parseSentence(sentence, vocab) {
  const raw = str(sentence).replace(/[.。]+$/, '').trim();
  if (!raw) return null;
  const { text, found } = tag(raw, vocab);
  const pick = (i, kind, ok = () => true) => found[Number(i)]?.alts.find((a) => a.kind === kind && ok(a)) ?? null;
  const quoted = (i) => !!found[Number(i)]?.quoted;
  const nameOf = (i) => found[Number(i)]?.name;
  let m;
  // RIGHT: ⟦R⟧ ⟦T⟧ verb[, verb …]
  if ((m = /^⟦(\d+)⟧ ⟦(\d+)⟧ (.+)$/.exec(text))) {
    const role = pick(m[1], 'role'), table = pick(m[2], 'table');
    if (role && table) {
      const words = m[3].split(/\s*(?:,|\bба\b|\bболон\b)\s*/).map(str).filter(Boolean);
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
  if ((m = /^(?:⟦(\d+)⟧ )?⟦(\d+)⟧ (?:төлөвтэй үед|төлөвт|үед) ((?:⟦\d+⟧(?: ?, ?| ба )?)+) ⟦(\d+)⟧ (?:товчоор )?⟦(\d+)⟧ (?:болгоно|руу шилжүүлнэ|шилжүүлнэ|төлөвт шилжүүлнэ)$/.exec(text))) {
    const table = m[1] ? pick(m[1], 'table') : null;
    if (!m[1] || table) {
      const s1 = pick(m[2], 'state', (a) => !table || a.table === table.name);
      const s2 = s1 && (pick(m[5], 'state', (a) => a.machine === s1.machine) ?? (quoted(m[5]) ? { name: nameOf(m[5]) } : null));
      const capt = pick(m[4], 'transition', (a) => !s1 || a.machine === s1.machine) ?? (quoted(m[4]) ? { name: nameOf(m[4]) } : null);
      const roles = [...m[3].matchAll(/⟦(\d+)⟧/g)].map((x) => pick(x[1], 'role') ?? (/^процесс$/i.test(nameOf(x[1]) ?? '') ? { name: 'процесс' } : null));
      if (s1 && s2 && capt && roles.length && roles.every(Boolean))
        return { facts: [{ kind: 'transition', machine: s1.machine, table: s1.table, from: s1.name, to: s2.name, caption: capt.name, who: roles.map((r) => r.name) }] };
    }
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
    return fact.who.every((w) => who.includes(w.toLowerCase())) ? 'present' : who.length ? 'conflict' : 'missing';
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
      out.push({ kind: 'transition', text: `${q(m.table)} ${q(t.from)} үед ${str(t.who).split(',').map((w) => q(str(w))).join(', ')} ${q(t.caption)}-оор ${q(t.to)} болгоно.` });
    }
    for (const s of m.states) if (s.final) out.push({ kind: 'final', text: `${q(m.table)} ${q(s.name)} эцсийн төлөв.` });
  }
  for (const [t, tb] of model.tables) for (const c of tb.columns) {
    if (c.required && !c.pk) out.push({ kind: 'required', text: `${q(t)}-ийн ${q(c.name)} заавал.` });
    if (c.unique) out.push({ kind: 'unique', text: `${q(t)}-ийн ${q(c.name)} давтагдахгүй.` });
  }
  return out;
}
