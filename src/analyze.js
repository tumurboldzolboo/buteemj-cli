// PLAN15 A6 — BRD+PRD-ийн загварын шинжилгээ (LLM-гүй, сервергүй): зөрчил, цоорхой, хамралт.
// Дүрэм нь платформын `scripts/analyze/`-ийнх (src/analyzer/ — `npm run sync-validator`-ын хуулбар, гараар засахгүй); энд давхардуулахгүй.
import { analyzePackage as platformAnalyze, loadX0, SEVERITIES } from './analyzer/index.mjs';
import { severityRank } from './analyzer/codes.mjs';
import { completenessLine, completenessDetail } from './analyzer/report.mjs';

export { loadX0, SEVERITIES, severityRank, completenessLine, completenessDetail };

export function analyzePackage(files, opts = {}) {
  return platformAnalyze(files, { packages: new Map(), ...opts });
}
