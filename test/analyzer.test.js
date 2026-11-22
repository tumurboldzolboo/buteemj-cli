// PLAN15 A6 — `bj analyze`: src/analyzer нь платформын scripts/analyze-ийн хуулбар (хуучирвал буруу олдвор), X0 үнэлэгч vendor/-оос.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProjectFiles } from '../src/init.js';
import { analyzePackage, loadX0 } from '../src/analyze.js';

const here = fileURLToPath(new URL('..', import.meta.url));
const platformSync = join(here, '..', 'platform', 'scripts', 'analyze', 'sync.mjs');
const list = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? list(join(d, n)).map((f) => join(n, f)) : [n]));

describe('bj analyze', () => {
  it('analyzer copy matches a fresh sync of platform scripts/analyze', { skip: !existsSync(platformSync) && 'platform алга' }, () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bj-an-'));
    try {
      const r = spawnSync(process.execPath, ['--no-warnings', platformSync, join(tmp, 'analyzer')], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const fresh = list(join(tmp, 'analyzer')).sort(), copy = list(join(here, 'src', 'analyzer')).sort();
      assert.deepEqual(copy, fresh, 'файлын жагсаалт зөрсөн — `npm run sync-validator`');
      const stale = fresh.filter((f) => readFileSync(join(tmp, 'analyzer', f), 'utf8') !== readFileSync(join(here, 'src', 'analyzer', f), 'utf8'));
      assert.deepEqual(stale, [], 'хуучирсан — `npm run sync-validator`');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('scaffold has no blocking or important findings', () => {
    const r = analyzePackage(createProjectFiles('Тест', 'test-an', true));
    assert.equal(r.partial, false);
    assert.equal(r.stats.blocking + r.stats.important, 0, JSON.stringify(r.findings));
  });

  it('finds an unreachable state and an enum typo', () => {
    const f = createProjectFiles('Тест', 'test-an', true);
    f['states.mmd'] += '    Архив --> Зөвшөөрсөн : Сэргээх\n';
    f['states.mmd'] = f['states.mmd'].replace('Илгээсэн --> Цуцалсан : Цуцлах', 'Илгээсэн --> Цуцалсан : Цуцлах [Төлөв == "Илгээгдсэн"]');
    const codes = analyzePackage(f).findings.map((x) => x.code);
    assert.ok(codes.includes('SM-UNREACHABLE'), codes.join());
    assert.ok(codes.includes('X0-ENUM-LITERAL'), codes.join());
  });

  it('loads the vendored X0 evaluator (satisfiability checks run without the platform)', async () => {
    assert.equal(await loadX0(), true);
    const f = createProjectFiles('Тест', 'test-an', true);
    f['states.mmd'] = f['states.mmd'].replace('Ноорог --> Илгээсэн : Илгээх', 'Ноорог --> Илгээсэн : Илгээх [Гарчиг == "а" and Гарчиг == "б"]');
    assert.ok(analyzePackage(f).findings.some((x) => x.code === 'X0-NEVER-TRUE'));
  });

  it('CLI exit codes: 0 by default, 1 with --fail-on, 2 on a bad level', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bj-an-cli-'));
    try {
      const bj = (...a) => spawnSync(process.execPath, [join(here, 'bin', 'bj.js'), 'analyze', ...a], { encoding: 'utf8' });
      // `bj init` одоогийн хавтаст <key> хавтас үүсгэнэ — cwd = tmp
      const init = spawnSync(process.execPath, [join(here, 'bin', 'bj.js'), 'init', 'Тест', '--key', 'test-an'], { encoding: 'utf8', cwd: tmp });
      assert.equal(init.status, 0, init.stderr);
      const p = join(tmp, 'test-an');
      assert.equal(bj(p).status, 0);
      assert.equal(bj(p, '--fail-on=advisory').status, 1); // scaffold: SM-NO-ACTOR зөвлөмж
      assert.equal(bj(p, '--min=bad').status, 2);
      const c = bj(p, '--completeness');
      assert.match(c.stdout, /бүрэн гүйцэд байдал \d+%/);
      assert.match(c.stdout, /machine\.reject/);
      const j = JSON.parse(bj(p, '--json', '--min=important').stdout);
      assert.ok(Array.isArray(j.findings) && j.findings.every((x) => x.severity !== 'advisory'));
      assert.ok(j.completeness && typeof j.completeness.score === 'number');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
