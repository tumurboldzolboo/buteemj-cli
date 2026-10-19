// Хаалттай JSON Schema шалгагч (draft 2020-12-ийн дэд олонлог — VS Code `yaml.schemas`-д ч ашиглагдана).
// Объектын `additionalProperties` анхдагчаар **false**: стандартад байхгүй түлхүүр = алдаа (сервер чимээгүй алгасдаг тул).
// Дэмжих: type, properties, required, additionalProperties (bool | schema), patternProperties, items, enum, const, pattern, minimum, maximum,
// minItems, oneOf/anyOf (`x-discriminator` — тэр түлхүүрийн утгаар салаа сонгоно), $ref (#/$defs/…), allOf.
// Өргөтгөл: `x-ref: <төрөл>` — утга нь нэрээр лавлагаа (хүснэгт, багана, төлөв …): `refs`-д цуглуулж семантик шатанд шалгана;
// `x-expr: <хэл>` — илэрхийлэл (x0 | calc | filter | template): `exprs`-д цуглуулна. `x-scalar-or-list: true` — «a» эсвэл [a, b].
import { lineOf } from './yaml.mjs';

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const typeOk = (v, t) => {
  const a = typeOf(v);
  if (Array.isArray(t)) return t.some((x) => typeOk(v, x));
  if (t === 'number') return a === 'number' || a === 'integer';
  return a === t;
};

function resolve(root, s) {
  let x = s;
  for (let guard = 0; x && x.$ref && guard < 20; guard++) {
    const path = x.$ref.replace(/^#\//, '').split('/');
    let y = root;
    for (const k of path) y = y?.[k];
    if (!y) throw new Error(`схем: ${x.$ref} алга`);
    x = { ...y, ...Object.fromEntries(Object.entries(x).filter(([k]) => k !== '$ref')) };
  }
  return x;
}

const fmtPath = (path) => path.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '') || '(үндэс)';

// → {errors: [{path, line, message}], refs: [{path, line, kind, value, parent}], exprs: [{path, line, lang, value, parent}]}
export function validateSchema(value, rootSchema) {
  const out = { errors: [], refs: [], exprs: [] };
  walk(value, rootSchema, rootSchema, [], null, null, out);
  return out;
}

function walk(v, schema, root, path, parent, key, out) {
  const s = resolve(root, schema);
  const line = (v && typeof v === 'object' ? lineOf(v) : 0) || lineOf(parent, key);
  const err = (message) => out.errors.push({ path: fmtPath(path), line, message });
  if (s === true || !s) return;
  if (s.allOf) for (const sub of s.allOf) walk(v, sub, root, path, parent, key, out);
  if (s['x-scalar-or-list'] && !Array.isArray(v) && v !== null && typeof v !== 'object') {
    walk([v], { ...s, 'x-scalar-or-list': false }, root, path, parent, key, out);
    return;
  }
  if (s.oneOf || s.anyOf) {
    const branches = s.oneOf ?? s.anyOf;
    const disc = s['x-discriminator'];
    if (disc && v && typeof v === 'object' && !Array.isArray(v)) {
      const dv = v[disc] ?? s['x-discriminator-default'];
      const b = branches.map((b) => resolve(root, b)).find((b) => { const c = b.properties?.[disc]; return c && (c.const === dv || c.enum?.includes(dv)); });
      if (!b) { err(`«${disc}: ${dv ?? '(алга)'}» танигдахгүй — боломжит: ${branches.map((b) => { const c = resolve(root, b).properties?.[disc]; return c?.const ?? c?.enum?.join('|'); }).filter(Boolean).join(', ')}`); return; }
      walk(v, b, root, path, parent, key, out);
      return;
    }
    let best = null;
    for (const b of branches) {
      const o = { errors: [], refs: [], exprs: [] };
      walk(v, b, root, path, parent, key, o);
      if (!best || o.errors.length < best.errors.length) best = o;
      if (!o.errors.length) break;
    }
    if (best.errors.length && branches.length > 1 && best.errors.every((e) => e.path === fmtPath(path) && /төрөл/.test(e.message))) {
      err(`төрөл буруу (${typeOf(v)}) — ${s.description ?? 'стандартын хэлбэрт таарахгүй'}`);
    } else out.errors.push(...best.errors);
    out.refs.push(...best.refs); out.exprs.push(...best.exprs);
    return;
  }
  if (s.type && !typeOk(v, s.type)) {
    // YAML-д тоо/bool мэт харагдсан утгыг текст гэж хүлээн авна (сервер ч ингэж уншина)
    const t = Array.isArray(s.type) ? s.type : [s.type];
    if (!(t.includes('string') && ['number', 'integer', 'boolean'].includes(typeOf(v)))) { err(`төрөл ${t.join('|')} байх ёстой, ${typeOf(v)} байна`); return; }
  }
  if (s.const !== undefined && v !== s.const) err(`утга «${s.const}» байх ёстой`);
  if (s.enum && !s.enum.includes(v)) err(`«${v}» — боломжит утга: ${s.enum.join(', ')}`);
  if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern, 'u').test(v)) err(`«${v}» хэлбэр буруу${s['x-pattern-hint'] ? ` (${s['x-pattern-hint']})` : ''}`);
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) err(`${v} < ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) err(`${v} > ${s.maximum}`);
  }
  if (v !== null && v !== undefined && typeof v !== 'object') {
    if (s['x-ref']) out.refs.push({ path: fmtPath(path), line, kind: s['x-ref'], value: String(v), parent, key });
    if (s['x-expr']) out.exprs.push({ path: fmtPath(path), line, lang: s['x-expr'], value: String(v), parent, key });
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) err(`хамгийн багадаа ${s.minItems} элемент`);
    if (s.items) v.forEach((x, i) => walk(x, s.items, root, [...path, i], v, i, out));
  } else if (v && typeof v === 'object') {
    const props = s.properties ?? {};
    for (const r of s.required ?? []) if (!(r in v) || v[r] === null || v[r] === '') err(`«${r}» заавал`);
    for (const [k, x] of Object.entries(v)) {
      if (props[k] !== undefined) { walk(x, props[k], root, [...path, k], v, k, out); continue; }
      const pp = Object.entries(s.patternProperties ?? {}).find(([re]) => new RegExp(re, 'u').test(k));
      if (pp) { walk(x, pp[1], root, [...path, k], v, k, out); continue; }
      if (s.additionalProperties === true || (s.additionalProperties === undefined && !s.properties && !s.patternProperties)) continue;
      if (s.additionalProperties && typeof s.additionalProperties === 'object') { walk(x, s.additionalProperties, root, [...path, k], v, k, out); continue; }
      const known = Object.keys(props);
      const near = known.find((n) => n.toLowerCase() === k.toLowerCase()) ?? known.find((n) => lev(n, k) <= 2);
      out.errors.push({ path: fmtPath([...path, k]), line: lineOf(v, k), message: `«${k}» түлхүүр стандартад алга — платформ үүнийг хэрэгжүүлэхгүй${near ? ` (санал: «${near}»)` : known.length ? ` (боломжит: ${known.join(', ')})` : ''}` });
    }
  }
}

export function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
