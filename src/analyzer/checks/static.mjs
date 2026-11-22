// PLAN15 H3 → статик шалгалт (бодит засвараас ерөнхийлсөн; docs/analysis/real-gap-eval.md). Эзний шийдвэр 2026-11-22: todu-borluulalt hold-out биш болсон.
//  SM-CREATE-IGNORED (important)     — үүсгэх шилжилт ([*] → S)-ийн guard/action ажилладаггүй (генератор эсвэл дараагийн шилжилтэд)
//  SM-GUARD-VACUOUS (advisory)      — `мөр бүрт <нөхцөл>` нь мөргүй баримтад үнэн — `мөр заавал and …` дутуу
//  FK-DEFAULT-LITERAL (important)    — FK баганын анхдагч нь тоон литерал: id суулгалт бүрт өөр (код/нэр биш)
//  COL-PROCESSONLY-NOTNULL (important) — processOnly + NOT NULL + анхдагчгүй, генератор/процесс бичдэггүй → мөр үүсгэх боломжгүй
//  RPT-GROUP-ROWCALC (important)     — бүлэглэсэн тайлангийн багана мөр бүрийн `calc` (бүлэглэлд утгагүй — гүйцэтгэлд алдаа)
//  DOC-HELPER-UNKNOWN (important) / DOC-HELPER-DEPRECATED (advisory) — баримтын загварын `{{org.<x>}}` танихгүй, `money`/`moneywords` хуучирсан
//  BPMN-DATASTATE-AMBIG (advisory)   — buteemj:transition-тэй serviceTask-ийн dataOutput төлөвт хэд хэдэн шилжилт хүрнэ — хоёрдмол
import { ref } from '../model.mjs';

const str = (v) => String(v ?? '').trim();
const lineOfText = (text, re) => { const ls = String(text ?? '').split('\n'); const i = ls.findIndex((l) => re.test(l)); return i >= 0 ? i + 1 : 0; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tag = (c, name) => (c.tags ?? []).find((g) => String(g.tag).toLowerCase() === name);
const dflt = (c) => (c.default && typeof c.default === 'object' ? str(c.default.text) : str(c.default ?? ''));
const hasDefault = (c) => dflt(c) !== '' || !!tag(c, 'default');
const defaultOf = (c) => dflt(c) || str(tag(c, 'default')?.value ?? '');
export const ORG_FIELDS = ['registerNo', 'phone', 'address', 'email', 'legalName', 'logo', 'name'];

export const staticCheck = {
  id: 'static', layer: 'H3',
  run(model, emit) {
    // ---- төлөвийн машин
    for (const m of model.machines) for (const t of m.transitions) {
      if (t.create && (str(t.guard) || (t.actions ?? []).length))
        emit({ code: 'SM-CREATE-IGNORED', element: ref.transition(m.name, t.caption, t.from), discriminator: str(t.guard) ? 'guard' : 'action', file: m.file, line: t.line,
          message: `«${m.name}»: үүсгэх шилжилт «${t.caption}» ([*] → ${t.to})-ийн ${[str(t.guard) ? `guard «${t.guard}»` : '', (t.actions ?? []).length ? `action ${t.actions.map((a) => a.name).join(', ')}` : ''].filter(Boolean).join(', ')} ажилладаггүй`,
          fix: 'шалгалтыг дараагийн шилжилт эсвэл validation-д, үйлдлийг генератор (`generators.yaml`, дэлгэцийн `type: generate`)-т шилжүүлнэ' });
      const g = str(t.guard);
      if (/мөр бүрт/.test(g) && !/мөр заавал|мөр\s*>\s*0|count\(/.test(g))
        emit({ code: 'SM-GUARD-VACUOUS', element: ref.transition(m.name, t.caption, t.from), discriminator: 'мөр бүрт', file: m.file, line: t.line,
          message: `«${m.name}»: «${t.caption}»-ийн guard «${g}» — мөргүй баримтад «мөр бүрт» үнэн тул шилжилт хийгдэнэ`,
          fix: '`мөр заавал and мөр бүрт …` (мөргүйг хаана) эсвэл мөргүй баримт зөвшөөрөгдөх бол тайлбарлана' });
    }
    // ---- ERD
    const writers = [...model.files.filter((f) => /(^|\/)generators\.ya?ml$/i.test(f) || /\.bpmn$/i.test(f) || /(^|\/)(integrations|ledgers)\.ya?ml$/i.test(f)).map((f) => model.source[f]),
      ...model.machines.flatMap((m) => m.transitions.flatMap((t) => (t.actions ?? []).map((a) => `${a.name}(${a.arg})`)))].join('\n');
    for (const [tn, t] of model.tables) for (const c of t.columns) {
      if (c.pk) continue;
      if (c.ref && hasDefault(c) && /^-?\d+$/.test(defaultOf(c).replace(/^['"`]|['"`]$/g, '')))
        emit({ code: 'FK-DEFAULT-LITERAL', element: ref.column(tn, c.name), discriminator: defaultOf(c), file: t.file, line: c.line,
          message: `«${tn}.${c.name}» (FK → ${c.ref.table}) анхдагч ${defaultOf(c)} — тоон id суулгалт/байгууллага бүрт өөр (код эсвэл нэр биш)`,
          fix: `анхдагчийг хасаж генератор/процесст лавлахаас олно (жишээ: \`minof(${c.ref.table}, id, Код == '…')\`) эсвэл seed-ийн кодоор` });
      const po = tag(c, 'processonly') || /processOnly/i.test(str(c.note));
      if (po && c.required && !hasDefault(c) && !/computed:/i.test(str(c.note)) && !new RegExp(`(^|[^\\p{L}])${esc(c.name)}([^\\p{L}]|$)`, 'u').test(writers))
        emit({ code: 'COL-PROCESSONLY-NOTNULL', element: ref.column(tn, c.name), discriminator: 'processOnly', file: t.file, line: c.line,
          message: `«${tn}.${c.name}»: processOnly + NOT NULL, анхдагчгүй, генератор/процесс бичдэггүй — «${tn}»-д мөр үүсгэх боломжгүй`,
          fix: '`default: …` нэмнэ, NOT NULL-ийг хасна эсвэл бичих генератор/процессыг тодорхойлно' });
    }
    // ---- тайлан
    for (const r of model.reports) {
      if (!Array.isArray(r.groupBy) || !r.groupBy.length) continue;
      for (const col of Array.isArray(r.columns) ? r.columns : []) {
        const e = str(col?.expr);
        if (/(^|[^\p{L}])calc\s/u.test(e) && !/^(sum|count|min|max|avg)\(/.test(e))
          emit({ code: 'RPT-GROUP-ROWCALC', element: ref.report(r.name), discriminator: e, file: r.file, line: lineOfText(model.source[r.file], new RegExp(esc(e))) || r.line,
            message: `тайлан «${r.name}»: бүлэглэлтэй (${r.groupBy.join(', ')}) боловч багана «${col.label ?? e}» мөр бүрийн тооцоо «${e}» — бүлэгт нэг утга биш`,
            fix: 'measures-д нэгтгэл (sum/…) эсвэл бүлэглэлгүй тусдаа тайлан' });
      }
    }
    // ---- баримтын загвар
    for (const f of model.files.filter((x) => /^documents\/.+\.html?$/i.test(x))) {
      const text = String(model.source[f] ?? '');
      const seen = new Set();
      for (const m of text.matchAll(/\{\{\s*(org\.([\p{L}\p{N}_]+)|money|moneywords)\b/gu)) {
        const what = m[2] ? `org.${m[2]}` : m[1];
        if (seen.has(what)) continue; seen.add(what);
        const line = text.slice(0, m.index).split('\n').length;
        if (m[2] && !ORG_FIELDS.includes(m[2]))
          emit({ code: 'DOC-HELPER-UNKNOWN', element: `file:${f}`, discriminator: what, file: f, line,
            message: `${f}: «{{${what}}}» — байгууллагын талбар биш (${ORG_FIELDS.map((x) => `org.${x}`).join(', ')}) — хоосон хэвлэгдэнэ`, fix: `зөв нэр (жишээ: org.registerNo)` });
        else if (!m[2])
          emit({ code: 'DOC-HELPER-DEPRECATED', element: `file:${f}`, discriminator: what, file: f, line,
            message: `${f}: «{{${what} …}}» хуучирсан`, fix: what === 'money' ? '`{{number X "# ##0.00"}}`' : '`{{words X "төгрөг" "мөнгө"}}`' });
      }
    }
    // ---- BPMN: buteemj:transition + dataOutput төлөв, тэр төлөвт ≥ 2 товч хүрнэ
    for (const b of model.bpmn) {
      const text = String(b.text ?? '');
      const refs = new Map([...text.matchAll(/<bpmn:dataObjectReference\b[^>]*\bid="([^"]+)"[^>]*\bname="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      for (const st of text.matchAll(/<bpmn:serviceTask\b([^>]*)>([\s\S]*?)<\/bpmn:serviceTask>/g)) {
        const tr = /buteemj:transition="([^"]+)"/.exec(st[1])?.[1];
        if (!tr) continue;
        const table = /buteemj:transitionTable="([^"]+)"/.exec(st[1])?.[1];
        for (const o of st[2].matchAll(/<bpmn:dataOutputAssociation\b[\s\S]*?<bpmn:targetRef>([^<]+)<\/bpmn:targetRef>/g)) {
          const nm = refs.get(o[1].trim()) ?? '';
          const sm = /^(.+?)\s*\[(.+)\]$/.exec(nm);
          if (!sm) continue;
          const m = model.machines.find((x) => x.table === (table ?? sm[1]) || x.table === sm[1]);
          // хоёрдмол — нэг эх төлвөөс ≥ 2 өөр товч энэ төлөвт хүрнэ (эх өөр бол одоогийн төлөв ялгана)
          const into = (m?.transitions ?? []).filter((t) => t.to === sm[2] && !t.create);
          const byFrom = new Map(); for (const t of into) byFrom.set(t.from, new Set([...(byFrom.get(t.from) ?? []), t.caption]));
          const par = [...byFrom.entries()].find(([, c]) => c.size >= 2 && c.has(tr));
          const captions = par ? [...par[1]] : [];
          if (captions.length >= 2)
            emit({ code: 'BPMN-DATASTATE-AMBIG', element: `process:${b.file}#${/\bid="([^"]+)"/.exec(st[1])?.[1] ?? tr}`, discriminator: nm, file: b.file, line: lineOfText(text, new RegExp(esc(o[0].slice(0, 60)))),
              message: `${b.file}: «${tr}» serviceTask-ийн dataOutput «${nm}» — «${par[0]}»-оос «${sm[2]}»-д ${captions.length} товч хүрнэ (${captions.join(', ')}); buteemj:transition-тэй давхар, хоёрдмол`,
              fix: 'buteemj:transition-ийг л үлдээж dataOutputAssociation-ыг хасна' });
        }
      }
    }
  },
};
