#!/usr/bin/env node
// PLAN15 E4 — эх баримт: `node scripts/analyze/sources-cli.mjs <add|list> <багцын хавтас> [...]`
//   add <файл> [--name=<нэр>] [--force] — docx/xlsx/pdf/md/txt → sources/<нэр>.md (локал задлалт; сервер рүү юу ч илгээхгүй). Байгаа файлыг --force-гүй дарахгүй.
//   table <sources/x.md> [--table=N] [--map=text=Тайлбар,id=№,…] [--dry-run] [--json] — стандарт бус шаардлагын хүснэгт → requirements.md + sources/ir.json (PLAN15 D5)
//   list [--json]                       — sources/ дахь эх баримт, догол мөрийн тоо, IR-ийн хамралт
// Гаралтын код: 0 — амжилттай, 2 — ажиллаж чадсангүй.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { extractSourceAsync } from './extract.mjs';
import { paragraphs, irCoverage } from './ir.mjs';
import { buildModel } from './model.mjs';
import { convertTable } from './reqtable.mjs';
import { loadYaml } from '../validator/yaml.mjs';

const TEXT = /\.(ya?ml|md|csv|mmd|dbml|dmn|bpmn|html|json|txt|sql|svg)$/i;
const args = process.argv.slice(2);
const flag = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : args.includes(`--${n}`) ? true : null; };
const pos = args.filter((a) => !a.startsWith('--'));
const [sub, dirArg, fileArg] = pos;
const die = (m) => { console.error(m); process.exit(2); };
if (!['add', 'list', 'table'].includes(sub) || !dirArg) die('хэрэглээ: sources-cli.mjs <add|list|table> <багцын хавтас> [<файл>] [--name=…] [--force] [--json]');
const dir = resolve(dirArg);
if (!existsSync(join(dir, 'manifest.yaml'))) die(`${dir}: manifest.yaml алга`);
const read = (d) => { const files = {}; const w = (x) => { for (const n of readdirSync(x)) { if (n.startsWith('.') || n === 'node_modules') continue; const p = join(x, n); if (statSync(p).isDirectory()) w(p); else if (TEXT.test(n)) files[relative(d, p).split('\\').join('/')] = readFileSync(p, 'utf8'); } }; w(d); return files; };

try {
  if (sub === 'add') {
    if (!fileArg) die('файл заана: add <файл>');
    const src = resolve(fileArg);
    if (!existsSync(src) || !statSync(src).isFile()) die(`${src}: файл алга`);
    const buf = readFileSync(src);
    const { kind, markdown } = await extractSourceAsync(src, buf);
    const raw = typeof flag('name') === 'string' ? flag('name') : basename(src, extname(src));
    const name = raw.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'source';
    const rel = `sources/${name}.md`, out = join(dir, rel);
    if (existsSync(out) && !flag('force')) die(`${rel} аль хэдийн байна — --force-оор дарж бичнэ (IR-ийн ¶ дугаар шилжиж болно)`);
    const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const text = `<!-- эх: ${basename(src).replace(/--/g, '-')} · ${kind} · sha256:${sha} · bj sources add -->\n\n${markdown}`;
    mkdirSync(join(dir, 'sources'), { recursive: true });
    writeFileSync(out, text);
    console.log(`${rel}: ${kind} → ${paragraphs(text).length} догол мөр (sha256:${sha})`);
    process.exit(0);
  }
  if (sub === 'table') {
    if (!fileArg) die('эх файл заана: table <sources/x.md>');
    const files = read(dir);
    const source = relative(dir, resolve(dir, fileArg)).split('\\').join('/');
    const map = Object.fromEntries(String(typeof flag('map') === 'string' ? flag('map') : '').split(',').map((x) => x.split('=').map((y) => y.trim())).filter(([k, v]) => k && v));
    const bad = Object.keys(map).filter((k) => !['id', 'kind', 'text', 'priority', 'links'].includes(k));
    if (bad.length) die(`--map: танихгүй түлхүүр ${bad.join(', ')} (id, kind, text, priority, links)`);
    const man = loadYaml(files['manifest.yaml']).value ?? {};
    const reqFile = [man.files?.requirements].flat().find((f) => typeof f === 'string' && f.endsWith('.md')) ?? 'requirements.md';
    const r = convertTable(files, source, { table: typeof flag('table') === 'string' ? flag('table') : null, map, reqFile });
    if (flag('json')) { console.log(JSON.stringify({ tables: r.tables, rows: r.rows, skipped: r.skipped, inferred: r.inferred }, null, 2)); }
    else {
      for (const t of r.tables) console.log(`хүснэгт #${t.index} (${t.rows} мөр): ${Object.entries(t.map).map(([k, v]) => `${k}=${v ?? '—'}`).join(', ')}`);
      for (const x of r.rows) console.log(`+ ${x.id.padEnd(6)} ${x.kind.padEnd(2)} ${x.priority}  ${x.text.slice(0, 90)}`);
      for (const x of r.inferred) console.log(`? :${x.line} ${x.id ?? ''} ${x.field}: «${x.from}» → ${x.to} (таамаг — шалгана)`);
      for (const x of r.skipped) console.log(`- :${x.line} ${x.reason}`);
    }
    const irChanged = r.ir && r.ir !== files['sources/ir.json'];
    if (!flag('dry-run')) {
      if (r.rows.length) writeFileSync(join(dir, reqFile), r.requirements);
      if (irChanged) { mkdirSync(join(dir, 'sources'), { recursive: true }); writeFileSync(join(dir, 'sources/ir.json'), r.ir); }
    }
    const wrote = [r.rows.length ? reqFile : null, irChanged ? 'sources/ir.json' : null].filter(Boolean);
    console.log(`\n${r.rows.length} шаардлага; ${wrote.length ? `${flag('dry-run') ? 'бичих байсан (--dry-run)' : 'бичив'}: ${wrote.join(', ')}` : 'өөрчлөлтгүй'}; ${r.inferred.length} таамаг, ${r.skipped.length} алгасав`);
    process.exit(0);
  }
  const files = read(dir), model = buildModel(files);
  const list = Object.keys(files).filter((f) => /^sources\/.+\.(md|txt)$/i.test(f)).sort().map((f) => {
    const origin = /<!-- эх: (.+?) · (\w+) · sha256:([0-9a-f]+)/.exec(files[f]);
    return { file: f, paragraphs: paragraphs(files[f]).length, ...(origin ? { origin: origin[1], kind: origin[2], sha256: origin[3] } : {}) };
  });
  const cov = irCoverage(model);
  if (flag('json')) console.log(JSON.stringify({ sources: list, coverage: cov && { total: cov.total, covered: cov.covered, ignored: cov.ignored, ratio: cov.ratio } }, null, 2));
  else {
    for (const s of list) console.log(`${s.file.padEnd(36)} ${String(s.paragraphs).padStart(4)} догол${s.origin ? `  ← ${s.origin} (${s.kind})` : ''}`);
    if (!list.length) console.log('sources/ хоосон — `bj sources add <файл>`');
    if (cov) console.log(`\nхамралт: ${cov.covered}/${cov.total - cov.ignored}${cov.ignored ? ` (${cov.ignored} хассан)` : ''} — ${Math.round(cov.ratio * 100)}%${cov.hasIr ? '' : ' (sources/ir.json алга)'}`);
  }
} catch (e) { die(e.message ?? String(e)); }
