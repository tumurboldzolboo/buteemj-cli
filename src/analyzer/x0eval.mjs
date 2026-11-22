// PLAN15 A4 — X0 үнэлэгч: web/src/lib/expr.ts (сервер Expr.cpp-тэй нэг тестийн вектороор шалгагддаг).
// Эх сурвалж: (1) `./vendor/expr.mjs` — CLI/Studio-гийн хуулбарт sync үед expr.ts, geo.ts, regexp.ts-ээс төрлийг хассан хувилбар (Node ≥ 20);
// (2) платформын repo-д `../../web/src/lib/expr.ts`. Аль нь ч байхгүй бол предикатын хангагдах эсэхийн шалгалт алгасагдана — ХЭ гаргахгүй.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let evaluate = null;
export const x0Evaluate = () => evaluate;
// bundle (Studio esbuild) — динамик URL импорт ажиллахгүй тул vendor/expr.mjs-ийг статикаар импортлоод энд өгнө
export function setX0Evaluate(fn) { evaluate = typeof fn === 'function' ? fn : null; }
export async function loadX0() {
  if (evaluate) return true;
  for (const rel of ['./vendor/expr.mjs', '../../web/src/lib/expr.ts']) {
    try {
      const u = new URL(rel, import.meta.url);
      if (!existsSync(fileURLToPath(u))) continue;
      evaluate = (await import(u.href)).evaluate;
      if (evaluate) return true;
    } catch { evaluate = null; }
  }
  return false;
}
