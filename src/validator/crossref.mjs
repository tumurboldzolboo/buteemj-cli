// PLAN14 A5 (PLAN13 P12.2) — серверийн plan-ийн (SolutionDeploy.cpp planSolution) өгөгдлийн сангаас үл хамаарах хоорондын шалгалтууд.
// Код ба мессеж нь серверийнхтэй ижил (scripts/validate-parity.mjs харьцуулна). Хүснэгтийн нэрийн шалгалт зөвхөн `strict` үед
// (бүх `requires` уншигдсан) — эс бөгөөс суусан/цөмийн хүснэгт рүү заах боломжтой тул шалгахгүй.
//   ctx: {files, yaml, fileOf, listed, tables: Map<нэр, {orgScoped, columns}>, hasTable, strict, machines, foreignPackages, add}

const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));

// Package.cpp documentName: `<!-- name: … -->`, эс бөгөөс <title> ({{…}}-гүй), эс бөгөөс файлын нэр
export function documentName(html, file) {
  const n = /<!--\s*name:\s*([^>]*?)\s*-->/.exec(html);
  if (n) return n[1].trim() || file.split('/').pop();
  const t = /<title>([^<]*)<\/title>/i.exec(html);
  const name = t ? t[1].replace(/\{\{[\s\S]*?(\}\}|$)/g, '').trim() : '';
  return name || file.split('/').pop();
}
// SolutionDeploy.cpp htmlMeta
export const htmlMeta = (html, name) => (new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"\\s*/?>`, 'i').exec(html)?.[1] ?? '').trim();

// Серверийн lookup_like-ийн үгс (Тодугийн гаднын кейс: лавлах холбоос текст/тоо баганаар алдагдсан)
const LOOKUP_WORDS = ['төрөл', 'Төрөл', 'ангилал', 'Ангилал', 'аймаг', 'Аймаг', 'дүүрэг', 'Дүүрэг', 'хороо', 'Хороо', 'бүс', 'Бүс',
  'суваг', 'Суваг', 'загвар', 'Загвар', 'улс', 'Улс', 'нэгж', 'Нэгж'];
const LETTER = /[\p{L}\p{N}_]/u;
const hasWord = (name) => LOOKUP_WORDS.some((w) => {
  for (let p = name.indexOf(w); p >= 0; p = name.indexOf(w, p + 1)) {
    const e = p + w.length;
    if ((p === 0 || !LETTER.test(name[p - 1])) && (e >= name.length || !LETTER.test(name[e]))) return true;
  }
  return false;
});

// seed/reference/defaults — Package.cpp-тэй ижил: YAML-ийн дээд түвшний жагсаалтын түлхүүр, CSV-ийн файлын нэр = хүснэгт
function dataTables(ctx, dir) {
  const { files, yaml, listed } = ctx;
  let list = asList(listed[dir]).filter((f) => typeof f === 'string' && files[f] !== undefined);
  if (!list.length && listed[dir] === undefined) list = Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort();
  if (dir === 'seed' && !asList(listed.seed).length && listed.seed === undefined) list = list.filter((f) => /\.ya?ml$/i.test(f));
  const out = [];
  for (const f of list) {
    if (/\.csv$/i.test(f)) { out.push({ table: f.split('/').pop().replace(/\.csv$/i, ''), file: f, line: 1 }); continue; }
    const v = yaml[f];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const [k, x] of Object.entries(v)) {
      if (dir === 'seed' && (k === 'organisations' || k === 'groups')) continue;
      if (Array.isArray(x)) out.push({ table: k, file: f, line: 0 });
    }
  }
  return out;
}

export function crossCheck(ctx) {
  const { files, yaml, fileOf, tables, hasTable, strict, machines, add } = ctx;

  // ---- seed/reference/defaults хүснэгт (seed_table, reference_table, defaults_table) ба хүрээ (reference_org, defaults_global)
  for (const dir of ['seed', 'reference', 'defaults']) {
    const seen = new Set();
    for (const d of dataTables(ctx, dir)) {
      if (seen.has(d.table)) continue;
      seen.add(d.table);
      if (strict && !hasTable(d.table)) { add('ref', 'error', `${dir}_table`, d.file, d.line, `${dir}: хүснэгт «${d.table}» ERD-д алга`); continue; }
      const t = tables.get(d.table);
      if (!t) continue; // requires/цөмийн хүснэгтийн хүрээ сервер дээр л мэдэгдэнэ
      if (dir === 'reference' && t.orgScoped) add('ref', 'warning', 'reference_org', d.file, d.line, `reference: «${d.table}» байгууллагын хүрээтэй — системийн лавлах нь глобал (\`Note: 'orgScoped: false'\`) хүснэгтэд; байгууллага бүрийн анхны өгөгдлийг defaults/-д`);
      if (dir === 'defaults' && !t.orgScoped) add('ref', 'warning', 'defaults_global', d.file, d.line, `defaults: «${d.table}» глобал (\`orgScoped: false\`) хүснэгт — байгууллагад хуулах зүйлгүй; системийн лавлахыг reference/-д`);
    }
  }

  // ---- lookup_like (анхааруулга, ≤ 50): лавлах шиг нэртэй text/integer багана — ref/enum/state биш
  const erdFile = fileOf('erd', 'erd.dbml');
  if (erdFile) {
    const stateCols = new Set(machines.map((m) => `${m.table}.${m.column}`));
    let n = 0;
    for (const [tn, t] of tables) for (const c of t.columns) {
      if (c.pk || c.name.toLowerCase() === 'id') continue;
      let type = c.type;
      if (c.ref) {
        const target = tables.get(c.ref.table);
        const logical = c.ref.column && c.ref.column.toLowerCase() !== 'id' && !(target?.columns.some((x) => x.name === c.ref.column && x.pk));
        if (!logical) continue; // FK
        if (!type) type = 'text';
      }
      if ((type !== 'text' && type !== 'integer') || stateCols.has(`${tn}.${c.name}`) || (c.tags ?? []).some((g) => g.tag === 'enum' || g.tag === 'state')) continue;
      if (!hasWord(c.name)) continue;
      if (++n <= 50) add('ref', 'warning', 'lookup_like', erdFile, c.line, `«${tn}.${c.name}» нь лавлах утга шиг боловч ${type === 'text' ? 'текст' : 'тоо'} — хэрэглэгч утгыг гараар бичнэ. Лавлах хүснэгт рүү \`ref:\` (хамааралтай бол \`filter:\`) эсвэл \`enum(…)\` болгоно уу`);
    }
  }

  // ---- баримтын загвар (document_table, document_paper)
  const docList = asList(ctx.listed.documents).filter((f) => typeof f === 'string' && files[f] !== undefined);
  const docs = docList.length ? docList : Object.keys(files).filter((f) => /\.html$/i.test(f)).sort();
  const PAPERS = new Set(['A3', 'A4', 'A5', 'A6', 'Letter', '80mm', '58mm']);
  for (const f of docs) {
    const html = files[f];
    const name = documentName(html, f);
    let tbl = htmlMeta(html, 'table');
    if (!tbl) for (const m of machines) for (const tr of m.transitions) for (const a of tr.actions ?? []) if (a.name === 'generateDocument' && str(a.arg) === name) tbl = m.table;
    if (!tbl) {
      let best = 0;
      for (const [tn, t] of tables) {
        let hit = 0;
        for (const c of t.columns) if (html.includes(`{{${c.name}`) || html.includes(`"${c.name}"`)) hit++;
        if (hit > best) { best = hit; tbl = tn; }
      }
    }
    if (!tbl || (strict && !hasTable(tbl))) add('ref', 'error', 'document_table', f, 1, `Баримт «${name}»: хүснэгт тодорхойгүй`);
    const paper = htmlMeta(html, 'paper'), orient = htmlMeta(html, 'orientation');
    if (paper && !PAPERS.has(paper)) add('ref', 'error', 'document_paper', f, 1, `Баримт «${name}»: paper «${paper}» — A3 | A4 | A5 | A6 | Letter | 80mm | 58mm`);
    if (orient && orient !== 'portrait' && orient !== 'landscape') add('ref', 'error', 'document_paper', f, 1, `Баримт «${name}»: orientation «${orient}» — portrait | landscape`);
  }

  // ---- states.mmd generate(<нэр>) → generators.yaml (transition_generator; суусан генератор сервер дээр л мэдэгдэнэ — requires-гүй үед)
  const genFile = fileOf('generators', 'generators.yaml');
  const gens = new Set(asList(yaml[genFile]?.generators).map((g) => str(g?.name)).filter(Boolean));
  if (!ctx.required.length) for (const m of machines) for (const tr of m.transitions) for (const a of tr.actions ?? []) {
    if (a.name !== 'generate' || gens.has(str(a.arg))) continue;
    add('ref', 'warning', 'transition_generator', fileOf('states', 'states.mmd'), a.line ?? tr.line, `states.mmd «${m.table}» «${tr.caption}»: generate(${str(a.arg)}) — генератор (generators.yaml) алга`);
  }

  // ---- reports.yaml эх (report_table, report_ledger, report_layout)
  const repFile = fileOf('reports', 'reports.yaml');
  const ledFile = fileOf('ledgers', 'ledgers.yaml');
  const ledgerSrc = (ln) => asList(yaml[ledFile]?.ledgers).find((l) => str(l?.name) === ln && asList(l?.sources).length)?.sources[0]?.table ?? '';
  for (const r of asList(yaml[repFile]?.reports)) {
    if (!r || typeof r !== 'object') continue;
    const name = str(r.name);
    let src = str(r.source);
    let unresolvedLedger = false;
    if (!src && r.balance && typeof r.balance === 'object') {
      const ln = str(r.balance.ledger);
      src = str(ledgerSrc(ln));
      if (!src) { if (ctx.required.length) unresolvedLedger = true; else add('ref', 'error', 'report_ledger', repFile, 0, `reports.yaml: «${name}» ledger «${ln}» (ledgers.yaml) алга`); }
    }
    if (!src && !unresolvedLedger && r.layout && typeof r.layout === 'object') {
      for (const row of asList(r.layout.rows)) if (!src && typeof row?.each === 'string' && hasTable(row.each)) src = row.each;
      const txt = JSON.stringify(r.layout);
      const lm = /(?:balance|change)\(\s*([^,()]+?)\s*,/.exec(txt);
      if (!src && lm) { src = str(ledgerSrc(lm[1].trim())); if (!src && ctx.required.length) unresolvedLedger = true; }
      const tm = /(?:sumof|countof|avgof|minof|maxof)\(\s*([^,()]+?)\s*[,)]/.exec(txt);
      if (!src && !unresolvedLedger && tm) src = tm[1].trim();
      if (!src && !unresolvedLedger) add('ref', 'error', 'report_layout', repFile, 0, `reports.yaml: «${name}» layout — эх тодорхойгүй (\`source:\` заана уу)`);
    }
    if (unresolvedLedger) continue;
    if (!src ? true : strict && !hasTable(src)) add('ref', 'error', 'report_table', repFile, 0, `reports.yaml: «${name}» эх хүснэгт «${src}» ERD-д алга`);
  }
}
