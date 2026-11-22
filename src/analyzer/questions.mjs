// PLAN15 C1/C2 — шинжилгээний олдвор → бизнесийн асуулт (questions.yaml). Детерминист, LLM-гүй.
// Асуултын id = олдворын id-ийн hash (`F-x` → `Q-x`): мөрийн дугаараас үл хамаарна → дахин ажиллуулахад давхардахгүй (idempotent).
// Нэгтгэл (sync): хуучин асуултын хариулт/төлвийг хадгална; алга болсон олдворын нээлттэй/хариулсан асуулт → resolved; дахин гарвал resolved → open.
import { parseDocument, visit } from '../validator/vendor/yaml.mjs';
import { loadYaml } from '../validator/yaml.mjs';
import { CODES, severityRank } from './codes.mjs';
import { slotDefs, fillQuestion } from './checks/slots.mjs';
import { columnIndex } from './checks/predicates.mjs';

export const QUESTIONS_FILE = 'questions.yaml';
export const STATUSES = ['open', 'answered', 'assumed', 'dismissed', 'resolved'];
// асуулт болохгүй олдвор: дэд бүтэц ба хэрэгслийн хязгаар
// IR-ийн хэлбэр/эх/байхгүй — IR бичигчийн (агент, шинжээч) засах зүйл, бизнесийн асуулт биш
const SKIP = new Set(['AN-INPUT-INVALID', 'AN-CHECK-FAILED', 'DMN-NOT-ANALYZED', 'IR-INVALID', 'IR-SOURCE-UNKNOWN', 'IR-MISSING']);
const str = (v) => String(v ?? '').trim();
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

// элементийн лавлагааг задлах: {kind, name, machine, state, table, column, caption, from}
export function parseElement(el) {
  const i = el.indexOf(':'), kind = el.slice(0, i), rest = el.slice(i + 1);
  if (kind === 'state') { const m = /^(.+) \[(.+)\]$/.exec(rest); return { kind, machine: m?.[1], state: m?.[2], name: m?.[2] ?? rest }; }
  if (kind === 'transition') { const m = /^(.+?)\/(.+?)(?: @(.+))?$/.exec(rest); return { kind, machine: m?.[1], caption: m?.[2], from: m?.[3], name: m?.[2] ?? rest }; }
  if (kind === 'column') { const j = rest.indexOf('.'); return { kind, table: rest.slice(0, j), column: rest.slice(j + 1), name: rest }; }
  if (kind === 'decision' || kind === 'process') { const j = rest.lastIndexOf('#'); return { kind, file: rest.slice(0, j), name: rest.slice(j + 1) }; }
  if (kind === 'machine') return { kind, machine: rest, name: rest };
  if (kind === 'table') return { kind, table: rest, name: rest };
  return { kind, name: rest };
}

const machineOf = (model, name) => model.machines.find((m) => m.name === name);
const roleNames = (model) => uniq(model.roles.filter((r) => r.role && !r.role.startsWith('@') && !r.object).map((r) => r.role));
const whoOf = (m) => uniq((m?.transitions ?? []).flatMap((t) => str(t.who).split(',').map(str)).filter((w) => w && w.toLowerCase() !== 'процесс'));
// олдворын discriminator жижиг үсэгтэй (`худалдан авалт`) — roles.csv-ийн анхны бичлэгээр
const roleCase = (model, r) => roleNames(model).find((x) => x.toLowerCase() === str(r).toLowerCase()) ?? r;
const rolesOnTable = (model, t) => uniq(model.roles.filter((r) => r.table === t && !r.object && !r.role.startsWith('@')).map((r) => r.role));

// код бүрийн бизнесийн асуулт ба сонголт (f — олдвор, e — задалсан элемент)
const ASK = {
  // E — эх баримтын IR
  'IR-PARA-UNCOVERED': (f) => ({ ask: `Эх баримтын ${f.message.replace(/ — IR-д буугаагүй$/, '')} — энэ хэсэг системд тусгах шаардлага агуулж байна уу?`, options: ['Тийм — шаардлага (IR-д нэмнэ)', 'Үгүй — тайлбар/оршил (ignored)'] }),
  'IR-QUOTE-NOTFOUND': (f) => ({ ask: `${f.message.replace(/ үгчлэн алга.*$/, '')} гэж эх баримтад бичигдээгүй — энэ шаардлага зөв үү (таамаг)?`, options: ['Зөв — таамгийг батална', 'Буруу — хасна'] }),
  'IR-ASSUMED': (f) => ({ ask: `${f.message.replace(/^([^:]+): таамаг — /, '$1: ').replace(/ эх баримтад шууд байхгүй$/, '')} — эх баримтад байхгүй энэ шаардлагыг батлах уу?`, options: ['Батална', 'Хасна'] }),
  // D — brd.md (загварт хэл) ↔ загвар; хариултыг `bj cnl apply` эсвэл гараар буулгана
  'CNL-NOT-MODELED': (f) => ({ ask: `${f.message.replace(/ — загварт алга$/, '')} гэж BRD-д бичсэн — загварт нэмэх үү?`, options: ['Тийм — загварт нэмнэ (bj cnl apply)', 'Үгүй — BRD-ийн өгүүлбэрийг засна'] }),
  'CNL-CONFLICT': (f) => ({ ask: `${f.message.replace(/ — загвар эсрэгээр.*$/, '')} гэж BRD-д бичсэн боловч загвар эсрэг — аль нь зөв бэ?`, options: ['BRD зөв — загварыг засна', 'Загвар зөв — BRD-ийг засна'] }),
  'SM-UNREACHABLE': (f, e, M) => ({ ask: `«${e.machine}»-д «${e.state}» төлөвт бичлэг хэрхэн орох вэ — аль төлвөөс, ямар үйлдлээр (товчоор)? Эсвэл энэ төлөв хэрэггүй юу?`,
    options: [...(machineOf(M, e.machine)?.states ?? []).map((s) => s.name).filter((s) => s !== e.state).map((s) => `${s}-аас шилжинэ`), 'Төлөв хэрэггүй — хасна'] }),
  'SM-DEAD-END': (f, e, M) => ({ ask: `«${e.machine}»-ийн «${e.state}» төлөвт хүрсэн бичлэг цааш юу болох вэ — энэ нь эцсийн төлөв үү, эсвэл аль төлөв рүү шилжих вэ?`,
    options: ['Эцсийн төлөв', ...(machineOf(M, e.machine)?.states ?? []).map((s) => s.name).filter((s) => s !== e.state).map((s) => `${s} рүү шилжинэ`)] }),
  'SM-NO-PATH-TO-FINAL': (f, e, M) => ({ ask: `«${e.machine}»-ийн «${e.state}» төлөвөөс бичлэг хэрхэн хаагдах (дуусах) вэ?`, options: (machineOf(M, e.machine)?.states ?? []).filter((s) => s.final).map((s) => `${s.name} рүү шилжинэ`) }),
  'SM-FINAL-UNMARKED': (f, e) => ({ ask: `«${e.machine}»-ийн «${e.state}» (түгжигдсэн) нь бичлэгийн эцсийн төлөв мөн үү?`, options: ['Тийм, эцсийн', 'Үгүй — цааш шилжинэ'] }),
  'SM-NO-FINAL': (f, e, M) => ({ ask: `«${e.machine}»-ийн бичлэг аль төлөвт хаагдах (дуусах) вэ?`, options: (machineOf(M, e.machine)?.states ?? []).map((s) => s.name) }),
  'SM-AMBIGUOUS': (f, e) => ({ ask: `«${e.machine}»-д «${e.from}»-өөс «${e.caption}» товч хэд хэдэн газар хүргэдэг — аль нөхцөлд аль нь болох вэ (эсвэл товчийг өөр нэрлэх үү)?`, options: [] }),
  'SM-NO-ACTOR': (f, e, M) => ({ ask: `«${e.machine}»-ийн «${e.caption}» (${e.from}-оос) үйлдлийг хэн (аль үүрэг) хийх вэ?`, options: roleNames(M) }),
  'PERM-TRANSITION-NOWRITE': (f, e, M) => ({ ask: `«${e.machine}»-ийн «${e.caption}»-ийг «${roleCase(M, f.discriminator)}» хийх ёстой юу? Тийм бол тэр үүрэгт засах эрх өгөх үү, эсвэл өөр үүрэг хийх үү?`, options: ['Засах эрх өгнө', 'Өөр үүрэг хийнэ'] }),
  'PERM-CREATE-NOCREATE': (f, e, M) => ({ ask: `«${e.machine}»-ийн бичлэгийг «${roleCase(M, f.discriminator)}» үүсгэх ёстой юу? Тийм бол үүсгэх эрх өгөх үү?`, options: ['Үүсгэх эрх өгнө', 'Өөр үүрэг үүсгэнэ'] }),
  'PERM-TASK-NOVIEW': (f, e, M) => ({ ask: `«${e.name}» даалгаврыг «${roleCase(M, f.discriminator)}» гүйцэтгэхдээ бичлэгийг харах ёстой юу?`, options: ['Харах эрх өгнө', 'Өөр бүлэгт оноох'] }),
  'PERM-SCREEN-NOVIEW': (f, e, M) => ({ ask: `«${e.name}» дэлгэцийг «${roleCase(M, f.discriminator)}» ашиглах уу? Тийм бол тэр үүрэгт харах эрх өгөх үү?`, options: ['Харах эрх өгнө', 'Дэлгэцээс үүргийг хасна'] }),
  'PERM-TABLE-NOCREATOR': (f, e, M) => ({ ask: `«${e.table}»-ийн бичлэгийг хэн үүсгэх вэ (эсвэл систем — seed, генератор, интеграц)?`, options: [...roleNames(M), 'Систем (өөр багц/интеграц)'] }),
  'DMN-OVERLAP': (f, e) => ({ ask: `«${e.name}» шийдвэрт нэг тохиолдолд хоёр дүрэм таарч байна — аль нь давуу вэ, эсвэл мужийг яаж ялгах вэ?`, options: ['Эхний таарсан дүрэм (FIRST)', 'Мужийг ялгана'] }),
  'DMN-GAP': (f, e) => ({ ask: `«${e.name}» шийдвэрт дүрэмгүй тохиолдол бий — тэр үед ямар шийдвэр гарах вэ?`, options: [] }),
  'DMN-SHADOWED': (f, e) => ({ ask: `«${e.name}» шийдвэрийн нэг дүрэм хэзээ ч ажиллахгүй — дарааллыг солих уу, хасах уу?`, options: ['Дарааллыг солино', 'Дүрмийг хасна'] }),
  'DMN-NEVER-MATCHES': (f, e) => ({ ask: `«${e.name}» шийдвэрийн нэг дүрэм ямар ч тохиолдолд таарахгүй — нөхцөлийг яаж засах вэ?`, options: [] }),
  'X0-ENUM-LITERAL': (f, e, M) => {
    const m = /^[^:]+:(.+)=(.*)$/.exec(f.discriminator ?? '');
    const table = e.table ?? (e.machine ? machineOf(M, e.machine)?.table : null);
    const col = m && table ? columnIndex(M, table).get(m[1]) : null;
    return { ask: `«${m?.[2] ?? ''}» гэж бичсэн утга «${m?.[1] ?? ''}»-ийн утгуудад алга — аль утгыг хэлсэн бэ (эсвэл шинэ утга нэмэх үү)?`, options: [...(col?.enumValues ?? []).map(String), `«${m?.[2] ?? ''}»-г шинэ утгаар нэмнэ`] };
  },
  'X0-NEVER-TRUE': (f, e) => ({ ask: `«${e.name}»-ийн нөхцөл хэзээ ч биелэхгүй байна — ямар нөхцөлд энэ ${f.discriminator === 'guard' ? 'шилжилт хийгдэх' : 'дүрэм хэрэгжих'} ёстой вэ?`, options: [] }),
  'X0-REQUIRED-HIDDEN': (f, e) => ({ ask: `«${e.name}» заавал атлаа зарим тохиолдолд харагдахгүй — тэр тохиолдолд заавал байх уу, харагдах уу?`, options: ['Тэр үед харагдана', 'Тэр үед заавал биш'] }),
  'X0-GUARD-OVERLAP': (f, e) => ({ ask: `«${e.machine}»-ийн «${e.caption}» товчны нөхцөлүүд давхацдаг — нэг тохиолдолд аль шилжилт хийгдэх вэ?`, options: [] }),
  'COV-P1-UNTESTED': (f, e) => ({ ask: `${e.name} (заавал) шаардлага хэрэгжсэнийг ямар сценариар шалгах вэ — алхам ба хүлээгдэх үр дүн?`, options: [] }),
  'COV-REQUIRED-NOFORM': (f, e) => ({ ask: `«${e.table}.${e.column}» заавал боловч маягтад алга — хэрэглэгч оруулах уу, анхдагч утгатай байх уу, эсвэл заавал биш үү?`, options: ['Маягтад нэмнэ', 'Анхдагч утга өгнө', 'Заавал биш'] }),
  'COV-UNTRACED': (f, e) => ({ ask: `«${e.name}» аль шаардлагаас үүссэн бэ (эсвэл хэрэггүй юу)?`, options: [...uniq(((/текстэд дурдсан: ([^)]+)\)/.exec(f.message)?.[1]) ?? '').split(',').map(str)), 'Шинэ шаардлага', 'Хэрэггүй — хасна'] }),
};

function audienceOf(model, f, e) {
  if (e.machine) return whoOf(machineOf(model, e.machine));
  if (e.table) return rolesOnTable(model, e.table);
  return [];
}

// процессын лавлагаа нь id-тай (`process:f.bpmn#Process_X`) — асуултад BPMN-ийн нэрийг (`name="…"`)
function processName(model, file, id) {
  const b = model.bpmn.find((x) => x.file === file);
  const m = b && new RegExp(`<(?:bpmn2?:)?process\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(b.text);
  return (m && /\bname="([^"]+)"/.exec(m[0])?.[1]) || id;
}

// олдвор → асуулт (статусгүй хэсэг)
export function questionFor(f, model) {
  const e = parseElement(f.element);
  if (e.kind === 'process') e.name = processName(model, e.file, e.name);
  const slot = f.code === 'SLOT-MISSING' ? slotDefs().find((s) => s.id === f.discriminator) : null;
  let q;
  if (slot) {
    const opts = { roles: roleNames(model), states: e.machine ? (machineOf(model, e.machine)?.states ?? []).map((s) => s.name) : [],
      columns: e.table ? (model.tables.get(e.table)?.columns ?? []).map((c) => c.name) : [], tables: [...model.tables.keys()] }[slot.options] ?? [];
    q = { ask: fillQuestion(slot, e.name), options: opts };
  } else q = (ASK[f.code] ?? ((ff) => ({ ask: `${ff.message} — яаж шийдэх вэ?`, options: [] })))(f, e, model);
  const out = { id: `Q-${f.id.slice(2)}`, code: f.code };
  if (slot) out.slot = slot.id;
  Object.assign(out, { element: f.element, severity: f.severity, ask: q.ask });
  // subject — patch (C3)-ийн тодорхой зорилт: эрхийн кодод үүрэг, enum-д «багана=буруу утга»
  if (/^PERM-(TRANSITION|CREATE|TASK|SCREEN)-/.test(f.code) && f.discriminator) out.subject = roleCase(model, f.discriminator);
  if (f.code === 'X0-ENUM-LITERAL') { const m = /^[^:]+:(.+=.*)$/.exec(f.discriminator ?? ''); if (m) out.subject = m[1]; }
  const options = uniq(q.options ?? []);
  if (options.length) out.options = options;
  out.impact = slot ? `${slot.title} BRD-д шийдэгдээгүй — ${CODES[f.code].why}` : CODES[f.code].why;
  const aud = audienceOf(model, f, e);
  if (aud.length) out.audience = aud;
  if (f.file) out.file = f.file;
  if (f.line) out.line = f.line;
  return out;
}

export const questionsFrom = (analysis, model) => analysis.findings.filter((f) => !SKIP.has(f.code)).map((f) => questionFor(f, model));

const order = (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.element.localeCompare(b.element) || a.id.localeCompare(b.id);
const KEYS = ['id', 'code', 'slot', 'element', 'subject', 'severity', 'ask', 'options', 'impact', 'audience', 'file', 'line', 'status', 'answer', 'answered_by', 'confirmed_by', 'at', 'resolved_at', 'applied_at', 'patch', 'note'];
const ordered = (q) => Object.fromEntries(KEYS.filter((k) => q[k] !== undefined && q[k] !== null && !(Array.isArray(q[k]) && !q[k].length)).map((k) => [k, q[k]]));

// existing: questions.yaml-ийн утга (эсвэл null), generated: questionsFrom(...) → {doc, changes}
export function mergeQuestions(existing, generated, { now = new Date().toISOString() } = {}) {
  const old = new Map((existing?.questions ?? []).filter((q) => q && q.id).map((q) => [q.id, q]));
  const changes = { added: [], reopened: [], resolved: [], kept: 0 };
  const out = [];
  const seen = new Set();
  for (const g of generated) {
    seen.add(g.id);
    const o = old.get(g.id);
    if (!o) { out.push({ ...g, status: 'open' }); changes.added.push(g.id); continue; }
    const keep = Object.fromEntries(['status', 'answer', 'answered_by', 'confirmed_by', 'at', 'resolved_at', 'applied_at', 'patch', 'note'].filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
    if (keep.status === 'resolved') { keep.status = keep.answer !== undefined ? 'answered' : 'open'; delete keep.resolved_at; changes.reopened.push(g.id); } else changes.kept++;
    out.push({ ...g, ...keep });
  }
  for (const [id, o] of old) {
    if (seen.has(id)) continue;
    if (o.status === 'open' || o.status === 'answered' || o.status === 'assumed') { out.push({ ...o, status: 'resolved', resolved_at: now }); changes.resolved.push(id); } else out.push(o);
  }
  return { doc: { version: 1, questions: out.map(ordered).sort(order) }, changes };
}

export function parseQuestions(text) {
  if (text === undefined || text === null || !str(text)) return null;
  const r = loadYaml(text);
  if (r.error) throw new Error(`${QUESTIONS_FILE}: ${r.error}`);
  return r.value;
}

// платформын YAML (Yaml.cpp) хашилтгүй `yes`, `null`, тоо г.м.-ийг өөр төрөл болгодог тул ийм мөрийг хашилтаар бичнэ
const COERCED = /^(true|True|TRUE|yes|Yes|false|False|FALSE|no|No|null|Null|NULL|~|-?[0-9]+(\.[0-9]+)?)$/;
export function renderQuestions(doc) {
  const d = parseDocument('');
  d.contents = d.createNode(doc);
  visit(d, { Scalar(_, node) { if (typeof node.value === 'string' && (COERCED.test(node.value) || node.value === '')) node.type = 'QUOTE_DOUBLE'; } });
  return `# Бизнесийн асуулт ба хариулт (PLAN15 C) — \`bj questions sync\` үүсгэж шинэчилнэ; status/answer/answered_by/note-ийг засаж хариулна.\n${d.toString({ lineWidth: 0 })}`;
}

// хариулах: status answered (хүн) | assumed (агент — хүн батлах хүртэл)
export function answerQuestion(doc, id, answer, { by = '', agent = false, now = new Date().toISOString() } = {}) {
  const q = doc?.questions?.find((x) => x.id === id);
  if (!q) throw new Error(`асуулт ${id} алга`);
  Object.assign(q, { status: agent ? 'assumed' : 'answered', answer, at: now });
  if (by) q.answered_by = agent && !by.startsWith('agent:') ? `agent:${by}` : by;
  return q;
}
export function confirmQuestion(doc, id, by, { now = new Date().toISOString() } = {}) {
  const q = doc?.questions?.find((x) => x.id === id);
  if (!q) throw new Error(`асуулт ${id} алга`);
  if (q.status !== 'assumed') throw new Error(`${id}: зөвхөн assumed асуултыг батална (одоо ${q.status})`);
  Object.assign(q, { status: 'answered', confirmed_by: by, at: now });
  return q;
}
// агентын саналыг татгалзах: assumed → open (хариулт арилна, саналыг note-д үлдээнэ)
export function rejectQuestion(doc, id, { by = '', now = new Date().toISOString() } = {}) {
  const q = doc?.questions?.find((x) => x.id === id);
  if (!q) throw new Error(`асуулт ${id} алга`);
  if (q.status !== 'assumed') throw new Error(`${id}: зөвхөн assumed асуултын саналыг татгалзана (одоо ${q.status})`);
  const note = `татгалзсан санал${by ? ` (${by})` : ''}: ${JSON.stringify(q.answer)}${q.answered_by ? ` — ${q.answered_by}` : ''}`;
  for (const k of ['answer', 'answered_by', 'confirmed_by']) delete q[k];
  Object.assign(q, { status: 'open', note, at: now });
  return q;
}
export function dismissQuestion(doc, id, note, { now = new Date().toISOString() } = {}) {
  const q = doc?.questions?.find((x) => x.id === id);
  if (!q) throw new Error(`асуулт ${id} алга`);
  Object.assign(q, { status: 'dismissed', note: str(note) || 'хамаарахгүй', at: now });
  return q;
}
