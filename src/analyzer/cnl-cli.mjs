#!/usr/bin/env node
// PLAN15 D — загварт хэл (EARS-MN): `node scripts/analyze/cnl-cli.mjs <parse|apply|export> <багцын хавтас> [...]`
//   parse  [--file=brd.md] [--json] — өгүүлбэр бүрийг баримт болгож загвартай харьцуулна (present | missing | conflict | unparsed); файлд бичихгүй
//   apply  [--file=brd.md] [--dry-run] — «missing» баримтыг загварт нэмнэ (roles.csv, states.mmd, erd.dbml); «conflict»-д хүрэхгүй
//   export [--write] — загвар → загварт хэлний мөрүүд (stdout; --write бол brd.md, байгаа бол бичихгүй)
//   ir     [--file=brd.md] [--write] — баримтуудыг IR элемент болгоно (sources/ir.json-ийн `CNL-*` элементүүдийг шинэчилнэ, бусдыг хадгална)
//   paras  --file=<файл> [--json] — догол мөрийн дугаарлалт (IR-ийн `source: "<файл>#¶n"`)
// Гаралтын код: 0 — амжилттай, 1 — parse-д conflict/unparsed байна, 2 — ажиллаж чадсангүй.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildModel } from './model.mjs';
import { parseDocument, compare, renderCnl } from './cnl.mjs';
import { applyFacts } from './patch.mjs';
import { factText, factElement } from './checks/cnl.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { IR_FILE, paragraphs } from './ir.mjs';

const TEXT = /\.(ya?ml|md|csv|mmd|dbml|dmn|bpmn|html|json|txt|sql|svg)$/i;
const args = process.argv.slice(2);
const flag = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : args.includes(`--${n}`) ? true : null; };
const [sub, dirArg] = args.filter((a) => !a.startsWith('--'));
const die = (m) => { console.error(m); process.exit(2); };
if (!['parse', 'apply', 'export', 'ir', 'paras'].includes(sub) || !dirArg) die('хэрэглээ: cnl-cli.mjs <parse|apply|export|ir|paras> <багцын хавтас> [--file=brd.md] [--json] [--dry-run] [--write]');
const dir = resolve(dirArg);
if (!existsSync(join(dir, 'manifest.yaml'))) die(`${dir}: manifest.yaml алга`);
const read = (d) => { const files = {}; const w = (x) => { for (const n of readdirSync(x)) { if (n.startsWith('.') || n === 'node_modules') continue; const p = join(x, n); if (statSync(p).isDirectory()) w(p); else if (TEXT.test(n)) files[relative(d, p).split('\\').join('/')] = readFileSync(p, 'utf8'); } }; w(d); return files; };
const file = typeof flag('file') === 'string' ? flag('file') : 'brd.md';

try {
  const files = read(dir);
  if (sub === 'export') {
    const text = `# Бизнесийн дүрэм (загварт хэл, EARS-MN)\n\n> \`bj cnl export\`-ээр загвараас үүсгэв. Өгүүлбэр бүр загвар руу буух баримт; \`bj analyze\` текст ↔ загварын зөрүүг шалгана.\n\n${renderCnl(buildModel(files)).map((l) => `- ${l.text}`).join('\n')}\n`;
    if (flag('write')) {
      if (files[file] !== undefined) die(`${file} аль хэдийн байна — дарж бичихгүй (stdout-оор харж гараар нэгтгэнэ)`);
      writeFileSync(join(dir, file), text); console.log(`${file} бичив`);
    } else process.stdout.write(text);
    process.exit(0);
  }
  if (files[file] === undefined) die(`${file} алга`);
  if (sub === 'paras') {
    const ps = paragraphs(files[file]);
    if (flag('json')) console.log(JSON.stringify(ps, null, 2));
    else for (const p of ps) console.log(`${file}#¶${p.n}`.padEnd(28) + ` :${String(p.line).padEnd(5)} ${p.section ? `[${p.section}] ` : ''}${p.text.slice(0, 140)}`);
    process.exit(0);
  }
  const model = buildModel(files);
  const { facts, unparsed } = parseDocument(files[file], model);
  const rows = facts.map((f) => ({ ...f, status: compare(f, model) }));
  if (sub === 'ir') {
    const ps = paragraphs(files[file]);
    const KIND = { right: 'right', transition: 'transition', required: 'field', unique: 'field', final: 'rule' };
    const items = facts.map((f) => {
      const p = ps.find((x) => x.line === f.line);
      const { element, discriminator } = factElement(f);
      const it = { id: `CNL-${createHash('sha256').update(`${f.kind}\u0000${element}\u0000${discriminator}`).digest('hex').slice(0, 10)}`, kind: KIND[f.kind], text: factText(f), element };
      if (f.role) it.actor = f.role; else if (f.who?.length) it.actor = f.who.join(', ');
      return p ? { ...it, source: `${file}#¶${p.n}`, quote: p.text } : null;
    }).filter(Boolean);
    let doc = { version: 1, items: [] };
    if (files[IR_FILE] !== undefined) { try { doc = JSON.parse(files[IR_FILE]); } catch (e) { die(`${IR_FILE}: JSON алдаа — ${e.message}`); } }
    const keep = (doc.items ?? []).filter((x) => !String(x?.id ?? '').startsWith('CNL-'));
    const uniqItems = [...new Map(items.map((x) => [x.id, x])).values()];
    const out = { ...doc, version: 1, items: [...keep, ...uniqItems] };
    const text = `${JSON.stringify(out, null, 2)}\n`;
    if (flag('write')) {
      if (files[IR_FILE] === text) { console.log(`${IR_FILE}: өөрчлөлтгүй`); process.exit(0); }
      mkdirSync(join(dir, 'sources'), { recursive: true }); writeFileSync(join(dir, IR_FILE), text);
      console.log(`${IR_FILE}: ${uniqItems.length} CNL элемент (бусад ${keep.length} хадгалав)`);
    } else process.stdout.write(text);
    process.exit(0);
  }
  if (sub === 'parse') {
    if (flag('json')) console.log(JSON.stringify({ file, facts: rows, unparsed }, null, 2));
    else {
      for (const r of rows) console.log(`${String(r.line).padStart(4)}  ${r.status.padEnd(8)} ${factText(r)}`);
      for (const u of unparsed) console.log(`${String(u.line).padStart(4)}  unparsed «${u.text}»`);
      const c = (s) => rows.filter((r) => r.status === s).length;
      console.log(`\n${file}: ${rows.length} баримт — present ${c('present')}, missing ${c('missing')}, conflict ${c('conflict')}; unparsed ${unparsed.length}`);
    }
    process.exit(rows.some((r) => r.status === 'conflict') || unparsed.length ? 1 : 0);
  }
  // apply: баримт бүрийн дараа загварыг дахин байгуулна (мөрийн дугаар шилждэг)
  let cur = files; const applied = [], skipped = [];
  for (const f of rows) {
    if (f.status !== 'missing') { if (f.status === 'conflict') skipped.push({ fact: f, reason: 'зөрчил — текст эсвэл загварыг гараар' }); continue; }
    const m = buildModel(cur);
    if (compare(f, m) !== 'missing') continue; // өмнөх баримт аль хэдийн нэмсэн
    const r = applyFacts(cur, m, [f]);
    cur = r.files; applied.push(...r.applied); skipped.push(...r.skipped);
  }
  for (const a of applied) console.log(`+ ${String(a.fact.line).padStart(4)}  ${a.summary}`);
  for (const s of skipped) console.log(`- ${String(s.fact.line).padStart(4)}  ${factText(s.fact)}: ${s.reason}`);
  if (!flag('dry-run')) for (const f of Object.keys(cur)) if (cur[f] !== files[f]) writeFileSync(join(dir, f), cur[f]);
  console.log(`\n${applied.length} нэмэв, ${skipped.length} алгасав${flag('dry-run') ? ' (--dry-run: файлд бичээгүй)' : ''}`);
} catch (e) { die(e.stack ?? String(e)); }
