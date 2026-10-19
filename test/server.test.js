import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverCommand, parseEnv, COMPOSE_TEMPLATE } from '../src/server.js';

function mk({ volumeExists = false, missing = [], upCode = 0, healthy = true } = {}) {
  const calls = []; const out = [];
  return {
    calls, out,
    deps: {
      env: {}, log: (m) => out.push(m), err: (m) => out.push(m), sleep: async () => {},
      now: (() => { let t = 0; return () => (t += 1000); })(),
      fetch: async () => ({ ok: healthy }),
      exec: (cmd, args) => {
        calls.push([cmd, ...args].join(' '));
        if (args[0] === 'volume') return { code: volumeExists ? 0 : 1, stdout: '', stderr: '' };
        if (args[0] === 'image') return { code: missing.some((m) => args[2].includes(m)) ? 1 : 0, stdout: '', stderr: '' };
        if (args.includes('up')) return { code: upCode, stdout: '', stderr: 'boom' };
        return { code: 0, stdout: 'cgi running', stderr: '' };
      },
    },
  };
}

describe('bj server', () => {
  it('first start: generates 0600 .env with random secrets, writes compose, waits for health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bjs-'));
    try {
      const m = mk();
      assert.equal(await serverCommand('start', { dir, port: '18090', project: 'bjt' }, m.deps), 0);
      const env = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
      assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
      assert.equal(env.BJ_HTTP_PORT, '18090');
      assert.equal(env.COMPOSE_PROJECT_NAME, 'bjt');
      assert.match(env.POSTGRES_PASSWORD, /^[0-9a-f]{48}$/);
      assert.ok(existsSync(join(dir, 'compose.yml')));
      assert.ok(m.calls.some((c) => c.startsWith('docker compose -p bjt') && c.endsWith('up -d --remove-orphans')));
      assert.ok(m.out.some((l) => l.includes('http://localhost:18090') ) && m.out.some((l) => l.includes(env.BJ_ADMIN_PASSWORD)));
      // second start reuses the same password
      assert.equal(await serverCommand('start', { dir }, mk().deps), 0);
      assert.equal(parseEnv(readFileSync(join(dir, '.env'), 'utf8')).POSTGRES_PASSWORD, env.POSTGRES_PASSWORD);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses when an old pgdata volume exists without .env (password mismatch guard)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bjs-'));
    try {
      const m = mk({ volumeExists: true });
      assert.equal(await serverCommand('start', { dir }, m.deps), 1);
      assert.ok(!existsSync(join(dir, '.env')));
      assert.ok(m.out.some((l) => l.includes('buteemj_pgdata')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports missing local images; pulls when registry set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bjs-'));
    try {
      const m = mk({ missing: ['migrate'] });
      assert.equal(await serverCommand('start', { dir }, m.deps), 1);
      assert.ok(m.out.some((l) => l.includes('buteemj-platform-migrate:latest')));
      const m2 = mk();
      assert.equal(await serverCommand('start', { dir, registry: 'reg.example/bj' }, m2.deps), 0);
      assert.equal(parseEnv(readFileSync(join(dir, '.env'), 'utf8')).BUTEEMJ_REGISTRY, 'reg.example/bj/');
      assert.ok(m2.calls.some((c) => c.endsWith(' pull')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('health timeout → exit 1; status/logs/stop --purge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bjs-'));
    try {
      assert.equal(await serverCommand('start', { dir, timeout: '5' }, mk({ healthy: false }).deps), 1);
      const m = mk();
      assert.equal(await serverCommand('status', { dir }, m.deps), 0);
      assert.equal(await serverCommand('logs', { dir, service: 'migrate', follow: true }, m.deps), 0);
      assert.ok(m.calls.some((c) => c.endsWith('logs --tail 200 -f migrate')));
      assert.equal(await serverCommand('stop', { dir, purge: true }, m.deps), 0);
      assert.ok(m.calls.some((c) => c.endsWith('down -v --remove-orphans')));
      assert.ok(!existsSync(join(dir, '.env')));
      assert.equal(await serverCommand('status', { dir }, m.deps), 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('bundled compose template equals platform/docker/compose.dist.yml (when platform repo is a sibling)', () => {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'platform', 'docker', 'compose.dist.yml');
    if (!existsSync(p)) return;
    assert.equal(readFileSync(COMPOSE_TEMPLATE, 'utf8'), readFileSync(p, 'utf8'));
  });
});
