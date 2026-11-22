// PLAN15 E1–E3 — эх баримтын IR (`sources/ir.json`) ба `sources/*.md|txt`. Аль нь ч байхгүй бол юу ч хийхгүй.
//  IR-MISSING (advisory)          — эх баримт бий, IR алга
//  IR-INVALID (important)         — JSON/схемийн алдаа, давхардсан id
//  IR-SOURCE-UNKNOWN (important)  — эх догол мөр (`файл#¶n`) алга
//  IR-QUOTE-NOTFOUND (important)  — ишлэл заасан догол мөрт үгчлэн алга (хэвийн болгосны дараа); assumed биш (E2)
//  IR-ASSUMED (advisory)          — таамаг (assumed: true) — хүн батлах
//  IR-ELEMENT-UNKNOWN (important) — загварын элемент алга
//  IR-PARA-UNCOVERED (advisory)   — догол мөр IR-д ч, ignored-д ч ороогүй (E3)
import { ref } from '../model.mjs';
import { validateSchema } from '../../validator/schema.mjs';
import { IR_FILE, loadIr, irLine, sourceUnits, parseSource, normalize, elementExists, irCoverage, paragraphs } from '../ir.mjs';

const str = (v) => String(v ?? '').trim();
const short = (s, n = 100) => { const t = str(s).replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n)}…` : t; };

export const irCheck = {
  id: 'ir', layer: 'E',
  run(model, emit, ctx = {}) {
    const units = sourceUnits(model);
    const hasSources = Object.keys(units).length > 0;
    const hasIr = typeof model.source[IR_FILE] === 'string';
    if (!hasSources && !hasIr) return;
    const el = (id) => `file:${IR_FILE}#${id}`;
    if (!hasIr) {
      emit({ code: 'IR-MISSING', element: ref.package(model.key || '?'), discriminator: 'ir', file: Object.keys(units)[0], line: 0,
        message: `эх баримт (${Object.keys(units).join(', ')}) бий, ${IR_FILE} алга — шаардлага эх текстээс мөрдөгдөхгүй`,
        fix: '`bj cnl ir --write` (brd.md-ээс) эсвэл MCP агентаар IR үүсгэнэ' });
      return;
    }
    const { doc, error } = loadIr(model);
    if (error) { emit({ code: 'IR-INVALID', element: el('json'), discriminator: 'json', file: IR_FILE, line: 1, message: `${IR_FILE}: JSON задлагдсангүй — ${short(error, 200)}` }); return; }
    const schema = model.catalog?.schemas?.ir ?? ctx.catalog?.schemas?.ir;
    if (schema) for (const e of validateSchema(doc, schema).errors.slice(0, 20))
      emit({ code: 'IR-INVALID', element: el(e.path || '/'), discriminator: `${e.path}:${e.message}`, file: IR_FILE, line: 0, message: `${IR_FILE} ${e.path || '/'}: ${e.message}` });
    const seen = new Set();
    for (const it of Array.isArray(doc?.items) ? doc.items : []) {
      if (!it || typeof it !== 'object') continue;
      const id = str(it.id) || '?', line = irLine(model, id);
      if (seen.has(id)) emit({ code: 'IR-INVALID', element: el(id), discriminator: 'dup', file: IR_FILE, line, message: `IR id «${id}» давхардсан` });
      seen.add(id);
      const s = parseSource(it.source);
      // эх нь sources/ эсвэл багцын бусад текст файл (жишээ: brd.md — `bj cnl ir`); хамралтад зөвхөн sources/ тооцогдоно
      const paras = s ? units[s.file] ?? (typeof model.source[s.file] === 'string' ? paragraphs(model.source[s.file]) : undefined) : undefined;
      const p = s && Array.isArray(paras) ? paras.find((x) => x.n === s.n) : null;
      if (!p) {
        emit({ code: 'IR-SOURCE-UNKNOWN', element: el(id), discriminator: str(it.source), file: IR_FILE, line,
          message: `${id}: эх «${str(it.source)}» ${!s ? 'хэлбэр буруу (`файл#¶n`)' : paras === undefined ? '— файл алга (sources/*.md|txt)' : `— ¶${s.n} алга (${Array.isArray(paras) ? paras.length : 0} догол мөр)`}`,
          fix: 'эх файлын догол мөрийн дугаарыг засна (`bj cnl paras <файл>` эсвэл тайлангаас)' });
      } else if (!it.assumed && str(it.quote)) {
        const q = normalize(it.quote);
        if (!normalize(p.text).includes(q)) {
          const other = paras.find((x) => normalize(x.text).includes(q));
          emit({ code: 'IR-QUOTE-NOTFOUND', element: el(id), discriminator: str(it.source), file: IR_FILE, line,
            message: `${id}: ишлэл «${short(it.quote)}» ${str(it.source)}-д үгчлэн алга${other ? ` (¶${other.n}-д байна)` : ''}`,
            evidence: [{ file: IR_FILE, line }, { file: s.file, line: p.line }],
            fix: other ? `source-ийг «${s.file}#¶${other.n}» болгоно` : 'эх текстээс үгчлэн хуулна эсвэл `assumed: true` (таамаг — асуулт болно)' });
        }
      }
      if (it.assumed) emit({ code: 'IR-ASSUMED', element: el(id), discriminator: 'assumed', file: IR_FILE, line,
        message: `${id}: таамаг — «${short(it.text || it.quote)}» эх баримтад шууд байхгүй`, fix: 'эзнээр батлуулж ишлэлтэй болгох эсвэл хасна' });
      if (str(it.element) && !elementExists(model, str(it.element))) emit({ code: 'IR-ELEMENT-UNKNOWN', element: el(id), discriminator: str(it.element), file: IR_FILE, line,
        message: `${id}: загварын элемент «${str(it.element)}» алга`, fix: 'загварт элементийг нэмэх эсвэл лавлагааг засна' });
    }
    const cov = irCoverage(model);
    for (const u of cov?.uncovered ?? [])
      emit({ code: 'IR-PARA-UNCOVERED', element: `file:${u.file}#¶${u.n}`, discriminator: '', file: u.file, line: u.line,
        message: `${u.file}#¶${u.n}${u.section ? ` (${u.section})` : ''}: «${short(u.text)}» — IR-д буугаагүй`,
        fix: `IR элемент нэмнэ (source: "${u.file}#¶${u.n}") эсвэл ignored-д шалтгаантай` });
  },
};
