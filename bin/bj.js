#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { initProject } from '../src/init.js';
import { readPackageFiles, validatePackage } from '../src/validate.js';
import { ButeemjClient } from '../src/api.js';

const VERSION = '0.1.0';

function findProjectRoot(startDir = process.cwd()) {
  for (let p = resolve(startDir); ; p = dirname(p)) {
    if (existsSync(join(p, 'manifest.yaml')) || existsSync(join(p, 'manifest.yml'))) {
      return p;
    }
    if (dirname(p) === p) break;
  }
  return null;
}

function showHelp() {
  console.log(`
Бүтээмж CLI (bj) v${VERSION} — BRD+PRD багцын хөгжүүлэлтийн туслах

ХЭРЭГЛЭЭ:
  bj <команд> [сонголтууд]

КОМАНДУУД:
  init <нэр>              Шинэ BRD+PRD багцын загвар үүсгэх
  validate [хавтас]       Багцын загваруудыг локалд (сервергүй) шалгах
  status                  Бүтээмжийн серверийн холболтын төлөвийг шалгах
  lint [хавтас]           Сервер дээр хуурай шалгалт (dry-run lint) хийх
  plan [хавтас]           Серверт ноорог илгээж migration plan тооцоолох
  apply [хавтас]          Бэлтгэсэн plan-ийг өгөгдлийн санд хэрэгжүүлэх
  deploy [хавтас]         Шалгах -> Plan -> Apply нэг тушаалаар хийх
  pull [хавтас]           Сервер дээрх хэрэгжсэн загварыг татаж авах

СОНГОЛТУУД:
  --key <түлхүүр>         Төслийн key (зөвхөн init команд дээр)
  --url <хаяг>            Бүтээмж серверийн хаяг (анхдагч: BUTEEMJ_URL эсвэл http://localhost)
  --user <хэрэглэгч>      Серверийн хэрэглэгч (анхдагч: admin)
  --pass <нууц_үг>        Серверийн нууц үг (анхдагч: changeme123)
  --allow-destructive     Өгөгдөл устгах өөрчлөлтийг зөвшөөрөх
  --json                  Үр дүнг зөвхөн JSON хэлбэрээр хэвлэх
  --help, -h              Энэхүү тусламжийг харуулах
  --version, -v           Хувилбарыг харуулах
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`@buteemj/cli v${VERSION}`);
    process.exit(0);
  }

  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (['key', 'url', 'user', 'pass'].includes(a.slice(2))) {
        flags[a.slice(2)] = args[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      pos.push(a);
    }
  }

  const cmd = pos[0];
  const targetArg = pos[1];

  // 1. INIT
  if (cmd === 'init') {
    const name = targetArg || 'Шинэ систем';
    const key = flags.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-project';
    const targetDir = resolve(process.cwd(), key);
    try {
      initProject(targetDir, name, key, true);
      console.log(`✓ Төсөл амжилттай үүслээ: ${targetDir}`);
      console.log(`  Хавтас руу орох: cd ${key}`);
      console.log(`  Шалгах:         bj validate`);
      process.exit(0);
    } catch (e) {
      console.error(`✗ Алдаа: ${e.message}`);
      process.exit(1);
    }
  }

  // 2. STATUS
  if (cmd === 'status') {
    const client = new ButeemjClient(flags);
    const health = await client.health();
    if (health.ok) {
      console.log(`✓ Бүтээмжийн сервер хэвийн ажиллаж байна (${client.baseUrl})`);
    } else {
      console.error(`✗ Бүтээмжийн серверт холбогдож чадсангүй (${client.baseUrl}): ${health.error || health.status}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Find project dir
  const dir = targetArg ? resolve(targetArg) : findProjectRoot();
  if (!dir) {
    console.error('✗ Алдаа: Төслийн хавтас олдсонгүй (manifest.yaml байхгүй байна).');
    console.log('  Төслийн хавтас руу орж эсвэл замаа зааж ажиллуулна уу: bj <команд> [хавтас]');
    process.exit(2);
  }

  // 3. VALIDATE
  if (cmd === 'validate') {
    const { files } = readPackageFiles(dir);
    const res = validatePackage(files);
    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    }

    for (const f of res.findings) {
      const icon = f.severity === 'error' ? '✗' : '!';
      console.log(`${icon} ${f.severity.padEnd(7)} [${[f.stage, f.code].filter(Boolean).join(" ")} ${f.file}${f.line ? `:${f.line}` : ""}] ${f.message}`);
    }

    if (res.ok) {
      console.log(`✓ Загвар шалгалт амжилттай: 0 алдаа, ${res.warnings} анхааруулга (${res.stats.files} файл, ${res.stats.tables} хүснэгт, ${res.stats.requirements} шаардлага)`);
      process.exit(0);
    } else {
      console.error(`\n✗ Баталгаажуулалт уналаа: ${res.errors} алдаа байна. Засаад дахин ажиллуулна уу.`);
      process.exit(1);
    }
  }

  // Server commands: lint, plan, apply, deploy, pull
  const client = new ButeemjClient(flags);

  // 4. LINT
  if (cmd === 'lint') {
    const { files } = readPackageFiles(dir);
    console.log(`Сервер дээр хуурай шалгалт (lint) хийж байна: ${client.baseUrl} ...`);
    const res = await client.lint(files);
    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    }
    for (const f of res.findings || []) {
      const icon = f.severity === 'error' ? '✗' : f.severity === 'warning' ? '!' : '·';
      console.log(`${icon} ${f.severity.padEnd(7)} [${f.file || f.stage}] ${f.message}`);
    }
    if (res.ok) {
      console.log(`✓ Серверийн шалгалт давлаа: 0 алдаа, ${res.warnings || 0} анхааруулга`);
      process.exit(0);
    } else {
      console.error(`✗ Серверийн шалгалт уналаа: ${res.errors} алдаа байна.`);
      process.exit(1);
    }
  }

  // 5. PLAN
  if (cmd === 'plan' || cmd === 'deploy') {
    const { files } = readPackageFiles(dir);
    // 1st validate locally
    const v = validatePackage(files);
    if (!v.ok) {
      console.error(`✗ Алдаа: Локал шалгалт уналаа (${v.errors} алдаа). Эхлээд алдааг засна уу: bj validate`);
      process.exit(1);
    }

    const key = files['manifest.yaml']?.match(/^key:\s*["']?([A-Za-z0-9_.-]+)["']?/m)?.[1];
    console.log(`Серверт ноорог илгээж байна (${key})...`);
    await client.importSolution(files);

    console.log(`Migration Plan тооцоолж байна...`);
    const plan = await client.generatePlan(key);

    const planDir = join(dir, '.bj');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${key}.plan.json`), JSON.stringify(plan, null, 2), 'utf8');

    console.log(`\n=== БҮТЭЭМЖ MIGRATION PLAN ===`);
    console.log(`  Төслийн түлхүүр: ${key}`);
    console.log(`  Plan Hash:       ${plan.planHash}`);
    console.log(`  Хаалт (Blocking): ${plan.blocking ?? 0}`);
    console.log(`  Асуулт:          ${plan.questions?.length ?? 0}`);
    console.log(`  Шинэ/Өөрчлөлт:   ${plan.summary || 'Өөрчлөлтүүд бэлэн'}`);
    console.log(`  Хадгалсан файл:  .bj/${key}.plan.json\n`);

    if (cmd === 'plan') {
      console.log(`Хэрэгжүүлэхийн тулд дараах тушаалыг ажиллуулна уу:`);
      console.log(`  bj apply`);
      process.exit(0);
    }
  }

  // 6. APPLY
  if (cmd === 'apply' || cmd === 'deploy') {
    const { files } = readPackageFiles(dir);
    const key = files['manifest.yaml']?.match(/^key:\s*["']?([A-Za-z0-9_.-]+)["']?/m)?.[1];
    const planFile = join(dir, '.bj', `${key}.plan.json`);

    let planData;
    if (existsSync(planFile)) {
      planData = JSON.parse(readFileSync(planFile, 'utf8'));
    } else {
      console.log(`Хадгалсан plan олдсонгүй, шинээр plan гаргаж байна...`);
      await client.importSolution(files);
      planData = await client.generatePlan(key);
    }

    if (Number(planData.blocking) > 0) {
      console.error(`✗ Алдаа: Plan-д хаалттай асуудлууд (${planData.blocking}) байна. Зассаны дараа дахин plan гаргана уу.`);
      process.exit(1);
    }

    console.log(`Өгөгдлийн санд хэрэгжүүлж байна (apply)...`);
    const res = await client.applyPlan(key, planData.planHash);
    console.log(`✓ Migration амжилттай хэрэгжлээ!`);
    if (flags.json) console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  // 7. PULL
  if (cmd === 'pull') {
    const { files } = readPackageFiles(dir);
    const key = files['manifest.yaml']?.match(/^key:\s*["']?([A-Za-z0-9_.-]+)["']?/m)?.[1];
    console.log(`Серверээс татаж байна (${key})...`);
    const exp = await client.exportSolution(key);
    for (const [path, content] of Object.entries(exp.files || {})) {
      writeFileSync(join(dir, path), content, 'utf8');
    }
    console.log(`✓ Серверийн загвар амжилттай татагдаж хадгалагдлаа.`);
    process.exit(0);
  }

  console.error(`Үл мэдэгдэх команд: ${cmd}. Тусламж авах бол "bj --help" ажиллуулна уу.`);
  process.exit(2);
}

main().catch(err => {
  console.error(`✗ Алдаа: ${err.message}`);
  process.exit(1);
});
