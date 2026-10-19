// YAML → JS утга, серверийн `Yaml.cpp`-тэй ижил скаляр дүрмээр (хашилттай — үргэлж текст; true/yes → bool, бүхэл/бутархай → тоо,
// null/~/хоосон → null). Объект/массив бүрт эх мөрийн дугаарыг `lineOf(obj, key?)`-аар авна (алдааны мэдээнд).
import { parseDocument, LineCounter, isMap, isSeq, isScalar } from './vendor/yaml.mjs';

const LINES = new WeakMap(); // obj → {'': мөр, <түлхүүр|индекс>: мөр}

const reInt = /^-?[0-9]{1,17}$/;
const reNum = /^-?[0-9]+\.[0-9]+$/;
function scalar(node) {
  const src = node.source ?? (node.value === null || node.value === undefined ? '' : String(node.value));
  if (node.type && node.type !== 'PLAIN') return src; // хашилттай, block scalar (| >) — текст
  const s = String(src);
  if (['true', 'True', 'TRUE', 'yes', 'Yes'].includes(s)) return true;
  if (['false', 'False', 'FALSE', 'no', 'No'].includes(s)) return false;
  if (['null', '~', 'Null', 'NULL', ''].includes(s)) return null;
  if (reInt.test(s)) return Number(s);
  if (reNum.test(s)) return Number(s);
  return s;
}

function convert(node, lc) {
  if (!node) return null;
  const line = (n) => (n?.range ? lc.linePos(n.range[0]).line : 0);
  if (isScalar(node)) return scalar(node);
  if (isSeq(node)) {
    const a = [];
    const meta = { '': line(node) };
    node.items.forEach((it, i) => { meta[i] = line(it); a.push(convert(it, lc)); });
    LINES.set(a, meta);
    return a;
  }
  if (isMap(node)) {
    const o = {};
    const meta = { '': line(node) };
    for (const p of node.items) {
      const k = isScalar(p.key) ? String(p.key.source ?? p.key.value) : String(p.key);
      meta[k] = line(p.key);
      if (Object.prototype.hasOwnProperty.call(o, k)) meta[`dup:${k}`] = line(p.key);
      o[k] = convert(p.value, lc);
    }
    LINES.set(o, meta);
    return o;
  }
  // alias г.м.
  return node.toJSON ? node.toJSON() : null;
}

// {value, error, line} — error бол value = null
export function loadYaml(text) {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false, keepSourceTokens: false, prettyErrors: false });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const ln = e.pos ? lc.linePos(e.pos[0]).line : 0;
    return { value: null, error: e.message.split('\n')[0], line: ln };
  }
  const dups = [];
  const value = convert(doc.contents, lc);
  return { value, error: null, line: 0, dups };
}

export function lineOf(obj, key) {
  if (!obj || typeof obj !== 'object') return 0;
  const m = LINES.get(obj);
  if (!m) return 0;
  if (key === undefined) return m[''] ?? 0;
  return m[key] ?? m[''] ?? 0;
}

export function duplicateKeys(obj) {
  const m = obj && typeof obj === 'object' ? LINES.get(obj) : null;
  if (!m) return [];
  return Object.keys(m).filter((k) => k.startsWith('dup:')).map((k) => ({ key: k.slice(4), line: m[k] }));
}
