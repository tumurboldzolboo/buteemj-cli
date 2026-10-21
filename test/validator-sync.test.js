// PLAN14 S7 — src/validator нь платформын scripts/validate ба каталогийн хуулбар; хуучирвал худал алдаа гарна (2026-10-22: generator delete/onDuplicate).
// Платформ хажууд нь (../platform) байхгүй орчинд алгасна.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const platform = join(here, '..', 'platform');
const pairs = [[join(platform, 'scripts', 'validate'), join(here, 'src', 'validator')], [join(platform, 'docs', 'brd-standard', 'catalog'), join(here, 'src', 'validator', 'catalog')]];
const files = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? files(join(d, n)).map((f) => join(n, f)) : [n]);

test('validator copy matches the platform source', { skip: !existsSync(platform) && 'platform алга' }, () => {
  const stale = [];
  for (const [src, dst] of pairs) for (const f of files(src)) {
    if (f.endsWith('test.mjs') || f.startsWith('catalog')) continue;
    const copy = join(dst, f);
    if (!existsSync(copy) || readFileSync(copy, 'utf8') !== readFileSync(join(src, f), 'utf8')) stale.push(relative(here, copy));
  }
  assert.deepEqual(stale, [], 'хуучирсан — `npm run sync-validator`');
});
