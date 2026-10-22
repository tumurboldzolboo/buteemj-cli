// BRD+PRD-ийн хаалга (PLAN12 §2.2) — сервергүй, детерминист. `bj validate` ба бусад тушаалын `gate()` дуудна.
// Шат: file → parse → schema (каталог байвал) → expr → ref → coverage. Олдвор: {stage, code, severity, file, line, message}.
// Каталог (`docs/brd-standard/catalog/`, P12.1) хараахан бүрэн биш тул schema шат каталог байхгүй үед алгасагдана (анхааруулга),
// лавлагааны шийдэгдээгүй холбоос нь каталогийн платформын чадвар руу заах боломжтой тул анхааруулга.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml, lineOf, duplicateKeys } from './yaml.mjs';
import { parseDbml } from './dbml.mjs';
import { parseRequirements, parseAcceptance, parseRoles, parseStates } from './parsers.mjs';
import { validateSchema } from './schema.mjs';
import { balance } from './expr.mjs';
import { crossCheck } from './crossref.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// платформ дотор: docs/brd-standard/catalog; CLI-ийн хуулбарт (cli/src/validator/catalog) sync-validator хамт хуулна
const CATALOG_DIR = existsSync(join(HERE, 'catalog')) ? join(HERE, 'catalog') : join(HERE, '..', '..', 'docs', 'brd-standard', 'catalog');

// → {dir, schemas: {<файлын төрөл>: JSON Schema}, blocks, capabilities: Set} — каталог байхгүй бол хоосон (available: false)
export function loadCatalog(dir = CATALOG_DIR) {
  const cat = { dir, available: false, schemas: {}, blocks: null, capabilities: new Set() };
  if (!existsSync(dir)) return cat;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n.endsWith('.schema.json')) cat.schemas[n.replace(/\.schema\.json$/, '')] = JSON.parse(readFileSync(p, 'utf8'));
    else if (n === 'blocks.json') cat.blocks = JSON.parse(readFileSync(p, 'utf8'));
  }
  for (const c of cat.blocks?.capabilities ?? []) cat.capabilities.add(typeof c === 'string' ? c : c.name);
  // capabilities/<төрөл>.json — [{name, source, description}]: шаардлагын «(платформ: <нэр>)» холбоос эдгээр рүү шийдэгдэнэ
  const capDir = join(dir, 'capabilities');
  if (existsSync(capDir)) for (const n of readdirSync(capDir)) {
    if (!n.endsWith('.json')) continue;
    for (const c of JSON.parse(readFileSync(join(capDir, n), 'utf8'))) cat.capabilities.add(typeof c === 'string' ? c : c.name);
  }
  cat.available = Object.keys(cat.schemas).length > 0;
  return cat;
}

const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const YAML_FILE = /\.ya?ml$/i;

// files: {<харьцангуй зам>: текст}; opts: {catalog, packages: Map<key, {key, files}>}
export function validatePackage(files, opts = {}) {
  const catalog = opts.catalog ?? loadCatalog();
  const findings = [];
  const add = (stage, severity, code, file, line, message) => findings.push({ stage, severity, code, file, line: line || 0, message });

  // ---- 1. file: manifest ба түүний жагсаасан файлууд
  const manifestFile = files['manifest.yaml'] !== undefined ? 'manifest.yaml' : files['manifest.yml'] !== undefined ? 'manifest.yml' : null;
  if (!manifestFile) {
    add('file', 'error', 'manifest_missing', 'manifest.yaml', 0, 'manifest.yaml олдсонгүй');
    return result(findings, {});
  }
  const yaml = {};
  for (const [f, text] of Object.entries(files)) {
    if (!YAML_FILE.test(f)) continue;
    const r = loadYaml(text);
    if (r.error) { add('parse', 'error', 'yaml_syntax', f, r.line, `YAML задлагдсангүй: ${r.error}`); continue; }
    yaml[f] = r.value;
    walkDups(r.value, (k, line) => add('parse', 'error', 'yaml_dup_key', f, line, `«${k}» түлхүүр давхардсан — сервер сүүлийнхийг авна`));
  }
  const manifest = yaml[manifestFile];
  if (!manifest || typeof manifest !== 'object') return result(findings, {});
  if (!manifest.key) add('file', 'error', 'manifest_key', manifestFile, 0, '«key» талбар алга');
  else if (!/^[a-z][a-z0-9-]{1,49}$/.test(String(manifest.key))) add('file', 'error', 'manifest_key', manifestFile, lineOf(manifest, 'key'), `key «${manifest.key}» — жижиг латин үсэг, тоо, зураас; 2–50 тэмдэгт`);
  if (!manifest.name) add('file', 'error', 'manifest_name', manifestFile, 0, '«name» талбар алга');
  const listed = manifest.files && typeof manifest.files === 'object' ? manifest.files : {};
  for (const [kind, v] of Object.entries(listed)) {
    for (const f of asList(v)) {
      if (typeof f !== 'string') continue;
      const isDir = f.endsWith('/');
      const exists = isDir ? Object.keys(files).some((k) => k.startsWith(f)) : files[f] !== undefined;
      if (!exists) add('file', 'error', 'file_missing', manifestFile, lineOf(listed, kind), `files.${kind}: «${f}» багцад алга`);
    }
  }
  const fileOf = (kind, dflt) => asList(listed[kind] ?? dflt).find((f) => typeof f === 'string' && files[f] !== undefined);

  // ---- 2. parse: DBML, states, roles, requirements, acceptance
  const tables = new Map(); // нэр → Set(багана)
  const erdTables = new Map(); // нэр → {orgScoped, columns} (crossref)
  const erdFile = fileOf('erd', 'erd.dbml');
  if (erdFile) {
    const d = parseDbml(files[erdFile]);
    if (d.error) add('parse', 'error', 'dbml_syntax', erdFile, d.errorLine, d.error);
    for (const i of d.issues) add('parse', i.severity, i.code, erdFile, i.line, i.message);
    for (const t of d.tables) { tables.set(t.name, new Set(t.columns.map((c) => c.name))); erdTables.set(t.name, t); }
  } else add('file', 'warning', 'erd_missing', manifestFile, 0, 'erd.dbml алга — хүснэгтийн лавлагаа шалгагдахгүй');
  // `requires`-ийн багцуудын хүснэгт (нэр шийдэлд)
  const required = asList(manifest.requires).map((r) => (typeof r === 'string' ? r.split(/[@\s]/)[0] : r?.key)).filter(Boolean);
  const foreign = new Map();
  const foreignTables = new Map(), foreignLedgers = [], foreignContexts = []; // T3b WP-J: requires-ийн хүснэгт (багана, FK) ба ledgers.yaml — хөрвүүлэлтийн шалгалтад
  let resolved = 0;
  for (const key of required) {
    const dep = opts.packages?.get(key);
    if (!dep) { add('ref', 'warning', 'requires_unknown', manifestFile, lineOf(manifest, 'requires'), `requires «${key}» төслөөс олдсонгүй — түүний нэрс шалгагдахгүй`); continue; }
    resolved++;
    const f = Object.keys(dep.files).find((k) => k.endsWith('.dbml'));
    if (f) for (const t of parseDbml(dep.files[f]).tables) { foreign.set(t.name, new Set(t.columns.map((c) => c.name))); if (!foreignTables.has(t.name) || foreignTables.get(t.name).columns.length < t.columns.length) foreignTables.set(t.name, t); }
    for (const [lf, txt] of Object.entries(dep.files)) if (/(^|\/)ledgers\.ya?ml$/i.test(lf)) { const r = loadYaml(txt); if (!r.error) foreignLedgers.push(r.value); }
    for (const [lf, txt] of Object.entries(dep.files)) if (/(^|\/)context\.ya?ml$/i.test(lf)) { const r = loadYaml(txt); if (!r.error) foreignContexts.push(r.value); } // T3b WP-L: user.<контекст>
  }
  const hasTable = (n) => tables.has(n) || foreign.has(n);
  const colsOf = (n) => tables.get(n) ?? foreign.get(n);
  const strict = (tables.size > 0 || resolved > 0) && required.length === resolved; // T3b WP-J: ERD-гүй (зөвхөн дэлгэц) багц requires-ээр

  const names = new Set([...tables.keys()]);
  for (const [t, cols] of tables) for (const c of cols) names.add(`${t}.${c}`);

  const statesFile = fileOf('states', 'states.mmd');
  const machines = [];
  if (statesFile) {
    const s = parseStates(files[statesFile]);
    machines.push(...s.machines);
    for (const i of s.issues) add('parse', i.severity, i.code, statesFile, i.line, i.message);
    for (const m of s.machines) {
      names.add(m.name);
      for (const st of m.states) names.add(st.name);
      for (const tr of m.transitions) names.add(tr.caption);
      if (!strict) continue;
      if (!hasTable(m.table)) add('ref', 'error', 'ref_table', statesFile, m.line, `машин «${m.name}»: хүснэгт «${m.table}» алга`);
      else if (!colsOf(m.table).has(m.column)) add('ref', 'error', 'ref_column', statesFile, m.line, `машин «${m.name}»: «${m.table}.${m.column}» багана алга`);
      for (const tr of m.transitions) for (const g of tr.guard ? [tr.guard] : []) {
        const b = balance(g);
        if (b) add('expr', 'error', 'expr_balance', statesFile, tr.line, `guard «${g}»: ${b}`);
      }
    }
  }

  const rolesFile = fileOf('roles', 'roles.csv');
  if (rolesFile) {
    const r = parseRoles(files[rolesFile]);
    for (const i of r.issues) add('parse', i.severity, i.code, rolesFile, i.line, i.message);
    // T3 WP-A: «Объект» — дэлгэц/товч/хуудас screens.yaml-д, тайлан reports.yaml-д (SolutionDeploy.cpp role_object)
    const trim = (s) => String(s ?? '').trim();
    const scr = asList(yaml['screens.yaml']?.screens), reps = asList(yaml['reports.yaml']?.reports);
    const scrOf = (id) => scr.find((x) => x && (x.id === id || (x.type === 'page' && x.slug === id)));
    const objectError = (obj) => {
      const m = /^([^:]+):\s*(.+)$/.exec(obj);
      const kind = { 'дэлгэц': 'screen', screen: 'screen', 'товч': 'action', action: 'action', 'тайлан': 'report', report: 'report', 'хуудас': 'page', page: 'page', api: 'api' }[trim(m?.[1] ?? '').toLowerCase()];
      if (!kind) return 'угтвар танигдсангүй (дэлгэц:, товч:, тайлан:, хуудас:, api:)';
      const key = trim(m[2]);
      if (kind === 'screen' && (!scrOf(key) || scrOf(key).type === 'page')) return `дэлгэц «${key}» screens.yaml-д алга`;
      if (kind === 'page' && scrOf(key)?.type !== 'page') return `хуудас «${key}» screens.yaml-д алга`;
      if (kind === 'report' && !reps.some((x) => trim(x?.name ?? '') === key)) return `тайлан «${key}» reports.yaml-д алга`;
      if (kind === 'api' && !asList(yaml['api.yaml']?.apis).some((x) => trim(x?.name ?? '') === key) && strict && !hasTable(key)) return `API «${key}» api.yaml-д (эсвэл ийм хүснэгт) алга`; // T3 WP-E
      if (kind === 'action') {
        const sl = key.indexOf('/'), s = sl < 0 ? null : scrOf(key.slice(0, sl)), n = key.slice(sl + 1);
        if (!asList(s?.actions).some((a) => a && ['label', 'transition', 'document', 'report', 'page', 'generate', 'process'].some((k) => trim(String(a[k] ?? '')) === n))) return `товч «${key}» (<дэлгэц>/<товчны нэр>) screens.yaml-д алга`;
      }
      return '';
    };
    for (const row of r.roles) {
      names.add(row.role);
      if (row.object) { const e = objectError(row.object); if (e) add('ref', 'error', 'role_object', rolesFile, row.line, `үүрэг «${row.role}» × «${row.object}» — ${e}`); continue; }
      if (strict && row.table !== '*' && !hasTable(row.table)) add('ref', 'error', 'ref_table', rolesFile, row.line, `үүрэг «${row.role}»: хүснэгт «${row.table}» алга`);
      if (strict && hasTable(row.table)) for (const c of [...row.hidden, ...row.readOnly]) if (!colsOf(row.table).has(c)) add('ref', 'error', 'ref_column', rolesFile, row.line, `үүрэг «${row.role}»: «${row.table}.${c}» багана алга`);
    }
  }

  // YAML файлуудын нэрлэгдсэн элементүүд (дэлгэц, тайлан, генератор, тооцоо …) ба `table:` лавлагаа
  for (const [f, v] of Object.entries(yaml)) {
    if (f === manifestFile) continue;
    collectNames(v, names);
    if (strict) walkKey(v, 'table', (val, parent) => {
      if (typeof val === 'string' && !hasTable(val) && !/[{}$]/.test(val)) add('ref', 'error', 'ref_table', f, lineOf(parent, 'table'), `хүснэгт «${val}» erd.dbml-д алга`);
    });
  }
  // баримтын загвар, тооцоо г.м. файлын нэр (documents/Кассын баримт.html)
  for (const f of Object.keys(files)) names.add(f.split('/').pop().replace(/\.[^.]+$/, ''));
  // Шаардлагын холбоос багцын файлыг бүхлээр нь заах (`roles.csv`, `documents/Баримт.html`) эсвэл мэдэгдлийн үйл явдал (`state_overdue`) байж болно
  for (const f of Object.keys(files)) { names.add(f); names.add(f.split('/').pop()); }
  for (const v of Object.values(yaml)) for (const n of Array.isArray(v?.notifications) ? v.notifications : []) if (typeof n?.event === 'string') names.add(n.event);
  // Баримтын загварын нэр — HTML-ийн эхний `<!-- name: Кассын баримт -->` (generateDocument, screens `document`-ийн нэр)
  for (const [f, text] of Object.entries(files)) {
    if (!/\.html?$/i.test(f)) continue;
    const m = /<!--\s*name:\s*([^\n]+?)\s*-->/.exec(text);
    if (m) names.add(m[1]);
  }
  // BPMN/DMN-ийн id ба name
  for (const [f, text] of Object.entries(files)) {
    if (!/\.(bpmn|dmn)$/i.test(f)) continue;
    if (!/<\/?(?:bpmn:|semantic:)?definitions[\s>]/.test(text)) add('parse', 'error', 'xml_root', f, 1, '<definitions> үндэс алга');
    for (const m of text.matchAll(/\b(?:id|name)="([^"]+)"/g)) names.add(m[1]);
  }

  // P12.5: seed/reference/defaults YAML — дээд түвшний утга мөрийн жагсаалт биш бол сервер алгасдаг (Package.cpp seed_shape)
  const dataListed = new Set(['seed', 'reference', 'defaults'].flatMap((k) => asList(listed[k])));
  for (const [f, v] of Object.entries(yaml)) {
    if (!(dataListed.has(f) || /^(seed|reference|defaults)\//.test(f)) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const [k, x] of Object.entries(v)) if (!Array.isArray(x) && x !== null && !(f.startsWith('seed') && ['organisations', 'groups'].includes(k)))
      add('parse', 'error', 'seed_shape', f, lineOf(v, k), `«${k}»: мөрүүдийн жагсаалт (\`- {…}\`) байх ёстой — сервер алгасна`);
    // PLAN8 C1.7: байгууллагын мод — `parent:` нь seed-ийн өөр байгууллага (сервер байгаа ST0005-ийн нэрийг ч хүлээнэ — анхааруулга)
    if (f.startsWith('seed') && Array.isArray(v.organisations)) {
      const orgNames = new Set(v.organisations.map((o) => o?.name).filter(Boolean));
      for (const o of v.organisations) if (o && typeof o.parent === 'string' && o.parent && (o.parent === o.name || !orgNames.has(o.parent)))
        add('ref', o.parent === o.name ? 'error' : 'warning', 'seed_parent', f, lineOf(o, 'parent'), `байгууллага «${o.name}»-ийн эх «${o.parent}» seed-д алга${o.parent === o.name ? ' (өөрөө өөрийнхөө эх)' : ' — байгаа байгууллагын нэр байх ёстой'}`);
    }
  }

  // ---- 2b. хоорондын шалгалт (PLAN14 A5): серверийн plan-ийн DB-ээс үл хамаарах шалгалтууд — crossref.mjs
  crossCheck({ files, yaml, fileOf, listed, tables: erdTables, foreignTables, foreignLedgers, foreignContexts, hasTable, strict, machines, required, add });

  // ---- 3. schema: каталогийн хаалттай схем (P12.1)
  if (catalog.available) {
    for (const [f, v] of Object.entries(yaml)) {
      const base = f.replace(/\.ya?ml$/i, '').split('/').pop();
      const listedAs = Object.keys(listed).find((k) => asList(listed[k]).includes(f));
      const kind = listedAs && listedAs !== 'seed' ? listedAs : f.startsWith('calc/') ? 'calc' : f.startsWith('i18n/') ? 'i18n' : base;
      const schema = catalog.schemas[kind];
      if (!schema) continue;
      const r = validateSchema(v, schema);
      for (const e of r.errors) add('schema', 'error', 'schema', f, e.line, `${e.path}: ${e.message}`);
    }
  } else add('schema', 'warning', 'catalog_missing', '', 0, `блокийн каталог (${CATALOG_DIR}) алга — бүтцийн шалгалт алгасав (PLAN12 P12.1)`);

  // ---- 4. coverage: шаардлага ↔ холбоос ↔ сценари
  const reqFile = fileOf('requirements', 'requirements.md');
  const reqs = reqFile ? parseRequirements(files[reqFile]) : [];
  if (!reqFile) add('file', 'error', 'requirements_missing', manifestFile, 0, 'requirements.md алга');
  const seen = new Map();
  let traced = 0;
  for (const r of reqs) {
    if (seen.has(r.id)) add('coverage', 'error', 'req_dup', reqFile, r.line, `шаардлага «${r.id}» давхардсан (${seen.get(r.id)}-р мөр)`);
    else seen.set(r.id, r.line);
    const links = r.links.map((l) => l.trim()).filter(Boolean);
    if (!links.length) { add('coverage', 'error', 'req_untraced', reqFile, r.line, `${r.id}: «Холбоос» хоосон — хэрэгжүүлэх элемент алга`); continue; }
    traced++;
    for (const l of links) {
      const cap = /^\(платформ(?::\s*(.+))?\)$/.exec(l);
      if (cap) { if (cap[1] && catalog.available && !catalog.capabilities.has(cap[1].trim())) add('coverage', 'error', 'req_capability', reqFile, r.line, `${r.id}: платформын чадвар «${cap[1].trim()}» каталогт алга`); continue; }
      if (/^manifest\./.test(l)) continue;
      const name = l.replace(/^[a-z][\w.-]*:\s*/i, ''); // «calc: Үлдэгдэл», «roles.csv: …» — төрлийн угтвар
      const state = /^(.+?)\s*\[(.+)\]$/.exec(name); // «Машин [Төлөв]»
      if (state ? names.has(state[1]) && names.has(state[2]) : names.has(name) || hasTable(name.split('.')[0])) continue;
      if (true) add('coverage', 'warning', 'req_link', reqFile, r.line, `${r.id}: холбоос «${l}» багцын элемент рүү шийдэгдсэнгүй`);
    }
  }
  const accFile = [manifest.acceptance, 'acceptance.md'].find((f) => typeof f === 'string' && files[f] !== undefined); // manifest-ийн дээд түвшний `acceptance`
  const covered = new Set();
  if (accFile) {
    for (const s of parseAcceptance(files[accFile])) {
      if (!s.requirements) continue;
      for (const id of s.requirements) {
        if (!seen.has(id)) add('coverage', 'error', 'scenario_req', accFile, s.line, `сценари ${s.no}: шаардлага «${id}» алга`);
        else covered.add(id);
      }
    }
    for (const [id, line] of seen) if (!covered.has(id)) add('coverage', 'warning', 'req_uncovered', reqFile, line, `${id}: хүлээн авах сценари алга`);
  } else if (reqs.length) add('coverage', 'warning', 'acceptance_missing', manifestFile, 0, 'acceptance.md алга — шаардлагын сценарийн хамралт шалгагдахгүй');

  return result(findings, { requirements: seen.size, traced, covered: covered.size, tables: tables.size, files: Object.keys(files).length });
}

function result(findings, stats) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  return { ok: errors === 0, errors, warnings, findings, stats: { requirements: 0, traced: 0, covered: 0, tables: 0, ...stats } };
}

function walkDups(v, fn) {
  if (!v || typeof v !== 'object') return;
  for (const d of duplicateKeys(v)) fn(d.key, d.line);
  for (const x of Object.values(v)) walkDups(x, fn);
}

function walkKey(v, key, fn, parent = null) {
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, key)) fn(v[key], v);
  for (const x of Object.values(v)) walkKey(x, key, fn, v);
}

// id/name/key/title түлхүүрийн утга, мөн нэрлэгдсэн map-ийн түлхүүрүүд (screens: {branch-form: …})
function collectNames(v, out) {
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v)) {
    for (const k of ['id', 'name', 'key', 'title', 'code']) if (typeof v[k] === 'string') out.add(v[k]);
    for (const [k, x] of Object.entries(v)) { if (x && typeof x === 'object') out.add(k); collectNames(x, out); }
  } else for (const x of v) collectNames(x, out);
}
