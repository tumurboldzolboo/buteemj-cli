// T3b WP-J: X0 (нэгдсэн илэрхийлэл) задлалт — серверийн expr::parse-тэй ижил (web/src/lib/expr.ts — C++ Expr.cpp-тэй нэг vector-оор шалгагдсан).
// Платформын эх хавтсанд л байна (CLI-ийн хуулбарт байхгүй бол шалгалтыг алгасна — false positive гаргахгүй).
// Top-level await-гүй (studio CJS build) — платформын ESM оролт regexp-loader.mjs-ийн loadRegexpCanonical()-аар ачаална.
let evaluate = null;
export function setX0Evaluate(fn) { evaluate = typeof fn === 'function' ? fn : null; }

export const x0Available = () => !!evaluate;
// задлалтын алдаа бол false (утгын/ажиллах үеийн алдаа хамаагүй)
export function x0Parses(expr) {
  if (!evaluate) return true;
  const r = evaluate(String(expr ?? ''), {});
  return r.ok || r.errorKind !== 'parse';
}
