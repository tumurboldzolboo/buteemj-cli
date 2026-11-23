// PLAN15 A0 — BRD+PRD-ийн загварын шинжилгээ (сервергүй, детерминист, LLM-гүй).
// `scripts/validate/`-ээс тусдаа: validate-ийн олдвор, parity, гаралтын код, царцаалтын hash хөндөгдөхгүй (PLAN15 §0.4).
// Шалгалт = `{id, layer, run(model, emit)}`; `emit({code, element, file, line, message, evidence?, fix?, discriminator?})`.
// Нэг шалгалт унавал `AN-CHECK-FAILED` олдвор болж бусад нь үргэлжилнэ. Гаралт эрэмбэлэгдсэн, ижил оролтод ижил.
import { createHash } from 'node:crypto';
import { validatePackage } from '../validator/index.mjs';
import { loadYaml } from '../validator/yaml.mjs';
import { CODES, SEVERITIES, severityRank } from './codes.mjs';
import { buildModel, lineText, ref } from './model.mjs';

export { CODES, SEVERITIES, ref, buildModel };

import { statesCheck } from './checks/states.mjs';
import { permissionsCheck } from './checks/permissions.mjs';
import { decisionsCheck } from './checks/decisions.mjs';
import { predicatesCheck } from './checks/predicates.mjs';
import { coverageCheck } from './checks/coverage.mjs';
import { slotsCheck, completeness } from './checks/slots.mjs';
import { cnlCheck } from './checks/cnl.mjs';
import { reqtextCheck } from './checks/reqtext.mjs';
import { irCheck } from './checks/ir.mjs';
import { staticCheck } from './checks/static.mjs';
import { hintsCheck } from './checks/hints.mjs';
import { irCoverage } from './ir.mjs';
export { loadX0, setX0Evaluate } from './x0eval.mjs';

// PLAN15 A1–A5 — дарааллаар ажиллана (гаралт эрэмбэлэгддэг тул дараалал үр дүнд нөлөөлөхгүй)
export const CHECKS = [statesCheck, permissionsCheck, decisionsCheck, predicatesCheck, coverageCheck, slotsCheck, cnlCheck, reqtextCheck, irCheck, staticCheck, hintsCheck];
export { completeness };

export const findingId = (code, element, discriminator = '') =>
  `F-${createHash('sha256').update(`${code}\u0000${element}\u0000${discriminator}`).digest('hex').slice(0, 12)}`;

// files: {<зам>: текст}; opts: {packages: Map<key,{key,files}>, catalog, checks: [...] (тестэд), validate: false (алгасах), hints: [{source, text}] (B3)}
export function analyzePackage(files, opts = {}) {
  const checks = opts.checks ?? CHECKS;
  const model = buildModel(files);
  let findings = [];
  const seen = new Set();
  const push = (f) => { if (!seen.has(f.id)) { seen.add(f.id); findings.push(f); } };

  const makeEmit = (check) => (x) => {
    const meta = CODES[x?.code];
    if (!meta) throw new Error(`бүртгэлгүй код «${x?.code}» (${check.id}) — scripts/analyze/codes.mjs-д нэмнэ`);
    if (x.severity !== undefined && !SEVERITIES.includes(x.severity)) throw new Error(`${x.code}: severity «${x.severity}» буруу`);
    if (typeof x.element !== 'string' || !x.element.includes(':')) throw new Error(`${x.code}: element «${x?.element}» лавлагаа биш`);
    const file = String(x.file ?? '') || model.manifestFile || 'manifest.yaml'; // багцын түвшний олдвор → manifest
    const line = Number.isInteger(x.line) && x.line > 0 ? x.line : 0;
    const evidence = (x.evidence ?? (file && line ? [{ file, line }] : []))
      .map((e) => ({ file: String(e.file ?? ''), line: Number.isInteger(e.line) ? e.line : 0, text: e.text ?? lineText(model, e.file, e.line) }));
    const f = { id: findingId(x.code, x.element, x.discriminator ?? ''), code: x.code, severity: x.severity ?? meta.severity, layer: meta.layer,
      element: x.element, file, line, message: String(x.message ?? meta.title), evidence };
    if (x.fix) f.fix = String(x.fix);
    if (x.discriminator) f.discriminator = String(x.discriminator);
    push(f);
  };

  let partial = false;
  if (opts.validate !== false) {
    const v = validatePackage(files, { catalog: opts.catalog, packages: opts.packages ?? new Map() });
    if (v.errors > 0) {
      partial = true;
      makeEmit({ id: 'input' })({ code: 'AN-INPUT-INVALID', element: ref.package(model.key || '?'), file: model.manifestFile ?? 'manifest.yaml', line: 0,
        message: `validate ${v.errors} алдаатай — задлагдаагүй элемент шинжилгээнд ороогүй`, evidence: [], fix: '`bj validate`-ийн алдааг засаад дахин ажиллуулна' });
    }
  }

  for (const check of checks) {
    try { check.run(model, makeEmit(check), opts); }
    catch (e) {
      makeEmit({ id: 'runner' })({ code: 'AN-CHECK-FAILED', element: ref.package(model.key || '?'), file: model.manifestFile ?? 'manifest.yaml', line: 0, discriminator: check.id,
        message: `шалгалт «${check.id}» (${check.layer}) ажиллаж чадсангүй: ${String(e?.message ?? e).slice(0, 300)}`, evidence: [] });
    }
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.file.localeCompare(b.file) || a.line - b.line
    || a.code.localeCompare(b.code) || a.element.localeCompare(b.element) || a.id.localeCompare(b.id));
  // PLAN15 C5: questions.yaml-д хүлээн зөвшөөрсөн олдвор (dismissed, эсвэл answered + BRD-д буулгасан атлаа үлдсэн — шийдвэрийн мөр) — үндсэн жагсаалтаас гаргана.
  // `acknowledge: false` (bj questions sync/apply) — бүх олдвор (эс бөгөөс хүлээн зөвшөөрсөн асуулт resolved болно)
  let acknowledged = [];
  if (opts.acknowledge !== false && typeof files['questions.yaml'] === 'string') {
    const r = loadYaml(files['questions.yaml']);
    const byId = new Map((r.error ? [] : r.value?.questions ?? []).filter((q) => q?.id).map((q) => [q.id, q]));
    const ack = (f) => { const q = byId.get(`Q-${f.id.slice(2)}`); return q && (q.status === 'dismissed' || (q.status === 'answered' && q.applied_at)) ? q : null; };
    acknowledged = findings.filter(ack).map((f) => ({ id: f.id, code: f.code, element: f.element, question: `Q-${f.id.slice(2)}`, status: ack(f).status }));
    const drop = new Set(acknowledged.map((a) => a.id));
    findings = findings.filter((f) => !drop.has(f.id));
  }
  const out = { key: model.key, partial, findings, stats: { ...SEVERITIES.reduce((a, s) => ({ ...a, [s]: findings.filter((f) => f.severity === s).length }), {}), acknowledged: acknowledged.length, checks: checks.length } };
  if (acknowledged.length) out.acknowledged = acknowledged;
  if (opts.completeness !== false) out.completeness = completeness(model); // PLAN15 B2
  if (opts.completeness !== false) { const c = irCoverage(model); if (c) out.sources = { files: c.files, total: c.total, covered: c.covered, ignored: c.ignored, ratio: c.ratio }; } // PLAN15 E3
  return out;
}
