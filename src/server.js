// ARCH 4.2 — `bj server start|stop|status|logs`: бэлэн image-ээс (platform/docker/compose.dist.yml) локал сервер.
// Docker дуудлага бүр `deps.exec`-ээр (тестэд mock), HTTP `deps.fetch`, хүлээлт `deps.sleep`.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPOSE_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'compose.dist.yml');
export const IMAGES = ['cgi', 'worker', 'web', 'migrate'];

export function defaultExec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe' });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

export function serverDir(flags = {}, env = process.env) {
  return flags.dir || env.BUTEEMJ_SERVER_DIR || join(env.BUTEEMJ_HOME || join(homedir(), '.buteemj'), 'server');
}

export function parseEnv(text) {
  const o = {};
  for (const l of text.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2]; }
  return o;
}
const rnd = (n = 24) => randomBytes(n).toString('hex');
const normReg = (r) => (!r ? '' : r.endsWith('/') ? r : r + '/');

export function writeEnv(file, vals) {
  const body = '# bj server — НУУЦ (0600). POSTGRES_PASSWORD-ийг postgres volume үүссэний дараа энд солихгүй (README).\n'
    + Object.entries(vals).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function ctx(flags, deps) {
  const dir = serverDir(flags, deps.env);
  const envFile = join(dir, '.env');
  const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : null;
  const project = flags.project || env?.COMPOSE_PROJECT_NAME || 'buteemj';
  const dc = (args, o) => deps.exec('docker', ['compose', '-p', project, '--env-file', envFile, '-f', join(dir, 'compose.yml'), ...args], o);
  return { dir, envFile, env, project, dc };
}

async function waitHealth(url, deps, timeoutMs) {
  const t0 = deps.now();
  for (;;) {
    try { const r = await deps.fetch(url + '/api/health'); if (r.ok) return true; } catch { /* асаагүй */ }
    if (deps.now() - t0 >= timeoutMs) return false;
    await deps.sleep(2000);
  }
}

export async function serverCommand(sub, flags = {}, d = {}) {
  const deps = { exec: defaultExec, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now, log: console.log, err: console.error, env: process.env, ...d };
  const { log, err } = deps;
  let c = ctx(flags, deps);

  if (sub === 'start') {
    if (deps.exec('docker', ['version', '--format', '{{.Server.Version}}']).code !== 0) { err('✗ docker ажиллахгүй байна (Docker Desktop/Engine асаана уу)'); return 1; }
    mkdirSync(c.dir, { recursive: true, mode: 0o700 });
    const first = !c.env;
    if (first) {
      // Хуучин volume үлдсэн бол шинэ нууц үг таарахгүй (postgres анхны нууц үгээ хадгалдаг) — эрт зогсооно.
      if (deps.exec('docker', ['volume', 'inspect', `${c.project}_pgdata`]).code === 0) {
        err(`✗ ${c.project}_pgdata volume аль хэдийн байна, гэтэл ${c.envFile} алга — шинэ нууц үг хуучин сантай таарахгүй.`);
        err(`  Хуучин .env-ийг сэргээнэ үү, эсвэл өгөгдлийг устгана: docker volume rm ${c.project}_pgdata (эсвэл өөр --project)`);
        return 1;
      }
      writeEnv(c.envFile, {
        COMPOSE_PROJECT_NAME: c.project, BJ_HTTP_PORT: String(flags.port || 8080), BJ_BIND: flags.bind || '127.0.0.1',
        BUTEEMJ_REGISTRY: normReg(flags.registry ?? deps.env.BUTEEMJ_REGISTRY ?? ''), BUTEEMJ_VERSION: flags.version || deps.env.BUTEEMJ_VERSION || 'latest',
        POSTGRES_DB: 'buteemj', POSTGRES_USER: 'buteemj', POSTGRES_PASSWORD: rnd(), BUTEEMJ_JWT_SECRET: rnd(32),
        BJ_ORG: flags.org || 'Бүтээмж', BJ_ADMIN_LOGIN: 'admin', BJ_ADMIN_PASSWORD: rnd(8),
      });
      log(`✓ ${c.envFile} үүслээ (0600, санамсаргүй DB/JWT/админ нууц үг)`);
    } else if (flags.port || flags.registry !== undefined || flags.bind) {
      const e = { ...c.env };
      if (flags.port) e.BJ_HTTP_PORT = String(flags.port);
      if (flags.bind) e.BJ_BIND = flags.bind;
      if (flags.registry !== undefined) e.BUTEEMJ_REGISTRY = normReg(flags.registry);
      writeEnv(c.envFile, e);
    }
    writeFileSync(join(c.dir, 'compose.yml'), readFileSync(COMPOSE_TEMPLATE, 'utf8'));
    c = ctx(flags, deps);
    const reg = c.env.BUTEEMJ_REGISTRY, ver = c.env.BUTEEMJ_VERSION;
    if (reg) {
      log(`Image татаж байна (${reg}buteemj-platform-*:${ver}) ...`);
      if (c.dc(['pull'], { inherit: true }).code !== 0) { err('✗ image татаж чадсангүй'); return 1; }
    } else {
      const missing = IMAGES.filter((n) => deps.exec('docker', ['image', 'inspect', `buteemj-platform-${n}:${ver}`]).code !== 0);
      if (missing.length) {
        err(`✗ Локал image алга: ${missing.map((n) => `buteemj-platform-${n}:${ver}`).join(', ')}`);
        err('  BUTEEMJ_REGISTRY (эсвэл --registry) заах, эсвэл платформын репод: sh scripts/build-dist-images.sh');
        return 1;
      }
    }
    log('Сервис асааж байна (анхны асалтад цөмийн схем ачаална — 1–2 минут) ...');
    const up = c.dc(['up', '-d', '--remove-orphans']);
    if (up.code !== 0) {
      err('✗ docker compose up амжилтгүй:\n' + (up.stderr || up.stdout));
      err(`  Дэлгэрэнгүй: bj server logs migrate`);
      return 1;
    }
    const url = `http://localhost:${c.env.BJ_HTTP_PORT}`;
    if (!(await waitHealth(url, deps, Number(flags.timeout || 240) * 1000))) { err(`✗ ${url}/api/health хариу өгсөнгүй — bj server logs`); return 1; }
    log(`✓ Бүтээмж сервер ажиллаж байна: ${url}  (compose project: ${c.project})`);
    log(`  Админ: ${c.env.BJ_ADMIN_LOGIN}  нууц үг: ${first ? c.env.BJ_ADMIN_PASSWORD : `(${c.envFile} → BJ_ADMIN_PASSWORD)`}`);
    log('  Анхны нэвтрэлтэд нууц үгээ солино. CLI-ээс: bj status --url ' + url);
    return 0;
  }

  if (!c.env) { err(`✗ Сервер тохируулагдаагүй (${c.envFile} алга). Эхлээд: bj server start`); return 1; }

  if (sub === 'stop') {
    const r = c.dc(flags.purge ? ['down', '-v', '--remove-orphans'] : ['down', '--remove-orphans'], { inherit: true });
    if (r.code !== 0) { err('✗ docker compose down амжилтгүй'); return 1; }
    if (flags.purge) { rmSync(c.envFile, { force: true }); log('✓ Зогсоож, өгөгдөл (volume) болон .env устгалаа'); }
    else log('✓ Зогслоо (өгөгдөл хадгалагдсан; дахин: bj server start)');
    return 0;
  }
  if (sub === 'status') {
    const r = c.dc(['ps', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}']);
    log(r.stdout.trim() || '(ажиллаж буй сервис алга)');
    const url = `http://localhost:${c.env.BJ_HTTP_PORT}`;
    let ok = false;
    try { ok = (await deps.fetch(url + '/api/health')).ok; } catch { /* */ }
    log(ok ? `✓ ${url} эрүүл` : `✗ ${url}/api/health хариугүй`);
    return ok ? 0 : 1;
  }
  if (sub === 'logs') {
    const a = ['logs', '--tail', String(flags.tail || 200)];
    if (flags.follow || flags.f) a.push('-f');
    if (flags.service) a.push(flags.service);
    return c.dc(a, { inherit: true }).code;
  }
  err('✗ Хэрэглээ: bj server start|stop|status|logs [--port N] [--project нэр] [--registry R/] [--purge] [--service S] [--follow]');
  return 2;
}
