// T3b WP-J/L: web/src/lib/{regexp,expr}.ts-ийг validator-т холбоно (зөвхөн платформын repo-д — web/ байвал). Async тул ESM оролтод л.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setRegexpCanonical } from './exprsql.mjs';
import { setX0Evaluate } from './x0.mjs';

export async function loadRegexpCanonical() {
  try {
    const u = new URL('../../web/src/lib/regexp.ts', import.meta.url);
    if (existsSync(fileURLToPath(u))) setRegexpCanonical((await import(u.href)).canonical);
  } catch { setRegexpCanonical(null); }
  try { // T3b WP-J: X0 задлалт (web/src/lib/expr.ts)
    const u = new URL('../../web/src/lib/expr.ts', import.meta.url);
    if (existsSync(fileURLToPath(u))) setX0Evaluate((await import(u.href)).evaluate);
  } catch { setX0Evaluate(null); }
}
