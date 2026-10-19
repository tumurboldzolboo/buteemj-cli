// PLAN13 N3 — BRD+PRD validator-ын цорын ганц эх нь платформын `scripts/validate/`. Энэ скрипт түүнийг `src/validator/`-д хуулна
// (CLI нь платформын кодгүй тараагддаг тул импортлохгүй, хуулбарлана). Гараар засахгүй: `npm run sync-validator`.
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
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
