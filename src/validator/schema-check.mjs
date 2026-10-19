// P12.1 туслах: каталогийн нэг төрлийн схемийг корпусын бүх багцын тухайн файлуудаар шалгана.
// `node scripts/validate/schema-check.mjs <төрөл> [корпусын packages хавтас]` → олдвор бүр файл:мөр.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadYaml } from './yaml.mjs';
import { validateSchema } from './schema.mjs';
import { loadCatalog } from './index.mjs';

const [kind, root = join(import.meta.dirname, '..', '..', '..', 'corpus', 'packages')] = process.argv.slice(2);
const cat = loadCatalog();
const schema = cat.schemas[kind];
if (!schema) { console.error(`${kind}.schema.json каталогт алга`); process.exit(2); }
const kindOf = (f, listed) => {
  const base = f.replace(/\.ya?ml$/i, '').split('/').pop();
  const k = Object.keys(listed).find((k) => [listed[k]].flat().includes(f));
  return k && k !== 'seed' ? k : f.startsWith('calc/') ? 'calc' : f.startsWith('i18n/') ? 'i18n' : base;
};
let n = 0, files = 0;
for (const pkg of readdirSync(root)) {
  const dir = join(root, pkg);
  if (!existsSync(join(dir, 'manifest.yaml'))) continue;
  const listed = loadYaml(readFileSync(join(dir, 'manifest.yaml'), 'utf8')).value?.files ?? {};
  const walk = (d) => { for (const x of readdirSync(d)) { const p = join(d, x); if (statSync(p).isDirectory()) walk(p); else if (/\.ya?ml$/.test(x)) {
    const f = relative(dir, p);
    if (kindOf(f, listed) !== kind) continue;
    files++;
    const r = validateSchema(loadYaml(readFileSync(p, 'utf8')).value, schema);
    for (const e of r.errors) { n++; console.log(`${pkg}/${f}:${e.line} ${e.path}: ${e.message}`); }
  } } };
  walk(dir);
}
console.log(`${kind}: ${files} файл, ${n} алдаа`);
process.exit(n ? 1 : 0);
