// PLAN15 A2 — эрх ↔ процесс/шилжилт/дэлгэц (`roles.csv` × `states.mmd`, `*.bpmn`, `screens.yaml`).
// Серверийн семантик: шилжилт = хэрэглэгчийн хүснэгтийн Өөрчлөх эрх (main.cpp GAPS G27; BpmnEngine ST0036), `хэн: процесс` — эрх шаардахгүй (G29);
// `-` = хориг, бусад мөрийн зөвшөөрлийг дарна; үүргийг жижиг үсгээр тааруулна (SolutionDeploy.cpp). roles.csv-д огт байхгүй үүрэг/бүлэг (seed-ийн бүлэг)
// шалгагдахгүй — сервер ч алгасдаг. `@<нэвтрэх нэр>` (хувийн) мөр үүрэгт тооцогдохгүй. Хүснэгт `*` — бүх хүснэгтэд гэж үзнэ (ХЭ-ээс сэргийлж).
// Объект (`товч:`, `дэлгэц:`) мөрийн нарийвчилсан эрх энд биш.
import { ref } from '../model.mjs';
import { CORE_TABLES } from '../../validator/compile.mjs';

const str = (v) => String(v ?? '').trim();
const low = (v) => str(v).toLowerCase();
const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const splitNames = (v) => str(v).split(',').map(str).filter(Boolean);

// үүрэг × хүснэгт → {view, create, update, remove}: 'grant' | 'deny' | undefined
export function permIndex(model) {
  const idx = new Map(); // low(role) → Map(table → {view, create, update, remove})
  const known = new Map(); // low(role) → анхны бичлэг
  for (const r of model.roles) {
    if (!r.role || r.role.startsWith('@') || r.object) continue;
    const k = low(r.role);
    if (!known.has(k)) known.set(k, r.role);
    if (!idx.has(k)) idx.set(k, new Map());
    const t = idx.get(k);
    if (!t.has(r.table)) t.set(r.table, {});
    const cell = t.get(r.table);
    for (const op of ['view', 'create', 'update', 'remove']) {
      const v = r.raw?.[op];
      if (v === '-') cell[op] = 'deny';
      else if (r[op] && cell[op] !== 'deny') cell[op] = 'grant';
    }
  }
  const can = (role, table, op) => {
    const t = idx.get(low(role));
    if (!t) return null; // үл мэдэгдэх үүрэг
    const cells = [t.get(table), t.get('*')].filter(Boolean);
    if (cells.some((c) => c[op] === 'deny')) return false;
    return cells.some((c) => c[op] === 'grant');
  };
  return { known, can, rowOf: (role, table) => model.roles.find((r) => low(r.role) === low(role) && (r.table === table || r.table === '*') && !r.object) ?? null };
}

const lineAt = (text, i) => text.slice(0, i).split('\n').length;
const attr = (tag, name) => { const m = new RegExp(`\\b${name.replace(':', '\\:')}="([^"]*)"`).exec(tag); return m ? m[1] : ''; };

// BPMN userTask: {id, name, table, groups[], line}; `${…}` илэрхийлэлтэй бүлгийг (groupMembers г.м.) алгасна
export function userTasks(bpmn) {
  const out = [];
  for (const m of bpmn.text.matchAll(/<(?:bpmn2?:)?userTask\b[^>]*>/g)) {
    const tag = m[0];
    const groups = attr(tag, 'camunda:candidateGroups');
    out.push({ id: attr(tag, 'id'), name: attr(tag, 'name'), table: attr(tag, 'buteemj:table'), groups: groups.includes('${') ? [] : splitNames(groups), line: lineAt(bpmn.text, m.index) });
  }
  return out;
}

export const permissionsCheck = {
  id: 'permissions', layer: 'A2',
  run(model, emit) {
    if (!model.roles.length) return; // roles.csv алга — эрхийн загваргүй
    const P = permIndex(model);
    const hasTable = (t) => model.tables.has(t);
    const rowEvidence = (role, table) => { const r = P.rowOf(role, table); return r ? [{ file: r.file, line: r.line }] : []; };

    // PERM-TRANSITION-NOWRITE / PERM-CREATE-NOCREATE
    for (const m of model.machines) for (const t of m.transitions) {
      if (t.processOnly || t.autoAfter || t.autoWhen) continue;
      const op = t.create ? 'create' : 'update';
      for (const who of splitNames(t.who)) {
        const c = P.can(who, m.table, op);
        if (c !== false) continue;
        const code = t.create ? 'PERM-CREATE-NOCREATE' : 'PERM-TRANSITION-NOWRITE';
        const opName = t.create ? 'Үүсгэх' : 'Өөрчлөх';
        emit({ code, element: ref.transition(m.name, t.caption, t.create ? '' : t.from), discriminator: low(who), file: m.file, line: t.line,
          message: `машин «${m.name}»: шилжилт «${t.caption}»-ийн «${who}» roles.csv-ээр «${m.table}»-д ${opName} эрхгүй — ${t.create ? 'үүсгэж' : 'шилжилт хийж'} чадахгүй`,
          evidence: [{ file: m.file, line: t.line }, ...rowEvidence(who, m.table)],
          fix: `roles.csv-д «${who},${m.table}» мөрийн ${opName}-ийг 1 болгох, эсвэл \`хэн\`-ийг өөр үүрэг болгоно` });
      }
    }

    // PERM-TASK-NOVIEW: BPMN userTask-ийн бүлэг даалгаврын хүснэгтийг харах эрхгүй — формд бичлэг харагдахгүй.
    // Бичих эрхийг энд шалгахгүй: даалгаврын формын бичлэгийн талбар formData-аас биш хүснэгтийн багана × төлвийн дүрмээс үүсэх бөгөөд сервер
    // эрхийг зөвхөн бичлэгийн утга илгээхэд шалгадаг (BpmnTaskForm.cpp `values`) — батлах/тайлбарын хувьсагчтай даалгавар харах эрхтэй л ажиллана.
    for (const b of model.bpmn) for (const u of userTasks(b)) {
      if (!u.table || !hasTable(u.table)) continue;
      for (const g of u.groups) {
        if (P.can(g, u.table, 'view') !== false) continue;
        emit({ code: 'PERM-TASK-NOVIEW', element: ref.process(b.file, u.id || u.name), discriminator: low(g), file: b.file, line: u.line,
          message: `даалгавар «${u.name || u.id}»: бүлэг «${g}» roles.csv-ээр «${u.table}»-г харах эрхгүй — даалгаврын формд бичлэг харагдахгүй`,
          evidence: [{ file: b.file, line: u.line }, ...rowEvidence(g, u.table)],
          fix: `roles.csv-д «${g},${u.table}» мөрийн Харах-ыг 1 болгоно` });
      }
    }

    // PERM-SCREEN-NOVIEW: дэлгэцийн `roles`-ийн үүрэг тэр хүснэгтийг харах эрхгүй
    for (const s of model.screens) {
      const table = str(s.table);
      if (!table || !hasTable(table)) continue;
      for (const r of asList(s.roles).map(str).filter(Boolean)) {
        if (P.can(r, table, 'view') !== false) continue;
        emit({ code: 'PERM-SCREEN-NOVIEW', element: ref.screen(str(s.id) || str(s.title)), discriminator: low(r), file: s.file, line: s.line ?? 0,
          message: `дэлгэц «${str(s.id) || str(s.title)}»: үүрэг «${r}» roles.csv-ээр «${table}»-г харах эрхгүй — дэлгэц хоосон эсвэл нээгдэхгүй`,
          evidence: [...(s.line ? [{ file: s.file, line: s.line }] : []), ...rowEvidence(r, table)], fix: `roles.csv-д «${r},${table}» мөрийн Харах-ыг 1 болгоно, эсвэл дэлгэцийн \`roles\`-оос хасна` });
      }
    }

    // PERM-TABLE-NOCREATOR (зөвлөмж): ямар ч үүрэг үүсгэх эрхгүй, өөр эх сурвалжаар ч бөглөгдөхгүй хүснэгт
    const filled = new Set();
    for (const [f, v] of Object.entries(model.yaml)) {
      if (/^(seed|defaults|reference)\//.test(f) && v && typeof v === 'object') for (const k of Object.keys(v)) filled.add(k);
      if (/^generators\.ya?ml$/i.test(f)) for (const g of asList(v?.generators)) { filled.add(str(g?.target)); for (const l of asList(g?.lines)) filled.add(str(l?.target ?? l?.table)); }
      if (/^integrations\.ya?ml$/i.test(f)) for (const i of asList(v?.inbound)) filled.add(str(i?.table));
    }
    for (const f of model.files) if (/^reference\/[^/]+\.csv$/i.test(f) || /^defaults\/[^/]+\.csv$/i.test(f)) filled.add(f.split('/').pop().replace(/\.csv$/i, ''));
    for (const b of model.bpmn) for (const m of b.text.matchAll(/\bbuteemj:(?:table|children)="([^"]+)"/g)) filled.add(m[1]);
    for (const m of model.machines) for (const t of m.transitions) for (const a of t.actions ?? []) if (a.name === 'create') filled.add(str(a.arg).split(/[:(,]/)[0]);
    for (const [name, t] of model.tables) {
      if (filled.has(name) || CORE_TABLES.has(name)) continue; // цөмийн хүснэгт (Хэрэглэгч, Хэсэг …) — платформ удирдана
      if (P.known.size && [...P.known.keys()].some((r) => P.can(r, name, 'create'))) continue;
      emit({ code: 'PERM-TABLE-NOCREATOR', element: ref.table(name), file: t.file, line: t.line,
        message: `хүснэгт «${name}»: энэ багцад ямар ч үүрэг Үүсгэх эрхгүй, seed/генератор/интеграц/процессоор ч бөглөгдөхгүй — бичлэг үүсэх зам алга (өөр багц эсвэл гадаад интеграцаар бөглөгддөг бол үл тооно)`,
        fix: `roles.csv-д үүсгэх эрхтэй үүрэг нэмнэ, эсвэл бөглөх эх сурвалжийг (seed, генератор, процесс) тодорхойлно` });
    }
  },
};
