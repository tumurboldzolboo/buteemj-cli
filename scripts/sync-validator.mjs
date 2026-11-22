// PLAN13 N3 — BRD+PRD validator-ын цорын ганц эх нь платформын `scripts/validate/`. Энэ скрипт түүнийг `src/validator/`-д хуулна
// (CLI нь платформын кодгүй тараагддаг тул импортлохгүй, хуулбарлана). Гараар засахгүй: `npm run sync-validator`.
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? join(here, '..', '..', 'platform', 'scripts', 'validate'));
const dst = join(here, '..', 'src', 'validator');
if (!existsSync(join(src, 'index.mjs'))) { console.error(`validator олдсонгүй: ${src}`); process.exit(2); }
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith('test.mjs') });
const catalog = join(src, '..', '..', 'docs', 'brd-standard', 'catalog');
if (existsSync(catalog)) cpSync(catalog, join(dst, 'catalog'), { recursive: true });
writeFileSync(join(dst, 'README.md'), '# validator (хуулбар)\n\nПлатформын `scripts/validate/`-ийн хуулбар — гараар засахгүй. Шинэчлэх: `npm run sync-validator`.\n');
console.log(`✓ ${src} → ${dst}`);
// PLAN15 F: MCP-ийн get_standard — стандартын README ба слотын мета-загвар (src/standard/)
const std = join(src, '..', '..', 'docs', 'brd-standard');
if (existsSync(join(std, 'README.md'))) {
  const out = join(here, '..', 'src', 'standard');
  rmSync(out, { recursive: true, force: true });
  cpSync(join(std, 'README.md'), join(out, 'README.md'));
  if (existsSync(join(std, 'slots.yaml'))) cpSync(join(std, 'slots.yaml'), join(out, 'slots.yaml'));
  console.log(`✓ ${std}/README.md → ${out}`);
}
// PLAN15 A6: шинжилгээ (platform scripts/analyze → src/analyzer, X0 үнэлэгч vendor/-д)
const analyzeSync = join(src, '..', 'analyze', 'sync.mjs');
if (existsSync(analyzeSync)) {
  const r = spawnSync(process.execPath, ['--no-warnings', analyzeSync, join(here, '..', 'src', 'analyzer')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 2);
} else console.warn(`! шинжилгээ олдсонгүй: ${analyzeSync} — src/analyzer шинэчлэгдсэнгүй`);
