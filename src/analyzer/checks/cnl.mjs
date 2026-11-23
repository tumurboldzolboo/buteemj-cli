// PLAN15 D2/D3 — загварт хэлний баримт (brd.md) ↔ загвар. brd.md байхгүй бол юу ч хийхгүй.
//  CNL-UNPARSED (advisory)    — загварт таарахгүй мөр (D3: «загварт оруулж дахин бичих эсвэл формоор»)
//  CNL-NOT-MODELED (important) — текстэд бий, загварт алга (bj cnl apply эсвэл асуултаар нэмнэ)
//  CNL-CONFLICT (important)    — загвар текстийн эсрэг (хориг ↔ зөвшөөрөл, өөр зорилт/хэн)
import { ref } from '../model.mjs';
import { parseDocument, compare } from '../cnl.mjs';

export const CNL_FILE = 'brd.md';
export function factElement(f) {
  if (f.kind === 'right') return { element: ref.table(f.table), discriminator: `${f.role.toLowerCase()}:${f.op}` };
  if (f.kind === 'transition') return { element: ref.transition(f.machine ?? f.table, f.caption, f.from), discriminator: f.guard?.length || f.comment ? 'guard' : '' };
  if (f.kind === 'required' || f.kind === 'unique') return { element: ref.column(f.table, f.column), discriminator: f.kind };
  if (f.kind === 'block') return { element: ref.transition(f.machine ?? f.table, f.caption, f.from), discriminator: 'block' };
  return { element: ref.state(f.machine ?? f.table, f.state), discriminator: 'final' };
}
export const factText = (f) => ({
  right: `${f.role} — «${f.table}» ${{ view: 'харах', create: 'үүсгэх', update: 'засах', remove: 'устгах' }[f.op]}${f.value === '-' ? ' хориотой' : ''}`,
  transition: `«${f.table}» ${f.from} → ${f.to} («${f.caption}», хэн: ${(f.who ?? []).join(', ')}${f.comment || f.guard?.length ? `, нөхцөл: ${[f.comment ? 'тайлбар заавал' : null, ...(f.guard ?? [])].filter(Boolean).join(' and ')}` : ''})`,
  block: `«${f.table}» ${f.from}: «${f.caption}» нь ${(f.when ?? []).join(' ба ')} үед хийгдэхгүй`,
  required: `«${f.table}.${f.column}» заавал`, unique: `«${f.table}.${f.column}» давтагдахгүй`, final: `«${f.table}» ${f.state} эцсийн төлөв`,
}[f.kind]);

export const cnlCheck = {
  id: 'cnl', layer: 'D2',
  run(model, emit) {
    const text = model.source[CNL_FILE];
    if (typeof text !== 'string') return;
    const { facts, unparsed } = parseDocument(text, model);
    for (const u of unparsed)
      emit({ code: 'CNL-UNPARSED', element: `file:${CNL_FILE}#${u.line}`, discriminator: u.text.slice(0, 80), file: CNL_FILE, line: u.line,
        message: `«${u.text.slice(0, 120)}» — загварт хэлний (EARS-MN) өгүүлбэр биш; загвар руу буухгүй`,
        fix: 'загвараар дахин бичнэ (жишээ: «Менежер Захиалгыг үүсгэнэ, засна.», «Захиалга Ноорог үед Менежер «Батлах»-аар Батлагдсан болгоно.») эсвэл тайлбар бол `>` ишлэлээр' });
    for (const f of facts) {
      const st = compare(f, model);
      if (st === 'present') continue;
      const { element, discriminator } = factElement(f);
      emit({ code: st === 'conflict' ? 'CNL-CONFLICT' : 'CNL-NOT-MODELED', element, discriminator: `${f.kind}:${discriminator}`, file: CNL_FILE, line: f.line,
        message: st === 'conflict' ? `brd.md: ${factText(f)} — загвар эсрэгээр (roles.csv/states.mmd/erd.dbml)` : `brd.md: ${factText(f)} — загварт алга`,
        fix: st === 'conflict' ? 'текст эсвэл загварын аль нэгийг засна' : '`bj cnl apply` (текстийн дагуу загварт нэмнэ) эсвэл асуултаар' });
    }
  },
};
