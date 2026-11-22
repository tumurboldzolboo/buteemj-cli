// PLAN15 A5 — хамралт. validate аль хэдийн мэдээлдэг: `req_untraced` (Холбоосгүй шаардлага), `req_link` (шийдэгдээгүй холбоос),
// `scenario_req` (байхгүй шаардлагыг лавласан сценари), `req_uncovered` (сценаригүй шаардлага — бүгд warning). Эдгээрийг давхардуулахгүй; энд:
//  - COV-P1-UNTESTED — эрэмбэ 1 (заавал) шаардлагад хүлээн авах сценари алга (req_uncovered-ийн эрэмбээр ялгасан, important дэд олонлог)
//  - COV-REQUIRED-NOFORM — заавал багана тухайн хүснэгтийн аль ч маягтын layout-д алга; web маягт зөвхөн layout-ийн баганыг зурдаг
//    (LayoutForm.tsx) тул маягтаар үүсгэхэд NOT NULL алдаа. Анхдагч, computed, numbering, state, processonly, parent, pk баганыг алгасна
//  - COV-UNTRACED — зан төлөвийн элемент (машин, шийдвэр, процесс, тайлан, генератор) ямар ч шаардлагын «Холбоос»-оор лавлагдаагүй (урвуу traceability)
import { ref } from '../model.mjs';

const str = (v) => String(v ?? '').trim();
const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const FILLED_TAGS = new Set(['default', 'computed', 'numbering', 'state', 'processonly', 'parent']);

// layout-ийн бүх талбарын нэр (tabs[].sections[].fields[] эсвэл sections[].fields[]; мөр эсвэл {field}/{column}/{name})
export function layoutFields(screen) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const f of asList(v.fields)) {
      if (typeof f === 'string') out.add(str(f));
      else if (f && typeof f === 'object') { const n = str(f.field ?? f.column ?? f.name); if (n) out.add(n); }
    }
    for (const k of ['tabs', 'sections', 'layout']) if (v[k]) walk(v[k]);
  };
  walk(screen.layout ?? screen);
  return out;
}

// шаардлагын холбоос → лавлагдсан нэрс (угтвар `calc: `, `roles.csv: ` хасна; `Машин [Төлөв]` → машин, төлөв)
function linkedNames(model) {
  const out = new Set();
  for (const r of model.requirements) for (const l of r.links ?? []) {
    let s = str(l).replace(/^[a-z][\w.-]*:\s*/i, '');
    const st = /^(.+?)\s*\[(.+)\]$/.exec(s);
    if (st) { out.add(st[1].trim()); out.add(st[2].trim()); s = st[1].trim(); }
    out.add(s);
    out.add(s.split('/').pop().replace(/\.[^.]+$/, '')); // файлын нэр
  }
  return out;
}

export const coverageCheck = {
  id: 'coverage', layer: 'A5',
  run(model, emit) {
    // COV-P1-UNTESTED — acceptance-ийн «Шаардлага» баганатай үед л (эс бөгөөс хамралтыг тогтоох боломжгүй)
    const linked = model.scenarios.some((s) => Array.isArray(s.requirements));
    if (linked && model.requirements.length) {
      const covered = new Set(model.scenarios.flatMap((s) => s.requirements ?? []));
      for (const r of model.requirements) if (str(r.priority) === '1' && !covered.has(r.id))
        emit({ code: 'COV-P1-UNTESTED', element: ref.requirement(r.id), file: r.file, line: r.line,
          message: `${r.id} (эрэмбэ 1 — заавал): хүлээн авах сценари алга — «${str(r.text).slice(0, 80)}» хэрэгжсэн эсэхийг шалгах арга тодорхойгүй`,
          fix: `acceptance.md-д ${r.id}-ийг шалгах сценари нэмнэ («Шаардлага» баганад ${r.id})` });
    }

    // COV-REQUIRED-NOFORM
    const forms = new Map();
    for (const s of model.screens) if (str(s.type) === 'form' && str(s.table) && s.extends === undefined) {
      if (!forms.has(str(s.table))) forms.set(str(s.table), []);
      forms.get(str(s.table)).push(s);
    }
    const extended = new Set(model.screens.filter((s) => s.extends !== undefined).map((s) => str(s.table)));
    for (const [table, list] of forms) {
      const t = model.tables.get(table);
      if (!t || extended.has(table)) continue;
      // `layout` түлхүүртэй маягт — web түүгээр зурна (хоосон ч); layout-гүй маягтад платформ бүх баганыг автоматаар (H2: хоосон layout ХС байсан)
      const withLayout = list.filter((s) => s.layout && typeof s.layout === 'object');
      if (!withLayout.length) continue;
      const placed = new Set(withLayout.flatMap((s) => [...layoutFields(s)]));
      for (const c of t.columns) {
        if (!c.required || c.pk || c.default !== undefined && c.default !== null && c.default !== '' || placed.has(c.name)) continue;
        if ((c.tags ?? []).some((tg) => FILLED_TAGS.has(String(tg.tag).toLowerCase()))) continue;
        emit({ code: 'COV-REQUIRED-NOFORM', element: ref.column(table, c.name), file: t.file, line: c.line,
          message: `«${table}.${c.name}» заавал (not null, анхдагчгүй) атлаа ${withLayout.map((s) => `«${str(s.id) || str(s.title)}»`).join(', ')} маягтын layout-д алга — маягтаар бичлэг үүсгэх боломжгүй`,
          evidence: [{ file: t.file, line: c.line }, ...withLayout.filter((s) => s.line).map((s) => ({ file: s.file, line: s.line }))],
          fix: `маягтын layout-д «${c.name}» нэмэх, эсвэл анхдагч утга/computed өгөх, эсвэл заавал биш болгоно` });
      }
    }

    // COV-UNTRACED (зөвлөмж) — шаардлага огт байхгүй бол алгасна.
    // Дамжлагат: лавлагдсан элементийн дурдсан элемент ч лавлагдсанд тооцогдоно (хуудас → тайлан, процесс → машин/шийдвэр, шилжилт → генератор/процесс)
    if (!model.requirements.length) return;
    const names = linkedNames(model);
    const traced = (...cands) => cands.some((x) => x && names.has(str(x)));
    const strings = (v, out = []) => { if (typeof v === 'string') out.push(str(v)); else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out); return out; };
    const edges = []; // [нэрс (аль нэг нь лавлагдсан бол), дурдсан нэрс]
    for (const s of model.screens) edges.push([[s.id, s.title, s.slug].map(str).filter(Boolean), strings(s)]);
    for (const m of model.machines) edges.push([[m.name, ...m.transitions.map((t) => t.caption)], m.transitions.flatMap((t) => (t.actions ?? []).map((a) => str(a.arg).split(/[,(]/)[0].replace(/^[^:]*:\s*/, '')))]);
    for (const b of model.bpmn) for (const p of b.text.matchAll(/<(?:bpmn2?:)?process\b([^>]*)>([\s\S]*?)<\/(?:bpmn2?:)?process>/g)) {
      const id = /\bid="([^"]*)"/.exec(p[1])?.[1] ?? '', name = /\bname="([^"]*)"/.exec(p[1])?.[1] ?? '';
      const refs = [...p[2].matchAll(/\b(?:buteemj:(?:transitionTable|table|document|transition)|camunda:(?:decisionRef|calculationRef))="([^"]+)"/g)].map((x) => x[1]);
      const tables = new Set(refs);
      edges.push([[id, name, b.file, b.file.split('/').pop().replace(/\.bpmn$/i, '')], [...refs, ...model.machines.filter((m) => tables.has(m.table)).map((m) => m.name)]]);
    }
    for (let changed = true; changed;) {
      changed = false;
      for (const [from, to] of edges) if (from.some((x) => names.has(x))) for (const t of to) if (t && !names.has(t)) { names.add(t); changed = true; }
    }
    // нэрийг текстэндээ дурдсан шаардлага — «Холбоос»-д нэмэх нэр дэвшигч
    const mentions = (name) => { const n = str(name).toLowerCase(); return n.length < 4 ? [] : model.requirements.filter((r) => str(r.text).toLowerCase().includes(n)); };
    const untraced = (el, file, line, kind, name) => {
      const cand = mentions(name);
      emit({ code: 'COV-UNTRACED', element: el, file, line,
        message: `${kind} «${name}» ямар ч шаардлагын «Холбоос»-оор лавлагдаагүй${cand.length ? ` (текстэд дурдсан: ${cand.slice(0, 3).map((r) => r.id).join(', ')})` : ' — яагаад байгааг (эсвэл хэрэгтэй эсэхийг) тайлбарлах шаардлага алга'}`,
        evidence: [{ file, line }, ...cand.slice(0, 3).map((r) => ({ file: r.file, line: r.line }))],
        fix: cand.length ? `${cand[0].id}-ийн «Холбоос»-д «${name}» нэмнэ` : `requirements.md-д «${name}»-ийг холбосон шаардлага нэмэх, эсвэл хэрэггүй бол хасна` });
    };
    // машин: нэрээр (`Машин [Төлөв]` хэлбэр ч) эсвэл шилжилтийн товчны нэрээр. Төлвийн нэр («Батлагдсан») ерөнхий тул тооцохгүй
    for (const m of model.machines)
      if (!traced(m.name) && !m.transitions.some((t) => traced(t.caption))) untraced(ref.machine(m.name), m.file, m.line, 'машин', m.name);
    for (const f of model.dmn) for (const d of f.text.matchAll(/<(?:dmn:)?decision\b[^>]*?\bid="([^"]*)"[^>]*?\bname="([^"]*)"|<(?:dmn:)?decision\b[^>]*?\bname="([^"]*)"[^>]*?\bid="([^"]*)"/g)) {
      const id = d[1] ?? d[4], name = d[2] ?? d[3];
      if (!traced(id, name, f.file, f.file.split('/').pop(), f.file.split('/').pop().replace(/\.dmn$/i, '')))
        untraced(ref.decision(f.file, name), f.file, f.text.slice(0, d.index).split('\n').length, 'шийдвэр', name);
    }
    for (const b of model.bpmn) for (const p of b.text.matchAll(/<(?:bpmn2?:)?process\b([^>]*)>/g)) {
      const id = /\bid="([^"]*)"/.exec(p[1])?.[1] ?? '', name = /\bname="([^"]*)"/.exec(p[1])?.[1] ?? '';
      if (!traced(id, name, b.file, b.file.split('/').pop(), b.file.split('/').pop().replace(/\.bpmn$/i, '')))
        untraced(ref.process(b.file, id || name), b.file, b.text.slice(0, p.index).split('\n').length, 'процесс', name || id);
    }
    for (const r of model.reports) if (str(r.name) && !traced(r.name)) untraced(ref.report(str(r.name)), r.file, r.line ?? 0, 'тайлан', str(r.name));
    for (const [f, v] of Object.entries(model.yaml)) if (/^generators\.ya?ml$/i.test(f))
      for (const g of asList(v?.generators)) if (str(g?.name) && !traced(g.name, 'generators.yaml')) untraced(`${ref.file(f)}#${str(g.name)}`, f, 0, 'генератор', str(g.name));
  },
};
