#!/usr/bin/env node
// PLAN15 C — `node scripts/analyze/questions-cli.mjs <list|sync|answer|confirm|dismiss> <багцын хавтас> [...]`
//   list    [--status=open|answered|…|all] [--json] — шинжилгээ + questions.yaml-ийн нэгтгэл (файлд бичихгүй)
//   sync    — questions.yaml-д нэгтгэж бичнэ (idempotent: өөрчлөлтгүй бол файлд хүрэхгүй)
//   answer  <Q-id> <хариулт> [--by=<нэвтрэх нэр>] [--agent] — answered (хүн) | assumed (агент)
//   confirm <Q-id> --by=<нэвтрэх нэр> — assumed → answered
//   dismiss <Q-id> [--note=<шалтгаан>]
//   apply   [--dry-run] [--only=Q-…,Q-…] — answered асуултыг BRD-д буулгана (C3, patch.mjs), дараа нь дахин шинжилж sync (засагдсан → resolved)
// Гаралтын код: 0 — амжилттай, 1 — `list --fail-open`-д нээлттэй blocking/important асуулт байна, 2 — ажиллаж чадсангүй.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { analyzePackage, loadX0, buildModel } from './index.mjs';
import { loadCatalog } from '../validator/index.mjs';
import { loadRegexpCanonical } from '../validator/regexp-loader.mjs';
import { applyAnswers } from './patch.mjs';
import { QUESTIONS_FILE, questionsFrom, mergeQuestions, parseQuestions, renderQuestions, answerQuestion, confirmQuestion, dismissQuestion, STATUSES } from './questions.mjs';

const TEXT = /\.(ya?ml|md|csv|mmd|dbml|dmn|bpmn|html|json|txt|sql|svg)$/i;
const args = process.argv.slice(2);
const flag = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : args.includes(`--${n}`) ? true : null; };
const pos = args.filter((a) => !a.startsWith('--'));
const [sub, dirArg, ...rest] = pos;
const die = (m) => { console.error(m); process.exit(2); };
if (!['list', 'sync', 'answer', 'confirm', 'dismiss', 'apply'].includes(sub) || !dirArg) die('хэрэглээ: questions-cli.mjs <list|sync|answer|confirm|dismiss|apply> <багцын хавтас> [...]');
const dir = resolve(dirArg);
if (!existsSync(join(dir, 'manifest.yaml'))) die(`${dir}: manifest.yaml алга`);

const read = (d) => { const files = {}; const w = (x) => { for (const n of readdirSync(x)) { if (n.startsWith('.') || n === 'node_modules') continue; const p = join(x, n); if (statSync(p).isDirectory()) w(p); else if (TEXT.test(n)) files[relative(d, p).split('\\').join('/')] = readFileSync(p, 'utf8'); } }; w(d); return files; };
const qPath = join(dir, QUESTIONS_FILE);
const existing = () => parseQuestions(existsSync(qPath) ? readFileSync(qPath, 'utf8') : null);
const write = (doc) => {
  const text = renderQuestions(doc);
  if (existsSync(qPath) && readFileSync(qPath, 'utf8') === text) return false;
  writeFileSync(qPath, text);
  return true;
};

try {
  if (sub === 'answer' || sub === 'confirm' || sub === 'dismiss') {
    const doc = existing();
    if (!doc) die(`${QUESTIONS_FILE} алга — эхлээд sync`);
    const [id, ...value] = rest;
    if (!id) die('Q-id шаардлагатай');
    const q = sub === 'answer' ? answerQuestion(doc, id, value.join(' '), { by: flag('by') || '', agent: !!flag('agent') })
      : sub === 'confirm' ? confirmQuestion(doc, id, flag('by') || die('--by=<нэвтрэх нэр> шаардлагатай'))
        : dismissQuestion(doc, id, flag('note') || '');
    write(doc);
    console.log(`✓ ${q.id}: ${q.status}${q.answer !== undefined ? ` — ${JSON.stringify(q.answer)}` : ''}`);
    process.exit(0);
  }
  await loadRegexpCanonical();
  await loadX0();
  if (sub === 'apply') {
    const doc = existing();
    if (!doc) die(`${QUESTIONS_FILE} алга — эхлээд sync`);
    const files = read(dir);
    const only = typeof flag('only') === 'string' ? flag('only').split(',').map((x) => x.trim()) : null;
    const r = applyAnswers(files, doc, buildModel(files), { only });
    for (const a of r.applied) console.log(`  ${a.note ? '·' : '✓'} ${a.id}: ${a.summary}`);
    for (const k of r.skipped) console.log(`  ! ${k.id}: ${k.reason}`);
    const changed = Object.keys(r.files).filter((f) => r.files[f] !== files[f]);
    if (flag('dry-run')) { console.log(`(dry-run) ${r.applied.length} хариулт, ${changed.length} файл өөрчлөгдөнө: ${changed.join(', ') || '—'}`); process.exit(0); }
    for (const f of changed) {
      const target = resolve(dir, f);
      if (!target.startsWith(dir + '/')) die(`багцаас гадуурх зам: ${f}`);
      writeFileSync(target, r.files[f]);
    }
    // дахин шинжилж нэгтгэнэ — patch хийгдсэн олдвор алга болж resolved
    const after = read(dir);
    const analysis2 = analyzePackage(after, { catalog: loadCatalog(), completeness: false });
    const merged = mergeQuestions(r.doc, questionsFrom(analysis2, buildModel(after)));
    write(merged.doc);
    console.log(`✓ ${r.applied.length} хариулт буулгав (${changed.join(', ') || 'файл өөрчлөгдөөгүй'}); шийдэгдсэн ${merged.changes.resolved.length}, шинэ асуулт ${merged.changes.added.length}`);
    process.exit(0);
  }
  const files = read(dir);
  const analysis = analyzePackage(files, { catalog: loadCatalog(), completeness: false });
  const { doc, changes } = mergeQuestions(existing(), questionsFrom(analysis, buildModel(files)));
  if (sub === 'sync') {
    const wrote = write(doc);
    console.log(`${wrote ? '✓' : '='} ${relative(process.cwd(), qPath) || QUESTIONS_FILE}: шинэ ${changes.added.length}, дахин нээгдсэн ${changes.reopened.length}, шийдэгдсэн ${changes.resolved.length}, хэвээр ${changes.kept}${wrote ? '' : ' (өөрчлөлтгүй)'}`);
    process.exit(0);
  }
  const want = flag('status') ?? 'open';
  if (want !== 'all' && !STATUSES.includes(want)) die(`--status=${want}: ${STATUSES.join(' | ')} | all`);
  const list = doc.questions.filter((q) => want === 'all' || q.status === want);
  if (flag('json')) { console.log(JSON.stringify({ ...doc, questions: list }, null, 2)); process.exit(0); }
  const count = Object.fromEntries(STATUSES.map((s) => [s, doc.questions.filter((q) => q.status === s).length]));
  console.log(`${analysis.key}: асуулт ${doc.questions.length} — ${STATUSES.map((s) => `${count[s]} ${s}`).join(', ')}`);
  for (const q of list) {
    console.log(`  ${q.id} ${q.severity.padEnd(9)} [${q.status}] ${q.ask}`);
    if (q.options?.length) console.log(`              сонголт: ${q.options.slice(0, 6).join(' | ')}${q.options.length > 6 ? ' …' : ''}`);
    if (q.answer !== undefined) console.log(`              хариулт: ${JSON.stringify(q.answer)}${q.answered_by ? ` (${q.answered_by})` : ''}`);
  }
  if (flag('fail-open') && doc.questions.some((q) => q.status === 'open' && q.severity !== 'advisory')) process.exit(1);
  process.exit(0);
} catch (e) { die(`асуулт: ${e?.message ?? e}`); }
