// PLAN14 A5 (PLAN13 P12.2) — серверийн plan-ийн (SolutionDeploy.cpp planSolution) өгөгдлийн сангаас үл хамаарах хоорондын шалгалтууд.
// Код ба мессеж нь серверийнхтэй ижил (scripts/validate-parity.mjs харьцуулна). Хүснэгтийн нэрийн шалгалт зөвхөн `strict` үед
// (бүх `requires` уншигдсан) — эс бөгөөс суусан/цөмийн хүснэгт рүү заах боломжтой тул шалгахгүй.
//   ctx: {files, yaml, fileOf, listed, tables: Map<нэр, {orgScoped, columns}>, foreignTables, foreignLedgers, foreignContexts, hasTable, strict, machines, required, add}

import { makeSchema, ledgerInfos, generatorError, metricErrors, layoutError } from './compile.mjs';
import { ledgerErrors, screenErrors, reportErrors, endpointErrors } from './blocks.mjs';
import { parseRoles } from './parsers.mjs';
import { x0Parses } from './x0.mjs';

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
      // T3b WP-J: байгууллагын хүрээтэй хүснэгтийн seed мөр — seed-д байгууллага (organisations) алга бол сервер алгасна (seed_skip)
      const tAny = tables.get(d.table) ?? ctx.foreignTables?.get(d.table);
      if (dir === 'seed' && tAny?.orgScoped && !Object.entries(yaml).some(([f, v]) => f.startsWith('seed') && Array.isArray(v?.organisations) && v.organisations.length))
        add('ref', 'error', 'seed_skip', d.file, d.line, `seed: «${d.table}» байгууллагын хүрээтэй боловч seed-д байгууллага алга`);
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
  const reportSrc = new Map();
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
    if (src && hasTable(src)) reportSrc.set(r, src); // T3b WP-J: layout хөрвүүлэлт (серверт r.table шийдэгдсэн тайланд л)
    if (!src ? true : strict && !hasTable(src)) add('ref', 'error', 'report_table', repFile, 0, `reports.yaml: «${name}» эх хүснэгт «${src}» ERD-д алга`);
    // T3 WP-D G-T3-20: `join: [{table, on: "<Багана> == <Хүснэгт|as>.<Багана>", type, as}]` (серверийн report_join)
    for (const part of [r, ...asList(r.union).filter((u) => u && typeof u === 'object')]) for (const jn of asList(part.join)) {
      if (!jn || typeof jn !== 'object') continue;
      const jt = str(jn.table), as = str(jn.as ?? jt), on = str(jn.on), ty = jn.type === undefined ? 'left' : str(jn.type);
      let why = '';
      if (strict && !hasTable(jt)) why = `хүснэгт «${jt}» ERD-д алга`;
      else if (!['inner', 'left', 'full'].includes(ty)) why = 'type: inner | left | full';
      else {
        const eq = on.indexOf('==');
        const rhs = eq < 0 ? '' : on.slice(eq + 2).trim();
        if (eq < 0 || !on.slice(0, eq).trim() || !rhs.startsWith(`${as}.`) || !rhs.slice(as.length + 1).trim()) why = `on: "<эх хүснэгтийн багана> == ${as}.<Багана>" хэлбэртэй байх ёстой (${on})`;
      }
      if (why) add('ref', 'error', 'report_join', repFile, 0, `reports.yaml: «${name}» join «${jt}»: ${why}`);
    }
  }

  // ---- T3 WP-E (G-T3-11): api.yaml — серверийн api_name/api_dup/api_source/api_field/api_transition/api_lines/api_report (SolutionDeploy.cpp 7e)
  const apiFile = fileOf('api', 'api.yaml');
  if (apiFile && yaml[apiFile] && typeof yaml[apiFile] === 'object') {
    const ad = yaml[apiFile];
    const defVer = typeof ad.version === 'string' ? ad.version.trim() : 'v1';
    const reports = new Set(asList(yaml[fileOf('reports', 'reports.yaml')]?.reports).map((r) => str(r?.name)));
    const cols = (t) => new Set((tables.get(t)?.columns ?? []).map((c) => c.name));
    const normFields = (f) => (Array.isArray(f) ? f.map((x) => ({ name: str(x), column: str(x) })) : f && typeof f === 'object' ? Object.entries(f).map(([k, v]) => ({ name: k, column: str(typeof v === 'object' && v ? v.column : v) })) : []);
    const seenNV = new Set(), seenVP = new Set();
    for (const a of asList(ad.apis)) {
      if (!a || typeof a !== 'object') continue;
      const name = str(a.name), ver = typeof a.version === 'string' ? a.version.trim() : defVer, path = typeof a.path === 'string' ? a.path.trim() : name;
      const bad = (code, msg) => add('ref', 'error', code, apiFile, 0, `api.yaml «${name}» ${ver}: ${msg}`);
      if (!/^[a-z][a-z0-9_-]{0,99}$/.test(name)) bad('api_name', '`name` — латин жижиг үсэг, тоо, _ - (эрхийн объект api:<нэр>, OAuth scope)');
      if (!/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(path)) bad('api_path', '`path` — a-z0-9_- хэсгүүд «/»-ээр');
      if (seenNV.has(`${name}@${ver}`)) bad('api_dup', 'ижил нэр × хувилбар давхардсан');
      if (seenVP.has(`${ver}/${path}`)) bad('api_dup', 'ижил хувилбар × зам давхардсан');
      seenNV.add(`${name}@${ver}`); seenVP.add(`${ver}/${path}`);
      const isTable = a.table !== undefined, isReport = a.report !== undefined;
      if (isTable === isReport) bad('api_source', '`table` эсвэл `report`-ийн яг нэг нь');
      if (isTable) {
        const tbl = str(a.table), fields = normFields(a.fields);
        if (!fields.length) bad('api_field', '`fields` заавал (ил гаргах талбар — secure by default)');
        if (strict && !hasTable(tbl)) { bad('api_table', `хүснэгт «${tbl}» ERD-д алга`); continue; }
        if (tables.has(tbl)) for (const f of fields) if (!cols(tbl).has(f.column)) bad('api_field', `«${tbl}»-д «${f.column}» багана алга`);
        const aliases = new Set(fields.map((f) => f.name));
        for (const s of asList(a.sort)) { const sn = str(s).replace(/^-/, ''); if (!aliases.has(sn)) bad('api_field', `sort: талбар «${sn}» fields-д алга`); }
        const trs = new Set(machines.filter((m) => m.table === tbl).flatMap((m) => m.transitions.map((t) => str(t.caption))));
        if (machines.some((m) => m.table === tbl)) for (const t of asList(a.transitions)) if (!trs.has(str(t))) bad('api_transition', `шилжилт «${str(t)}» «${tbl}»-ийн машинд алга`);
        if (a.lines && typeof a.lines === 'object') for (const [ln, l] of Object.entries(a.lines)) {
          const ct = str(l?.table);
          if (strict && !hasTable(ct)) { bad('api_lines', `lines.${ln}: хүснэгт «${ct}» алга`); continue; }
          if (aliases.has(ln) || ln === 'id') bad('api_lines', `lines.${ln}: талбарын нэртэй давхцав`);
          const lf = normFields(l?.fields);
          if (!lf.length) bad('api_lines', `lines.${ln}.fields заавал`);
          if (tables.has(ct)) for (const f of lf) if (!cols(ct).has(f.column)) bad('api_field', `lines.${ln}: «${ct}»-д «${f.column}» багана алга`);
        }
      }
      if (isReport && strict && !reports.has(str(a.report))) bad('api_report', `тайлан «${str(a.report)}» reports.yaml-д алга`);
      // T3b WP-J: серверийн api_option (тайлангийн нөөц зөвхөн GET), api_filter (X0 задлалт; member()/in (…) серверт өргөтгөгддөг тул алгасна)
      if (isReport && !isTable) for (const k of ['operations', 'transitions', 'lines', 'filter', 'sort']) if (a[k] !== undefined) bad('api_option', `тайлангийн нөөцөд \`${k}\` хамаарахгүй (зөвхөн GET)`);
      const af = str(a.filter);
      if (isTable && af && !/member\s*\(|\bin\s*\(/.test(af) && !x0Parses(af)) bad('api_filter', `filter (X0) задлагдсангүй: ${af}`);
    }
  }

  // ---- T3b WP-J (integration G-18): integrations.yaml outbound `success`/`error` — X0 задлалт (серверийн outbound_expr)
  const igFile = fileOf('integrations', 'integrations.yaml');
  for (const o of asList(yaml[igFile]?.outbound)) {
    if (!o || typeof o !== 'object') continue;
    for (const k of ['success', 'error']) if (typeof o[k] === 'string' && !x0Parses(o[k]))
      add('ref', 'error', 'outbound_expr', igFile, 0, `integrations.yaml outbound «${str(o.name)}»: ${k} «${o[k]}» — X0 задлагдсангүй`);
  }

  // ---- T3 WP-D G-T3-19: generators.yaml `type: refs` (table заавал) ба `from: param.<Нэр>` (refs параметр) — серверийн generator_param
  for (const g of asList(yaml[genFile]?.generators)) {
    if (!g || typeof g !== 'object') continue;
    const name = str(g.name);
    const refs = new Set();
    for (const p of asList(g.params)) {
      if (!p || typeof p !== 'object' || p.type !== 'refs') continue;
      const pt = str(p.table);
      if (!pt || (strict && !hasTable(pt))) add('ref', 'error', 'generator_param', genFile, 0, `generators.yaml «${name}»: параметр «${str(p.name)}»: type refs — table (сонгох мөрийн хүснэгт) ${pt ? `«${pt}» ERD-д алга` : 'заавал'}`);
      refs.add(str(p.name));
    }
    for (const gr of [...asList(g.lines), ...(g.rows ? [g.rows] : [])]) {
      const from = typeof gr?.from === 'string' ? gr.from.trim() : '';
      if (from.startsWith('param.') && !refs.has(from.slice(6).trim())) add('ref', 'error', 'generator_param', genFile, 0, `generators.yaml «${name}»: from: ${from} — \`type: refs\` параметр алга (сонгосон мөрүүдийн эх)`);
    }
  }

  // ---- T3b WP-J (N-01): plan-ийн generator_name/generator_table/generator_body, metric_value ба apply үеийн хөрвүүлэлт
  //      (generator_compile, metric_compile, metric_notify, report_compile) — серверийн DeployCalc.inc-тэй ижил мессеж (compile.mjs)
  const blockedGen = new Set(), seenGen = new Set();
  for (const g of asList(yaml[genFile]?.generators)) {
    if (!g || typeof g !== 'object') continue;
    const name = str(g.name);
    const bad = (code, msg) => { blockedGen.add(g); add('ref', 'error', code, genFile, 0, `generators.yaml «${name}»: ${msg}`); };
    if (!name) { blockedGen.add(g); add('ref', 'error', 'generator_name', genFile, 0, 'generators.yaml: `name` заавал'); continue; }
    if (seenGen.has(name)) bad('generator_name', 'нэр давхардсан');
    seenGen.add(name);
    for (const t of ['target', 'on']) if (g[t] !== undefined && strict && !hasTable(str(g[t]))) bad('generator_table', `${t}: хүснэгт «${str(g[t])}» ERD-д алга`);
    if (g.lines === undefined && g.rows === undefined && g.update === undefined && g.delete === undefined && !(g.target !== undefined && g.header !== undefined) && g.require === undefined) bad('generator_body', 'lines, rows, update, delete, target + header эсвэл require заавал');
    // T3b WP-M (N-14): үйл явдлын генератор — trigger.table ERD-д (requires-ийн дагуу доод багцынх ч); plan info generator_trigger (далд зан төлөв ил)
    if (g.trigger !== undefined) {
      const tt = str(g.trigger?.table);
      if (!tt || (strict && !hasTable(tt))) bad('generator_table', `trigger.table: хүснэгт «${tt}» ERD-д алга`);
      else add('ref', 'info', 'generator_trigger', genFile, 0, `generators.yaml «${name}»: «${tt}»-ийн үйл явдалд (${[].concat(g.trigger.on ?? []).join(', ')}${g.trigger.transitions ? ` (${[].concat(g.trigger.transitions).join(', ')})` : ''}) өлгөгдсөн — бичилттэй нэг transaction-д${g.require !== undefined ? ', шаардлага биелэхгүй бол бичилт буцна' : ''}`);
    }
    for (const p of asList(g.params)) if (p && typeof p === 'object' && p.type === 'refs' && (!str(p.table) || (strict && !hasTable(str(p.table))))) blockedGen.add(g);
    for (const gr of [...asList(g.lines), ...(g.rows ? [g.rows] : [])]) if (typeof gr?.from === 'string' && gr.from.trim().startsWith('param.')) {
      const pn = gr.from.trim().slice(6).trim();
      if (!asList(g.params).some((p) => p?.type === 'refs' && str(p.name) === pn)) blockedGen.add(g);
    }
  }
  const metFile = fileOf('metrics', 'metrics.yaml');
  const seenMet = new Set(), okMetrics = [];
  for (const m of asList(yaml[metFile]?.metrics)) {
    if (!m || typeof m !== 'object') continue;
    const name = str(m.name);
    if (!name) { add('ref', 'error', 'metric_name', metFile, 0, 'metrics.yaml: `name` заавал'); continue; }
    if (seenMet.has(name)) { add('ref', 'error', 'metric_name', metFile, 0, `metrics.yaml «${name}»: нэр давхардсан`); continue; }
    seenMet.add(name);
    if (!str(m.value)) { add('ref', 'error', 'metric_value', metFile, 0, `metrics.yaml «${name}»: \`value\` (илэрхийлэл) заавал`); continue; }
    okMetrics.push(m);
  }
  if (!strict) return;
  const all = new Map([...(ctx.foreignTables ?? new Map()), ...tables]);
  const own = new Set(tables.keys());
  // ledger-ийн plan алдаа эхэлж: хаагдсан ledger үүсэхгүй — түүнийг лавласан генератор/үзүүлэлт серверт «ledger алга» болно
  const ledErrs = ledgerErrors(makeSchema(all, new Map()), yaml[ledFile], own, ledgerInfos(ctx.foreignLedgers ?? []));
  const ownLedgers = ledgerInfos([yaml[ledFile]]);
  for (const n of ledErrs.blocked) ownLedgers.delete(n);
  const S = makeSchema(all, new Map([...ledgerInfos(ctx.foreignLedgers ?? []), ...ownLedgers]));
  // T3b WP-L: context.yaml (энэ багц + requires) — генераторын user.<контекст>[.<Багана>], params default: user.<Нэр>
  const contexts = new Map();
  for (const d of [...(ctx.foreignContexts ?? []), yaml[fileOf('context', 'context.yaml')]]) for (const x of asList(d?.context)) {
    const nm = str(x?.name);
    if (nm && !contexts.has(nm)) contexts.set(nm, str(x?.table));
  }
  for (const g of asList(yaml[genFile]?.generators)) {
    if (!g || typeof g !== 'object' || blockedGen.has(g)) continue;
    const e = generatorError(S, g, all, contexts);
    if (e) add('ref', 'error', 'generator_compile', genFile, 0, `generators.yaml «${str(g.name)}»: ${e}`);
  }
  for (const x of metricErrors(S, okMetrics)) add('ref', 'error', x.code, metFile, 0, x.message);
  for (const r of asList(yaml[repFile]?.reports)) {
    if (!r || typeof r !== 'object' || !r.layout || typeof r.layout !== 'object' || !reportSrc.has(r)) continue;
    const e = layoutError(S, r);
    if (e) add('ref', 'error', 'report_compile', repFile, 0, `reports.yaml «${str(r.name)}» layout: ${e}`);
  }
  // блокуудын баганын нэр (blocks.mjs): ledgers.yaml, screens.yaml, reports.yaml
  for (const x of ledErrs) add('ref', 'error', x.code, ledFile, 0, x.message);
  for (const x of endpointErrors(yaml[igFile])) add('ref', 'error', x.code, igFile, 0, x.message);
  const scrFile = fileOf('screens', 'screens.yaml');
  const scr = yaml[scrFile]?.screens;
  const scrList = Array.isArray(scr) ? scr : scr && typeof scr === 'object' ? Object.entries(scr).map(([id, v]) => ({ id, ...v })) : [];
  // бүлгүүд (SolutionDeploy.cpp §4): roles.csv үүрэг ∪ seed groups ∪ seed хэрэглэгчийн roles ∪ states `хэн` (үүсгэх шилжилтээс бусад)
  const groups = new Set();
  const addG = (n) => { const t = str(n).toLowerCase(); if (t && t !== 'процесс' && t !== 'process') groups.add(t); };
  const rolesFile = fileOf('roles', 'roles.csv');
  if (rolesFile) for (const r of parseRoles(files[rolesFile]).roles) addG(r.role);
  for (const [f, v] of Object.entries(yaml)) if (f.startsWith('seed/') && v && typeof v === 'object') {
    for (const g of asList(v.groups)) addG(g?.name);
    for (const o of asList(v.organisations)) for (const u of asList(o?.users)) for (const x of asList(u?.roles)) addG(x);
  }
  for (const m of machines) for (const tr of m.transitions) if (!tr.create) for (const w of String(tr.who ?? '').split(',')) addG(w);
  for (const x of screenErrors(S, scrList, groups)) add('ref', 'error', x.code, scrFile, 0, x.message);
  for (const x of reportErrors(S, asList(yaml[repFile]?.reports))) add('ref', 'error', x.code, repFile, 0, x.message);
}
