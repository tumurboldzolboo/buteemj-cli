// P-WP-2/3/7 (Тоду T4-UI P2, P3, P7) — apps.yaml (апп, нүүр, breadcrumb) ба branding.yaml (лого) — серверийн plan-ийн (SolutionDeploy.cpp
// 7g apps/branding) өгөгдлийн сангаас үл хамаарах шалгалт. Код, мессеж серверийнхтэй ижил. Өнгө/нягтрал/огнооны формат — каталогийн схем.
const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));
export const TARGET_KINDS = ['screen', 'page', 'table', 'report', 'url'];
const LOGO_MAX = 256 * 1024;
// P-WP-11: SolutionDeploy.cpp 7g-тэй ижил
export const MISSING_HINT = ' (одоогоор суулгалтад алга — дараа суух багцынх бол тэр үед шийдэгдэнэ)';

// P-WP-48 (HEADER-COMPACT): header.modules-ийн түлхүүрүүд — AppMenu.cpp headerModuleKeys, web/src/lib/headerConfig.ts-тэй ижил
export const HEADER_MODULES = ['track', 'track-view', 'tasks', 'analytics', 'metrics', 'generators', 'ledger-entries', 'org-admin', 'org-users',
  'diagram', 'bpmn', 'timetable', 'reports', 'admin', 'offline'];

// AppMenu.cpp urlOk-тэй ижил (P-WP-33): http(s)://… эсвэл '/'-ээр эхэлсэн дотоод зам; '//', '\\', ':' хориотой
export const urlOk = (u) => (/^https?:\/\//.test(u) ? u.length > 8 && !/[\s"<>]/.test(u) : u === '/' || (u.length > 1 && u[0] === '/' && u[1] !== '/' && !u.includes('\\') && !u.includes(':')));

// branding_logo: багцын .svg (байх ёстой, ≤ 256KB) | /uploads/… | https://… → алдааны шалтгаан эсвэл ''
export function logoError(logo, files) {
  const l = str(logo);
  if (!l || l === 'none' || l.startsWith('/uploads/') || l.startsWith('https://')) return ''; // P-WP-46: none — логогүй
  if (!/\.svg$/i.test(l)) return 'багцын лого .svg файл байх ёстой (эсвэл /uploads/…, https://…)';
  if (files[l] === undefined) return 'багцад алга';
  if (Buffer.byteLength(files[l], 'utf8') > LOGO_MAX) return '256KB-аас их';
  return '';
}

// ctx: {files, yaml, fileOf, hasTable, strict, screens (энэ багц), foreignScreens, reports (нэрс), add}
export function appsErrors(ctx) {
  const { files, yaml, fileOf, add } = ctx;
  const own = asList(ctx.screens).filter((x) => x && typeof x === 'object' && x.extends === undefined);
  const foreign = (ctx.foreignScreens ?? []).filter((f) => f.required).flatMap((f) => f.screens).filter((x) => x && typeof x === 'object');
  const all = [...own, ...foreign];
  const isPage = (x, id) => x.type === 'page' && (str(x.id) === id || str(x.slug) === id);
  const isScreen = (x, id) => x.type !== 'page' && str(x.id) === id;
  // зорилт → '' (OK) | шалтгаан. strict биш үед нэр олдохгүй байж болно (суусан багц) — сервер шалгана.
  // P-WP-11: олдоогүй зорилт (дараа суух багцын дэлгэц/хуудас г.м.) — `missing` (анхааруулга; runtime шийднэ), хэлбэрийн алдаа — алдаа
  const missing = new Set();
  const gone = (m) => { missing.add(m); return m; };
  const targetError = (t) => {
    if (typeof t === 'string' || typeof t === 'number') {
      const s = str(t);
      if (!s) return 'зорилт хоосон';
      if (all.some((x) => isScreen(x, s) || isPage(x, s)) || ctx.hasTable(s) || !ctx.strict) return '';
      return gone(`«${s}» — дэлгэц, хуудас эсвэл хүснэгт алга`);
    }
    if (!t || typeof t !== 'object' || Array.isArray(t)) return 'зорилт алга';
    const keys = TARGET_KINDS.filter((k) => t[k] !== undefined);
    if (keys.length !== 1) return `зорилт яг нэг (${TARGET_KINDS.join(' | ')})`;
    const k = keys[0], v = str(t[k]);
    if (!v) return `${k} хоосон`;
    if (k === 'url') return /^(https?:\/\/|\/)/.test(v) ? '' : `url «${v}» — http(s):// эсвэл /…`;
    if (!ctx.strict) return '';
    if (k === 'screen' && !all.some((x) => isScreen(x, v))) return gone(`дэлгэц «${v}» алга`);
    if (k === 'page' && !all.some((x) => isPage(x, v))) return gone(`хуудас «${v}» алга`);
    if (k === 'table' && !ctx.hasTable(v)) return gone(`хүснэгт «${v}» алга`);
    if (k === 'report' && !(ctx.reports ?? new Set()).has(v)) return gone(`тайлан «${v}» алга`);
    return '';
  };
  const sev = (e) => (missing.has(e) ? 'warning' : 'error');
  const hint = (e) => (missing.has(e) ? MISSING_HINT : '');
  const appsFile = fileOf('apps', 'apps.yaml');
  const ay = appsFile ? yaml[appsFile] : null;
  // P-WP-48 (HEADER-COMPACT): header — links хэлбэр (алдаа), зорилт (userMenu-ийн дүрэм: алга — анхааруулга), `app:` (энэ багцын apps.yaml-д алга —
  //   анхааруулга), roles (алга — алдаа), modules-ийн үл мэдэгдэх түлхүүр (анхааруулга). SolutionDeploy.cpp headerCheck-тэй ижил
  const pkgApps = new Set(ay && typeof ay === 'object' ? asList(ay.apps).map((a) => str(a?.id)).filter(Boolean) : []);
  const headerCheck = (h, file, where) => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return;
    if (Array.isArray(h.modules)) for (const m of h.modules) if (!HEADER_MODULES.includes(str(m)))
      add('ref', 'warning', 'app_header', file, 0, `${where}header.modules «${str(m)}» — платформын ийм модуль алга (харагдахгүй)`);
    if (h.links === undefined) return;
    if (!Array.isArray(h.links)) return add('ref', 'error', 'app_header', file, 0, `${where}header.links — массив`);
    h.links.forEach((m, k) => {
      const at = `${where}header.links[${k}]${m && typeof m === 'object' && typeof m.label === 'string' ? ` «${m.label}»` : ''}: `;
      if (!m || typeof m !== 'object' || Array.isArray(m)) return add('ref', 'error', 'app_header', file, 0, `${at}мөр объект байх ёстой`);
      const { label, icon, roles, ...target } = m;
      void label; void icon;
      if (target.app !== undefined) {
        if (Object.keys(target).length !== 1) add('ref', 'error', 'app_header', file, 0, `${at}зорилт яг нэг (screen | page | table | report | url | app)`);
        else if (!str(target.app)) add('ref', 'error', 'app_header', file, 0, `${at}app — аппын id (текст)`);
        else if (ctx.strict && !pkgApps.has(str(target.app))) add('ref', 'warning', 'app_header', file, 0, `${at}апп «${str(target.app)}» алга${MISSING_HINT}`);
      } else {
        let e = targetError(target);
        if (e === `зорилт яг нэг (${TARGET_KINDS.join(' | ')})`) e = 'зорилт яг нэг (screen | page | table | report | url | app)';
        if (!e && typeof target.url === 'string' && !urlOk(target.url.trim())) e = `url «${target.url.trim()}» — http(s)://… эсвэл /… (//, \\, : хориотой)`;
        if (e) add('ref', sev(e), 'app_header', file, 0, `${at}${e}${hint(e)}`);
      }
      if (ctx.knownRole) for (const r of Array.isArray(roles) ? roles : []) if (typeof r === 'string' && !ctx.knownRole(r))
        add('ref', 'error', 'app_header', file, 0, `${at}үүрэг «${r}» олдсонгүй (roles.csv / seed groups — энэ эсвэл төслийн өөр багц)`);
    });
  };
  if (ay && typeof ay === 'object') {
    const seen = new Set();
    for (const a of asList(ay.apps)) {
      if (!a || typeof a !== 'object') continue;
      const id = str(a.id);
      if (id && seen.has(id)) add('ref', 'error', 'app_id', appsFile, 0, `apps.yaml: аппын id «${id}» давхардсан`);
      seen.add(id);
      if (a.home !== undefined) { const e = targetError(a.home); if (e) add('ref', sev(e), 'app_home', appsFile, 0, `apps.yaml «${id}»: нүүр — ${e}${hint(e)}`); }
      // P-WP-43 (APP-USERMENU): userMenu — хэлбэр (алдаа), зорилт (нүүр/цэсний дүрэм: алга — анхааруулга), roles (P-WP-40 цэсний roles-тэй ижил: алга — алдаа)
      if (Array.isArray(a.userMenu)) a.userMenu.forEach((m, k) => {
        const at = `apps.yaml «${id}»: userMenu[${k}]${m && typeof m === 'object' && typeof m.label === 'string' ? ` «${m.label}»` : ''}: `;
        if (!m || typeof m !== 'object' || Array.isArray(m)) return add('ref', 'error', 'app_usermenu', appsFile, 0, `${at}мөр объект байх ёстой`);
        const { label, icon, roles, ...target } = m;
        void label; void icon;
        let e = targetError(target);
        if (!e && typeof target.url === 'string' && !urlOk(target.url.trim())) e = `url «${target.url.trim()}» — http(s)://… эсвэл /… (//, \\, : хориотой)`;
        if (e) add('ref', sev(e), 'app_usermenu', appsFile, 0, `${at}${e}${hint(e)}`);
        if (ctx.knownRole) for (const r of Array.isArray(roles) ? roles : []) if (typeof r === 'string' && !ctx.knownRole(r))
          add('ref', 'error', 'app_usermenu', appsFile, 0, `${at}үүрэг «${r}» олдсонгүй (roles.csv / seed groups — энэ эсвэл төслийн өөр багц)`);
      });
      if (a.header !== undefined) headerCheck(a.header, appsFile, `apps.yaml «${id}»: `); // P-WP-48
      if (a.logo !== undefined) { const e = logoError(a.logo, files); if (e) add('ref', 'error', 'branding_logo', appsFile, 0, `apps.yaml «${id}»: лого «${str(a.logo)}» — ${e}`); }
    }
    asList(ay.breadcrumbs).forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const { parent, label, ...target } = b;
      void label;
      const e1 = targetError(target);
      if (e1) add('ref', sev(e1), 'breadcrumb_target', appsFile, 0, `apps.yaml breadcrumbs[${i}]: ${e1}${hint(e1)}`);
      const e2 = targetError(parent);
      if (e2) add('ref', sev(e2), 'breadcrumb_target', appsFile, 0, `apps.yaml breadcrumbs[${i}] parent: ${e2}${hint(e2)}`);
    });
  }
  const brFile = fileOf('branding', 'branding.yaml');
  const by = brFile ? yaml[brFile] : null;
  if (by && typeof by === 'object' && by.header !== undefined) headerCheck(by.header, brFile, 'branding.yaml: '); // P-WP-48
  if (by && typeof by === 'object' && by.logo !== undefined) {
    const e = logoError(by.logo, files);
    if (e) add('ref', 'error', 'branding_logo', brFile, 0, `branding.yaml: лого «${str(by.logo)}» — ${e}`);
  }
}
