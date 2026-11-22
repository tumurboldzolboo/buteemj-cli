// PLAN15 A1 — төлөвийн машины шинжилгээ (`states.mmd`). Граф: зангилаа = төлөв, ирмэг = шилжилт (гараар, `after`/`when` автомат, `хэн: процесс`).
// Орох цэг: анхны төлөв (`[*] --> X`) ба seed/defaults/reference-д тэр баганын утгаар өгөгдсөн төлөв (PLAN14 A3.10 — seed эхний бус төлөвт).
// Анхны төлөвгүй машиныг алгасна — validate `states_initial` алдаа өгдөг.
// Guard дахь нэрийн шалгалт энд биш: сервер plan `transition_guard` анхааруулга өгдөг; JS-д X0-ийн бүрэн нэр шийдэлтэй A4-д.
import { ref } from '../model.mjs';

const str = (v) => String(v ?? '').trim();
const LOCKED = /\blocked\b|зөвхөн унших|түгжигдсэн|түгжээтэй/i;

// seed/defaults/reference YAML: {<Хүснэгт>: [{<Багана>: утга}]} → тэр хүснэгт.баганын утгууд (файл, мөр)
function dataStates(model, table, column) {
  const out = new Map();
  for (const [f, v] of Object.entries(model.yaml)) {
    if (!/^(seed|defaults|reference)\//.test(f) || !v || typeof v !== 'object' || !Array.isArray(v[table])) continue;
    for (const row of v[table]) { const s = str(row?.[column]); if (s && !out.has(s)) out.set(s, f); }
  }
  return out;
}

function reach(starts, edges) {
  const seen = new Set(starts);
  for (const stack = [...starts]; stack.length;) for (const n of edges.get(stack.pop()) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  return seen;
}

export const statesCheck = {
  id: 'states', layer: 'A1',
  run(model, emit) {
    for (const m of model.machines) {
      const initial = m.states.filter((s) => s.initial);
      if (initial.length !== 1) continue;
      const trs = m.transitions.filter((t) => !t.create && t.from !== '[*]');
      const out = new Map(), back = new Map();
      for (const t of trs) {
        if (!out.has(t.from)) out.set(t.from, new Set());
        out.get(t.from).add(t.to);
        if (!back.has(t.to)) back.set(t.to, new Set());
        back.get(t.to).add(t.from);
      }
      const seeded = dataStates(model, m.table, m.column);
      const starts = [initial[0].name, ...[...seeded.keys()].filter((s) => m.states.some((x) => x.name === s))];
      const reachable = reach(starts, out);
      const finals = m.states.filter((s) => s.final).map((s) => s.name);

      // SM-UNREACHABLE: анхны төлөв ба seed-ээс ямар ч замаар хүрэхгүй
      for (const s of m.states) if (!reachable.has(s.name)) {
        const into = [...(back.get(s.name) ?? [])];
        emit({ code: 'SM-UNREACHABLE', element: ref.state(m.name, s.name), file: m.file, line: s.line,
          message: `машин «${m.name}»: төлөв «${s.name}»-д анхны төлөв «${initial[0].name}»-өөс хүрэх зам алга${into.length ? ` (орох шилжилт зөвхөн хүрэхгүй төлвөөс: ${into.join(', ')})` : ''}`,
          fix: `«${s.name}» руу орох шилжилт нэмнэ, эсвэл хэрэггүй бол төлвийг хасна` });
      }

      if (!finals.length) {
        // SM-NO-FINAL: эцсийн төлөв огт тэмдэглээгүй — гарах шилжилтгүй төлвүүдийг нотолгоо болгоно (SM-DEAD-END-ийг давхардуулахгүй)
        const sinks = m.states.filter((s) => reachable.has(s.name) && !out.has(s.name));
        emit({ code: 'SM-NO-FINAL', element: ref.machine(m.name), file: m.file, line: m.line,
          message: `машин «${m.name}»: эцсийн төлөв (\`X --> [*]\`) тэмдэглээгүй${sinks.length ? ` — гарах шилжилтгүй: ${sinks.map((s) => s.name).join(', ')}` : ' — бүх төлөвт гарах шилжилттэй тул хаагдах төлөв тодорхойгүй (санаатай давтагдах мөчлөг бол үл тооно)'}`,
          evidence: [{ file: m.file, line: m.line }, ...sinks.map((s) => ({ file: m.file, line: s.line }))],
          fix: sinks.length ? `эцсийн төлөв бүрт \`${sinks[0].name} --> [*]\` нэмнэ` : 'бичлэг хаагдах төлвийг тодорхойлж `X --> [*]` нэмнэ' });
        continue;
      }
      // SM-DEAD-END: эцсийн биш, гарах шилжилтгүй, хүрэх боломжтой төлөв — бичлэг гацна.
      // Түгжээний тэмдэглэлтэй (`locked`, «зөвхөн унших») бол санаатай эцсийн төлөв — SM-FINAL-UNMARKED (зөвлөмж)
      for (const s of m.states) if (reachable.has(s.name) && !s.final && !out.has(s.name)) {
        const lock = m.notes.find((n) => n.state === s.name && LOCKED.test(n.text));
        if (lock) emit({ code: 'SM-FINAL-UNMARKED', element: ref.state(m.name, s.name), file: m.file, line: s.line,
          message: `машин «${m.name}»: төлөв «${s.name}» түгжигдсэн, гарах шилжилтгүй боловч эцсийн гэж тэмдэглээгүй (${finals.join(', ')} тэмдэглэгдсэн)`,
          evidence: [{ file: m.file, line: s.line }, { file: m.file, line: lock.line }],
          fix: `\`${s.name} --> [*]\` нэмнэ` });
        else emit({ code: 'SM-DEAD-END', element: ref.state(m.name, s.name), file: m.file, line: s.line,
          message: `машин «${m.name}»: төлөв «${s.name}» эцсийн биш атлаа гарах шилжилтгүй — бичлэг энд гацна`,
          fix: `эцсийн бол \`${s.name} --> [*]\`, эс бөгөөс гарах шилжилт (жишээ нь цуцлах) нэмнэ` });
      }
      // SM-NO-PATH-TO-FINAL: гарах шилжилттэй ч ямар ч замаар эцсийн төлөвт хүрэхгүй (мөчлөгт хоригдоно)
      const toFinal = reach(finals, back);
      for (const s of m.states) if (reachable.has(s.name) && out.has(s.name) && !toFinal.has(s.name))
        emit({ code: 'SM-NO-PATH-TO-FINAL', element: ref.state(m.name, s.name), file: m.file, line: s.line,
          message: `машин «${m.name}»: төлөв «${s.name}»-өөс эцсийн төлөв (${finals.join(', ')}) рүү зам алга — бичлэг мөчлөгт хоригдоно`,
          fix: `«${s.name}» эсвэл түүний мөчлөгөөс эцсийн төлөв рүү шилжилт нэмнэ` });

      // SM-AMBIGUOUS: нэг төлвөөс ижил нэртэй товч хоёр ба түүнээс олон, guard-аар ялгагдахгүй
      const byKey = new Map();
      for (const t of trs) { const k = `${t.from}\u0000${t.caption}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t); }
      for (const list of byKey.values()) {
        if (list.length < 2) continue;
        const guards = list.map((t) => str(t.guard || t.autoWhen));
        if (new Set(guards).size === guards.length && guards.every(Boolean)) continue; // бүгд өөр guard-тай — A4 давхцлыг шалгана
        const t = list[0];
        emit({ code: 'SM-AMBIGUOUS', element: ref.transition(m.name, t.caption, t.from), file: m.file, line: list[1].line,
          message: `машин «${m.name}»: «${t.from}»-өөс «${t.caption}» товч ${list.length} (→ ${list.map((x) => x.to).join(', ')}) — guard-аар ялгагдахгүй`,
          evidence: list.map((x) => ({ file: m.file, line: x.line })),
          fix: 'товчийг өөр нэрлэх эсвэл тус бүрт харилцан үгүйсгэх guard өгнө' });
      }

      // SM-NO-ACTOR: гараар хийх шилжилтэд `хэн` алга — хүснэгтийг Өөрчлөх эрхтэй бүх үүрэг хийнэ (сервер, GAPS G27)
      for (const t of trs) if (!str(t.who) && !t.autoAfter && !t.autoWhen)
        emit({ code: 'SM-NO-ACTOR', element: ref.transition(m.name, t.caption, t.from), file: m.file, line: t.line,
          message: `машин «${m.name}»: шилжилт «${t.caption}» (${t.from} → ${t.to})-д \`хэн\` алга — «${m.table}»-г Өөрчлөх эрхтэй бүх үүрэг хийж чадна`,
          fix: `\`/ хэн: <Үүрэг>\` нэмнэ (санаатай бол анхааруулгыг үл тооно)` });
    }
  },
};
