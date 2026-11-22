// PLAN15 B2 — бүрэн гүйцэд байдлын тайлангийн текст (cli.mjs, bj.mjs, @buteemj/cli, Studio — нэг хэлбэр)
import SLOTS from './slots.data.mjs';

const pct = (x) => `${Math.round(x * 100)}%`;
// нэг мөрийн хураангуй
export function completenessLine(c) {
  if (!c) return '';
  const el = Object.entries(c.byElement).filter(([, v]) => v.applicable).map(([k, v]) => `${k} ${v.filled}/${v.applicable}`).join(', ');
  return `бүрэн гүйцэд байдал ${pct(c.score)} (${c.filled}/${c.applicable}: ${el}) · CRUD ${pct(c.crud.ratio)} (${c.crud.decided}/${c.crud.cells})`;
}
// дэлгэрэнгүй: слот бүрээр + бөглөгдөөгүй элементүүд
export function completenessDetail(c) {
  if (!c) return [];
  const out = [];
  for (const s of SLOTS.slots) {
    const v = c.bySlot[s.id];
    if (!v?.applicable) continue;
    const names = c.missing.filter((m) => m.slot === s.id).map((m) => m.name);
    out.push(`  ${v.filled === v.applicable ? '✓' : '·'} ${s.id.padEnd(22)} ${String(v.filled).padStart(3)}/${String(v.applicable).padEnd(3)} ${s.title}${s.coveredBy ? ` [${s.coveredBy}]` : ''}${names.length ? ` — ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` … +${names.length - 5}` : ''}` : ''}`);
  }
  if (c.crud.tablesWithoutAnyRole.length) out.push(`  · CRUD: ямар ч үүрэгт мөргүй хүснэгт — ${c.crud.tablesWithoutAnyRole.slice(0, 8).join(', ')}${c.crud.tablesWithoutAnyRole.length > 8 ? ' …' : ''}`);
  return out;
}
