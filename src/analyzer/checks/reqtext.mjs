// PLAN15 D4 — шаардлагын текстийн чанарын дохио (requirements.md «Шаардлага» багана). Зөвлөмж — хаахгүй.
//  REQ-VAGUE     — бүдэг үг (хэмжигдэхгүй: «хурдан», «хялбар», «ойролцоогоор», «гэх мэт», «шаардлагатай бол» …)
//  REQ-DUPLICATE — бараг ижил хоёр шаардлага (үгийн Jaccard ≥ 0.85, ≥ 5 үг)
//  REQ-MODAL     — нэг элементийн тухай нэг нь «заавал/хийнэ», нөгөө нь «болохгүй/хориотой/шаардлагагүй» (зөрчлийн нэр дэвшигч)
import { ref } from '../model.mjs';
import { tag, vocabulary } from '../cnl.mjs';

const str = (v) => String(v ?? '').trim();
// «бусад» (…-аас бусад = хасах), «олон» (олон баркод = 1:N), «сайн» — корпуст нарийн утгаар хэрэглэгддэг тул жагсаалтад оруулаагүй
export const VAGUE = ['хурдан', 'удаан биш', 'хялбар', 'амархан', 'ойлгомжтой', 'ойролцоогоор', 'гэх мэт', 'шаардлагатай бол', 'боломжтой бол', 'хангалттай',
  'тохиромжтой', 'уян хатан', 'найдвартай', 'хэрэглэгчдэд ээлтэй', 'дөхөм', 'гоё', 'муу биш', 'ихэвчлэн', 'заримдаа', 'аль болох', 'шаардлагын дагуу', 'зохих', 'бүх төрлийн', 'гэх зэрэг'];
const POS = /(заавал|хийнэ|бүртгэнэ|шаардана|байх ёстой|автоматаар)/;
const NEG = /(болохгүй|хориотой|шаардлагагүй|хийхгүй|бүртгэхгүй|байж болохгүй|хориглоно)/;
const words = (t) => str(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);

export const reqtextCheck = {
  id: 'reqtext', layer: 'D4',
  run(model, emit) {
    const reqs = model.requirements;
    for (const r of reqs) {
      const t = str(r.text).toLowerCase();
      // хаалт доторх тайлбар (жишээ, тодруулга) — бүдэг үгийг тоолохгүй
      const bare = t.replace(/\([^)]*\)/g, ' ');
      const hit = VAGUE.filter((w) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u').test(bare));
      if (hit.length)
        emit({ code: 'REQ-VAGUE', element: ref.requirement(r.id), discriminator: hit.join(','), file: r.file, line: r.line,
          message: `${r.id}: хэмжигдэхгүй үг — ${hit.map((w) => `«${w}»`).join(', ')}`, fix: 'тоо, нөхцөл, жагсаалтаар тодорхой болгоно (жишээ: «хурдан» → «2 секундэд»)' });
    }
    const W = reqs.map((r) => new Set(words(r.text)));
    for (let i = 0; i < reqs.length; i++) for (let j = i + 1; j < reqs.length; j++) {
      const a = W[i], b = W[j];
      if (a.size < 5 || b.size < 5) continue;
      const inter = [...a].filter((x) => b.has(x)).length, jac = inter / (a.size + b.size - inter);
      if (jac >= 0.85)
        emit({ code: 'REQ-DUPLICATE', element: ref.requirement(reqs[j].id), discriminator: reqs[i].id, file: reqs[j].file, line: reqs[j].line,
          message: `${reqs[j].id} нь ${reqs[i].id}-тэй бараг ижил (${Math.round(jac * 100)}%)`, evidence: [{ file: reqs[i].file, line: reqs[i].line }, { file: reqs[j].file, line: reqs[j].line }],
          fix: 'нэгтгэх эсвэл ялгааг тодорхой бичнэ' });
    }
    // модаль зөрчил: ижил элементийн нэр (толиноос) + эсрэг туйл
    const vocab = vocabulary(model);
    const tagged = reqs.map((r) => {
      const t = str(r.text);
      const names = new Set(tag(t, vocab).found.map((f) => f.name));
      return { r, names, pos: POS.test(t.toLowerCase()) && !NEG.test(t.toLowerCase()), neg: NEG.test(t.toLowerCase()) };
    });
    for (let i = 0; i < tagged.length; i++) for (let j = i + 1; j < tagged.length; j++) {
      const a = tagged[i], b = tagged[j];
      if (!((a.pos && b.neg) || (a.neg && b.pos))) continue;
      const common = [...a.names].filter((n) => b.names.has(n));
      if (common.length < 2 || common.length !== a.names.size || common.length !== b.names.size) continue; // яг ижил элементүүдийн тухай (хэсэгчилсэн давхцал биш)
      emit({ code: 'REQ-MODAL', element: ref.requirement(b.r.id), discriminator: a.r.id, file: b.r.file, line: b.r.line,
        message: `${a.r.id} ба ${b.r.id}: ижил элемент (${common.slice(0, 3).join(', ')}) — нэг нь «заавал/хийнэ», нөгөө нь «болохгүй/шаардлагагүй»`,
        evidence: [{ file: a.r.file, line: a.r.line }, { file: b.r.file, line: b.r.line }], fix: 'нөхцөлөөр ялгах (хэзээ заавал, хэзээ хориотой) эсвэл нэгийг засна' });
    }
  },
};
