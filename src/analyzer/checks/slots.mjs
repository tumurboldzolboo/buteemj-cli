// PLAN15 B1/B2 — бүрэн гүйцэд байдлын мета-загвар (docs/brd-standard/slots.yaml → ../slots.data.mjs).
// Илрүүлэгч бүр: model → [{element, name, file, line, filled}] — зөвхөн тухайн слот хамаарах элементүүд. Детерминист, LLM-гүй.
// `coveredBy`-тэй слот — A шатны код аль хэдийн мэдээлдэг: SLOT-MISSING гаргахгүй, зөвхөн бүрэн гүйцэд байдлын тоонд орно.
// completeness(model) → {score, filled, applicable, bySlot, byElement, crud, missing[]} (B2).
import { ref } from '../model.mjs';
import SLOTS from '../slots.data.mjs';
import { permIndex, filledTables } from './permissions.mjs';
import { CORE_TABLES } from '../../validator/compile.mjs';

const str = (v) => String(v ?? '').trim();
const low = (v) => str(v).toLowerCase();
const REJECT = /цуцл|татгалз|буца|хүчингүй|reject|cancel/i;
const isChild = (t) => t.columns.some((c) => (c.tags ?? []).some((g) => String(g.tag).toLowerCase() === 'parent'));
const ownTables = (model) => [...model.tables.entries()].filter(([n]) => !CORE_TABLES.has(n));
const processes = (model) => model.bpmn.flatMap((b) => [...b.text.matchAll(/<(?:bpmn2?:)?process\b([^>]*)>([\s\S]*?)<\/(?:bpmn2?:)?process>/g)].map((m) => ({
  file: b.file, id: /\bid="([^"]*)"/.exec(m[1])?.[1] ?? '', name: /\bname="([^"]*)"/.exec(m[1])?.[1] ?? '', attrs: m[1], body: m[2], line: b.text.slice(0, m.index).split('\n').length,
})));
// лавлах өгөгдөл (reference/*.yaml|csv) — платформын каталог: устгах бодлого хамаарахгүй
const referenceTables = (model) => new Set([
  ...Object.entries(model.yaml).filter(([f, v]) => /^reference\//.test(f) && v && typeof v === 'object').flatMap(([, v]) => Object.keys(v)),
  ...model.files.filter((f) => /^reference\/[^/]+\.csv$/i.test(f)).map((f) => f.split('/').pop().replace(/\.csv$/i, '')),
]);
export function reachableFinals(m) {
  const init = m.states.find((s) => s.initial);
  if (!init) return m.states.filter((s) => s.final).length;
  const seen = new Set([init.name]);
  for (const st = [init.name]; st.length;) { const x = st.pop(); for (const t of m.transitions) if (t.from === x && !seen.has(t.to)) { seen.add(t.to); st.push(t.to); } }
  return m.states.filter((s) => s.final && seen.has(s.name)).length;
}
export { REJECT };
const procEl = (p) => ({ element: ref.process(p.file, p.id || p.name), name: p.name || p.id, file: p.file, line: p.line });

export const DETECTORS = {
  tableCreator(model) {
    const P = permIndex(model), filled = filledTables(model);
    return ownTables(model).map(([n, t]) => ({ element: ref.table(n), name: n, file: t.file, line: t.line, filled: filled.has(n) || [...P.known.keys()].some((r) => P.can(r, n, 'create')) }));
  },
  tableViewer(model) {
    if (!model.roles.length) return [];
    const P = permIndex(model);
    return ownTables(model).map(([n, t]) => ({ element: ref.table(n), name: n, file: t.file, line: t.line, filled: [...P.known.keys()].some((r) => P.can(r, n, 'view')) }));
  },
  tableKey(model) {
    return ownTables(model).filter(([, t]) => !isChild(t)).map(([n, t]) => ({ element: ref.table(n), name: n, file: t.file, line: t.line,
      filled: (t.uniques ?? []).length > 0 || t.columns.some((c) => c.unique || c.pk || (c.tags ?? []).some((g) => ['unique', 'numbering'].includes(String(g.tag).toLowerCase()))) }));
  },
  tableDeleter(model) {
    if (!model.roles.length) return [];
    const P = permIndex(model), refs = referenceTables(model);
    return ownTables(model).filter(([n, t]) => !isChild(t) && !refs.has(n) && !model.machines.some((m) => m.table === n) && [...P.known.keys()].some((r) => P.can(r, n, 'create')))
      .map(([n, t]) => ({ element: ref.table(n), name: n, file: t.file, line: t.line,
        filled: model.roles.some((r) => (r.table === n || r.table === '*') && !r.object && (r.remove || r.raw?.remove === '-')) }));
  },
  machineFinal: (model) => model.machines.filter((m) => m.states.filter((s) => s.initial).length === 1)
    .map((m) => ({ element: ref.machine(m.name), name: m.name, file: m.file, line: m.line, filled: m.states.some((s) => s.final) })),
  // татгалзах/цуцлах/буцаах нэртэй шилжилт, эсвэл анхны төлвөөс хүрэх 2+ эцсийн төлөв (өөр төгсгөл)
  machineReject: (model) => model.machines.map((m) => ({ element: ref.machine(m.name), name: m.name, file: m.file, line: m.line,
    filled: m.transitions.some((t) => !t.create && (REJECT.test(t.caption) || REJECT.test(t.to))) || reachableFinals(m) >= 2 })),
  machineActor: (model) => model.machines.map((m) => ({ element: ref.machine(m.name), name: m.name, file: m.file, line: m.line,
    filled: m.transitions.filter((t) => !t.create && t.from !== '[*]' && !t.autoAfter && !t.autoWhen).every((t) => str(t.who)) })),
  processEnd: (model) => processes(model).map((p) => ({ ...procEl(p), filled: /<(?:bpmn2?:)?endEvent\b/.test(p.body) })),
  processTrigger(model) {
    const started = new Set(model.machines.flatMap((m) => m.transitions.flatMap((t) => (t.actions ?? []).filter((a) => a.name === 'startProcess').map((a) => str(a.arg)))));
    const screens = JSON.stringify(model.screens);
    return processes(model).map((p) => ({ ...procEl(p),
      filled: /buteemj:startOn=|<(?:bpmn2?:)?(?:messageEventDefinition|timerEventDefinition|signalEventDefinition|conditionalEventDefinition)\b/.test(p.body)
        || /\bbuteemj:category="[^"]+"/.test(p.attrs) || started.has(p.name) || started.has(p.id) || (!!p.name && screens.includes(`"${p.name}"`)) }));
  },
  processTimeout: (model) => processes(model).filter((p) => /<(?:bpmn2?:)?userTask\b/.test(p.body))
    .map((p) => ({ ...procEl(p), filled: /<(?:bpmn2?:)?timerEventDefinition\b/.test(p.body) })),
  requirementTrace: (model) => model.requirements.map((r) => ({ element: ref.requirement(r.id), name: r.id, file: r.file, line: r.line, filled: (r.links ?? []).some((l) => str(l)) })),
  requirementAcceptance(model) {
    if (!model.scenarios.some((s) => Array.isArray(s.requirements))) return [];
    const covered = new Set(model.scenarios.flatMap((s) => s.requirements ?? []));
    return model.requirements.filter((r) => str(r.priority) === '1').map((r) => ({ element: ref.requirement(r.id), name: r.id, file: r.file, line: r.line, filled: covered.has(r.id) }));
  },
  packageRoles: (model) => [{ element: ref.package(model.key || '?'), name: model.key, file: model.manifestFile ?? 'manifest.yaml', line: 0, filled: model.roles.length > 0 }],
  packageAcceptance: (model) => [{ element: ref.package(model.key || '?'), name: model.key, file: model.manifestFile ?? 'manifest.yaml', line: 0,
    filled: model.scenarios.length > 0 && model.scenarios.some((s) => Array.isArray(s.requirements)) }],
};

export const slotDefs = () => SLOTS.slots;
export const fillQuestion = (slot, name) => str(slot.question).replace(/\{name\}/g, name);

// B2 — бүрэн гүйцэд байдал
export function completeness(model) {
  const bySlot = {}, byElement = {}, missing = [];
  let filled = 0, applicable = 0;
  for (const s of SLOTS.slots) {
    const items = DETECTORS[s.detect](model);
    const f = items.filter((x) => x.filled).length;
    bySlot[s.id] = { applicable: items.length, filled: f };
    const e = (byElement[s.element] ??= { applicable: 0, filled: 0 });
    e.applicable += items.length; e.filled += f;
    applicable += items.length; filled += f;
    for (const x of items) if (!x.filled) missing.push({ slot: s.id, element: x.element, name: x.name, coveredBy: s.coveredBy ?? null });
  }
  // CRUD матриц: үүрэг × өөрийн хүснэгт — мөр (эсвэл `*`) бий = шийдсэн
  const roles = [...new Set(model.roles.filter((r) => r.role && !r.role.startsWith('@') && !r.object).map((r) => low(r.role)))];
  const tables = ownTables(model).map(([n]) => n);
  const decidedCell = (r, t) => model.roles.some((x) => low(x.role) === r && !x.object && (x.table === t || x.table === '*'));
  const undecided = tables.map((t) => ({ table: t, roles: roles.filter((r) => !decidedCell(r, t)).length })).filter((x) => x.roles === roles.length && roles.length);
  const cells = roles.length * tables.length, decided = roles.reduce((a, r) => a + tables.filter((t) => decidedCell(r, t)).length, 0);
  return {
    score: applicable ? +(filled / applicable).toFixed(3) : 1, filled, applicable, bySlot, byElement,
    crud: { roles: roles.length, tables: tables.length, cells, decided, ratio: cells ? +(decided / cells).toFixed(3) : 1, tablesWithoutAnyRole: undecided.map((x) => x.table) },
    missing,
  };
}

export const slotsCheck = {
  id: 'slots', layer: 'B1',
  run(model, emit) {
    for (const s of SLOTS.slots) {
      if (s.coveredBy) continue;
      for (const x of DETECTORS[s.detect](model)) if (!x.filled)
        emit({ code: 'SLOT-MISSING', severity: s.severity, element: x.element, discriminator: s.id, file: x.file, line: x.line,
          message: `${s.title}: ${fillQuestion(s, x.name)}`, fix: s.fix });
    }
  },
};
