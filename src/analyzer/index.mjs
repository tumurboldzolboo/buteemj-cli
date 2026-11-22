// PLAN15 A0 — BRD+PRD-ийн загварын шинжилгээ (сервергүй, детерминист, LLM-гүй).
// `scripts/validate/`-ээс тусдаа: validate-ийн олдвор, parity, гаралтын код, царцаалтын hash хөндөгдөхгүй (PLAN15 §0.4).
// Шалгалт = `{id, layer, run(model, emit)}`; `emit({code, element, file, line, message, evidence?, fix?, discriminator?})`.
// Нэг шалгалт унавал `AN-CHECK-FAILED` олдвор болж бусад нь үргэлжилнэ. Гаралт эрэмбэлэгдсэн, ижил оролтод ижил.
import { createHash } from 'node:crypto';
import { validatePackage } from '../validator/index.mjs';
import { CODES, SEVERITIES, severityRank } from './codes.mjs';
import { buildModel, lineText, ref } from './model.mjs';

export { CODES, SEVERITIES, ref, buildModel };

import { statesCheck } from './checks/states.mjs';
import { permissionsCheck } from './checks/permissions.mjs';
import { decisionsCheck } from './checks/decisions.mjs';
import { predicatesCheck } from './checks/predicates.mjs';
import { coverageCheck } from './checks/coverage.mjs';
import { slotsCheck, completeness } from './checks/slots.mjs';
export { loadX0, setX0Evaluate } from './x0eval.mjs';

// PLAN15 A1–A5 — дарааллаар ажиллана (гаралт эрэмбэлэгддэг тул дараалал үр дүнд нөлөөлөхгүй)
export const CHECKS = [statesCheck, permissionsCheck, decisionsCheck, predicatesCheck, coverageCheck, slotsCheck];
export { completeness };

export const findingId = (code, element, discriminator = '') =>
  `F-${createHash('sha256').update(`${code}\u0000${element}\u0000${discriminator}`).digest('hex').slice(0, 12)}`;

// files: {<зам>: текст}; opts: {packages: Map<key,{key,files}>, catalog, checks: [...] (тестэд), validate: false (алгасах)}
export function analyzePackage(files, opts = {}) {
  const checks = opts.checks ?? CHECKS;
  const model = buildModel(files);
  const findings = [];
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
    try { check.run(model, makeEmit(check)); }
    catch (e) {
      makeEmit({ id: 'runner' })({ code: 'AN-CHECK-FAILED', element: ref.package(model.key || '?'), file: model.manifestFile ?? 'manifest.yaml', line: 0, discriminator: check.id,
        message: `шалгалт «${check.id}» (${check.layer}) ажиллаж чадсангүй: ${String(e?.message ?? e).slice(0, 300)}`, evidence: [] });
    }
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.file.localeCompare(b.file) || a.line - b.line
    || a.code.localeCompare(b.code) || a.element.localeCompare(b.element) || a.id.localeCompare(b.id));
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const out = { key: model.key, partial, findings, stats: { ...bySeverity, checks: checks.length } };
  if (opts.completeness !== false) out.completeness = completeness(model); // PLAN15 B2
  return out;
}
