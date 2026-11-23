// PLAN15 B3 — домэйны жишиг (зөвлөмж). Домэйны мэдлэг ЦӨМД БИШ — өгөгдлөөр (`hints.yaml`):
//   1) шинжилж буй багцын `hints.yaml`; 2) `requires`-ээр (давхар) хамаарсан багцуудын `hints.yaml` (opts.packages);
//   3) opts.hints: [{source, text}] (CLI `--hints=<файл>`).
//  DOMAIN-HINT (advisory)   — `when` биелсэн хүснэгтэд `expect`-ийн аль нь ч алга (зөвлөмж, хаахгүй; асуулт болно)
//  HINTS-INVALID (important) — hints.yaml задлагдахгүй, хэлбэр буруу, regex буруу
// Формат (docs/brd-standard/catalog/hints.schema.json). `table:`/`column:` түлхүүрийг validate лавлагаа гэж уншдаг тул ХЭРЭГЛЭХГҮЙ:
//   version: 1
//   hints:
//     - id: purchase.approval-limit
//       when: { tableMatch: "<regex>", columnMatch: "<regex>", machine: true }  # бүгд (AND); хүснэгт бүр тусдаа; machine — төлөвийн машинтай
//       expect:                                            # аль нэг (OR)
//         - { has: column | unique | state | transition | comment, match: "<regex>" }   # энэ хүснэгтийн (unique — давтагдахгүй багана, comment — тайлбар заавал шилжилт)
//         - { has: table | decision | report, match: "<regex>" }                       # багцад
//       message: "<яагаад>"
//       question: "«{name}» …?"                            # {name} — хүснэгт
import { loadYaml, lineOf } from '../../validator/yaml.mjs';
import { ref } from '../model.mjs';

export const HINTS_FILE = 'hints.yaml';
const str = (v) => String(v ?? '').trim();
const KINDS = ['column', 'unique', 'state', 'transition', 'comment', 'table', 'decision', 'report'];
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const reqKeys = (manifest) => (Array.isArray(manifest?.requires) ? manifest.requires : []).map((r) => /^\s*([A-Za-z0-9_.-]+)/.exec(String(r))?.[1]).filter(Boolean);

// эх → [{source, text, file, pkg}] (requires-ийг давхар, мөчлөггүй)
export function hintSources(model, opts = {}) {
  const out = [];
  if (typeof model.source[HINTS_FILE] === 'string') out.push({ source: HINTS_FILE, text: model.source[HINTS_FILE], file: HINTS_FILE });
  const seen = new Set([model.key]);
  const walk = (keys) => {
    for (const k of keys) {
      if (seen.has(k)) continue; seen.add(k);
      const p = opts.packages?.get?.(k);
      if (!p) continue;
      if (typeof p.files?.[HINTS_FILE] === 'string') out.push({ source: `${k}/${HINTS_FILE}`, text: p.files[HINTS_FILE], pkg: k });
      const r = loadYaml(p.files?.['manifest.yaml'] ?? '');
      walk(r.error ? [] : reqKeys(r.value));
    }
  };
  walk(reqKeys(model.manifest));
  for (const h of opts.hints ?? []) out.push({ source: h.source, text: h.text });
  return out;
}

// текст → {hints: [{id, when, expect, message, question, line}], errors: [{line, msg}]}
export function parseHints(text) {
  const errors = [], hints = [];
  const r = loadYaml(text);
  if (r.error) return { hints, errors: [{ line: r.line ?? 0, msg: `YAML: ${r.error}` }] };
  const doc = r.value;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.hints)) return { hints, errors: [{ line: 0, msg: '`hints:` жагсаалт алга' }] };
  const re = (s, at, line) => { try { return new RegExp(String(s), 'iu'); } catch (e) { errors.push({ line, msg: `${at}: regex «${s}» — ${e.message}` }); return null; } };
  const ids = new Set();
  for (const h of doc.hints) {
    const line = lineOf(h) || 0;
    const id = str(h?.id);
    if (!ID.test(id)) { errors.push({ line, msg: `id «${id}» (a-z0-9._-)` }); continue; }
    if (ids.has(id)) { errors.push({ line, msg: `id «${id}» давхардсан` }); continue; }
    ids.add(id);
    const w = h.when && typeof h.when === 'object' ? h.when : null;
    if (!w || !w.tableMatch && !w.columnMatch) { errors.push({ line, msg: `${id}: when.tableMatch эсвэл when.columnMatch заавал` }); continue; }
    if (w.machine !== undefined && typeof w.machine !== 'boolean') { errors.push({ line, msg: `${id}: when.machine — true/false` }); continue; }
    const when = { table: w.tableMatch ? re(w.tableMatch, `${id}.when.tableMatch`, line) : null, column: w.columnMatch ? re(w.columnMatch, `${id}.when.columnMatch`, line) : null, machine: w.machine };
    const ex = Array.isArray(h.expect) ? h.expect : h.expect ? [h.expect] : [];
    const expect = [];
    for (const e of ex) {
      if (!e || typeof e !== 'object' || !KINDS.includes(e.has) || typeof e.match !== 'string') { errors.push({ line, msg: `${id}: expect — { has: ${KINDS.join('|')}, match: "<regex>" }` }); continue; }
      const rx = re(e.match, `${id}.expect.${e.has}`, line); if (rx) expect.push({ kind: e.has, re: rx, src: e.match });
    }
    if (!expect.length) { errors.push({ line, msg: `${id}: expect хоосон` }); continue; }
    if (!str(h.message) || !str(h.question)) { errors.push({ line, msg: `${id}: message, question заавал` }); continue; }
    if ((w.tableMatch && !when.table) || (w.columnMatch && !when.column)) continue;
    hints.push({ id, when, expect, message: str(h.message), question: str(h.question), line });
  }
  return { hints, errors };
}

const decisionNames = (model) => model.dmn.flatMap((d) => [...String(d.text).matchAll(/<(?:\w+:)?decision\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]));
// хүснэгтийн хүрээнд expect биелэх эсэх
export function satisfied(model, table, e) {
  const t = model.tables.get(table);
  const cols = t?.columns ?? [];
  const machines = model.machines.filter((m) => m.table === table);
  switch (e.kind) {
    case 'column': return cols.some((c) => e.re.test(c.name));
    case 'unique': return cols.some((c) => e.re.test(c.name) && (c.unique || c.pk || (c.tags ?? []).some((g) => /^unique$/i.test(String(g.tag)))));
    case 'state': return machines.some((m) => m.states.some((s) => e.re.test(s.name)));
    case 'transition': return machines.some((m) => m.transitions.some((x) => e.re.test(x.caption)));
    case 'comment': return machines.some((m) => m.transitions.some((x) => x.requireComment && e.re.test(x.caption)));
    case 'table': return [...model.tables.keys()].some((n) => e.re.test(n));
    case 'decision': return decisionNames(model).some((n) => e.re.test(n));
    case 'report': return model.reports.some((r) => e.re.test(str(r.name)));
    default: return false;
  }
}

export const hintsCheck = {
  id: 'hints', layer: 'B3',
  run(model, emit, opts = {}) {
    const fired = new Set();
    for (const src of hintSources(model, opts)) {
      const { hints, errors } = parseHints(src.text);
      for (const e of errors)
        emit({ code: 'HINTS-INVALID', element: src.file ? `file:${src.file}` : ref.package(model.key || '?'), discriminator: `${src.source}:${e.msg}`.slice(0, 120),
          file: src.file ?? model.manifestFile ?? 'manifest.yaml', line: src.file ? e.line : 0, message: `${src.source}: ${e.msg}`, fix: 'docs/brd-standard README «Домэйны жишиг (hints.yaml)»' });
      for (const h of hints) {
        if (fired.has(h.id)) continue; // ижил id-тай жишиг өөр эхэд — эхнийх
        fired.add(h.id);
        for (const [tn, t] of model.tables) {
          if (h.when.table && !h.when.table.test(tn)) continue;
          if (h.when.column && !t.columns.some((c) => h.when.column.test(c.name))) continue;
          if (h.when.machine !== undefined && model.machines.some((m) => m.table === tn) !== h.when.machine) continue;
          if (h.expect.some((e) => satisfied(model, tn, e))) continue;
          emit({ code: 'DOMAIN-HINT', element: ref.table(tn), discriminator: h.id, file: t.file, line: t.line,
            message: h.question.replace(/\{name\}/g, tn), fix: `${h.message} (жишиг «${h.id}», ${src.source}; хүлээгдэж буй: ${h.expect.map((e) => `${e.kind} /${e.src}/`).join(' | ')})` });
        }
      }
    }
  },
};
