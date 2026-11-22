// PLAN15 A0 — шинжилгээний загвар: багцын файлуудыг validator-ийн задлагчаар (`scripts/validate/`, өөрчлөхгүй) нэг объект болгоно.
// Шалгалтууд (A1–A5) зөвхөн энэ загварыг уншина — файл дахин задлахгүй. Элемент бүр `ref` (finding.schema.json `element`) ба файл/мөртэй.
import { loadYaml, lineOf } from '../validator/yaml.mjs';
import { parseDbml } from '../validator/dbml.mjs';
import { parseRequirements, parseAcceptance, parseRoles, parseStates, parseCsv } from '../validator/parsers.mjs';

const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => String(v ?? '').trim();

// Элементийн лавлагаа — README «Элементийн лавлагаа»
export const ref = {
  package: (key) => `package:${key}`,
  table: (t) => `table:${t}`,
  column: (t, c) => `column:${t}.${c}`,
  machine: (m) => `machine:${m}`,
  state: (m, s) => `state:${m} [${s}]`,
  transition: (m, caption, from) => `transition:${m}/${caption}${from ? ` @${from}` : ''}`,
  role: (r) => `role:${r}`,
  requirement: (id) => `requirement:${id}`,
  scenario: (no) => `scenario:${no}`,
  screen: (id) => `screen:${id}`,
  report: (n) => `report:${n}`,
  decision: (file, id) => `decision:${file}#${id}`,
  process: (file, id) => `process:${file}#${id}`,
  file: (f) => `file:${f}`,
};

// files: {<харьцангуй зам>: текст} → загвар. Задлагдаагүй хэсэг алгасагдана (validate тэдгээрийг алдаа гэж мэдээлдэг).
export function buildModel(files) {
  const yamlOf = (f) => { const r = files[f] === undefined ? null : loadYaml(files[f]); return r && !r.error ? r.value : null; };
  const manifestFile = files['manifest.yaml'] !== undefined ? 'manifest.yaml' : files['manifest.yml'] !== undefined ? 'manifest.yml' : null;
  const manifest = (manifestFile && yamlOf(manifestFile)) || {};
  const listed = manifest.files && typeof manifest.files === 'object' ? manifest.files : {};
  const fileOf = (kind, dflt) => asList(listed[kind] ?? dflt).find((f) => typeof f === 'string' && files[f] !== undefined) ?? null;

  const model = {
    key: str(manifest.key), name: str(manifest.name), manifest, manifestFile,
    files: Object.keys(files).sort(),
    tables: new Map(), machines: [], roles: [], requirements: [], scenarios: [],
    screens: [], reports: [], bpmn: [], dmn: [], yaml: {},
    source: {},
  };

  const erdFile = fileOf('erd', 'erd.dbml');
  if (erdFile) {
    const d = parseDbml(files[erdFile]);
    if (!d.error) for (const t of d.tables) model.tables.set(t.name, { ...t, file: erdFile });
  }
  const statesFile = fileOf('states', 'states.mmd');
  if (statesFile) for (const m of parseStates(files[statesFile]).machines) model.machines.push({ ...m, file: statesFile });
  const rolesFile = fileOf('roles', 'roles.csv');
  if (rolesFile) {
    // `raw` — эрхийн нүдний анхны утга (`-` хоригийг parseRoles boolean болгож алддаг)
    const rawByLine = new Map(parseCsv(files[rolesFile]).map((r) => [r.line, r.cells]));
    for (const r of parseRoles(files[rolesFile]).roles) {
      const c = rawByLine.get(r.line) ?? [];
      const raw = Object.fromEntries(['view', 'create', 'update', 'remove'].map((k, i) => [k, str(c[i + 2]).toLowerCase()]));
      model.roles.push({ ...r, raw, file: rolesFile });
    }
  }
  const reqFile = fileOf('requirements', 'requirements.md');
  if (reqFile) for (const r of parseRequirements(files[reqFile])) model.requirements.push({ ...r, file: reqFile });
  const accFile = [manifest.acceptance, 'acceptance.md'].find((f) => typeof f === 'string' && files[f] !== undefined);
  if (accFile) for (const s of parseAcceptance(files[accFile])) model.scenarios.push({ ...s, file: accFile });

  for (const f of model.files) if (/\.ya?ml$/i.test(f) && f !== manifestFile) { const v = yamlOf(f); if (v !== null) model.yaml[f] = v; }
  const screensFile = model.files.find((f) => /^screens\.ya?ml$/i.test(f));
  if (screensFile) {
    const v = model.yaml[screensFile]?.screens;
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v).map(([id, x]) => ({ id, ...x })) : [];
    for (const s of list) if (s && typeof s === 'object') model.screens.push({ ...s, file: screensFile, line: lineOf(s) });
  }
  const reportsFile = model.files.find((f) => /^reports\.ya?ml$/i.test(f));
  if (reportsFile) for (const r of asList(model.yaml[reportsFile]?.reports)) if (r && typeof r === 'object') model.reports.push({ ...r, file: reportsFile, line: lineOf(r) });

  // BPMN/DMN — A0-д зөвхөн текст ба үндсэн id; A2/A3 өөрийн задлагчтай болно
  for (const f of model.files) {
    if (/\.bpmn$/i.test(f)) model.bpmn.push({ file: f, text: files[f] });
    else if (/\.dmn$/i.test(f)) model.dmn.push({ file: f, text: files[f] });
  }
  // Нотолгооны мөр (evidence) авахад
  for (const f of model.files) model.source[f] = files[f];
  return model;
}

// Файлын мөрийн текст (evidence) — 1-ээс эхэлнэ; ≤ 300 тэмдэгт
export function lineText(model, file, line) {
  const t = model.source[file];
  if (typeof t !== 'string' || !line) return '';
  const s = t.split('\n')[line - 1] ?? '';
  return s.length > 300 ? `${s.slice(0, 297)}...` : s.trimEnd();
}
