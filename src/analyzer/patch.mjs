// PLAN15 C3 — хүний хариултыг (status: answered) BRD/PRD-ийн файлд детерминист patch болгон буулгана.
// Зарчим: зөвхөн `answered` (агентын `assumed` хэзээ ч биш); хариулт patch-ийн хүлээсэн хэлбэрт таарахгүй эсвэл файл хашилттай CSV г.м. эрсдэлтэй бол
// patch хийхгүй — requirements.md-д шийдвэрийн мөр (`| Q-… | Д | <асуулт> — Хариулт: … | 2 | <элемент> |`) нэмж хүнд засуулна.
// Дахин хэрэгжүүлэхгүй: `applied_at`-тай асуулт алгасна; patch бүр «аль хэдийн байгаа» эсэхийг шалгана (idempotent).
// Patch-ийн дараа шинжилгээ + sync → олдвор алга болж асуулт `resolved` болно (bj questions apply үүнийг хийнэ).
import { parseDocument, isMap, isSeq } from '../validator/vendor/yaml.mjs';
import { parseCsv } from '../validator/parsers.mjs';
import { parseElement } from './questions.mjs';

const str = (v) => String(v ?? '').trim();
const low = (v) => str(v).toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lines = (t) => String(t ?? '').split('\n');
const answers = (a) => (Array.isArray(a) ? a.map(str) : str(a).split(',').map(str)).filter(Boolean);
const NEG = /^(үгүй|хориг|хориглоно|хориглох|хэн ч|байхгүй|no|none|-)$/i;

// ---- roles.csv
function rolesFile(model) { return model.roles[0]?.file ?? (model.files.includes('roles.csv') ? 'roles.csv' : null); }
const knownRole = (model, r) => [...new Set(model.roles.filter((x) => x.role && !x.role.startsWith('@')).map((x) => x.role))].find((x) => low(x) === low(r));
// op: view|create|update|remove, value: '1' | '-'
function setRight(files, model, role, table, op, value) {
  const f = rolesFile(model);
  if (!f || files[f] === undefined) return { error: 'roles.csv алга' };
  const idx = { view: 2, create: 3, update: 4, remove: 5 }[op];
  const text = files[f];
  const rows = parseCsv(text);
  const width = rows[0]?.cells.length ?? 9;
  const hit = rows.slice(1).find((r) => low(r.cells[0]) === low(role) && str(r.cells[1]) === table && !str(r.cells[9]));
  const ls = lines(text);
  if (hit) {
    if (ls[hit.line - 1].includes('"')) return { error: 'хашилттай CSV мөр — гараар засна' };
    const cells = ls[hit.line - 1].split(',');
    if (str(cells[idx]) === value && (op === 'view' || value === '-' || str(cells[2]) === '1')) return { same: true };
    cells[idx] = value;
    if (value === '1' && op !== 'view') cells[2] = '1'; // үүсгэх/засах/устгах нь харахгүйгээр утгагүй
    ls[hit.line - 1] = cells.join(',');
    return { files: { ...files, [f]: ls.join('\n') }, summary: `${f}: «${role},${table}» ${op}=${value}` };
  }
  const cells = Array(Math.max(width, 6)).fill('');
  cells[0] = role; cells[1] = table;
  for (const [k, i] of Object.entries({ view: 2, create: 3, update: 4, remove: 5 })) cells[i] = k === op ? value : (k === 'view' && value === '1' ? '1' : '0');
  const out = text.endsWith('\n') ? `${text}${cells.join(',')}\n` : `${text}\n${cells.join(',')}\n`;
  return { files: { ...files, [f]: out }, summary: `${f}: шинэ мөр «${cells.slice(0, 6).join(',')}»` };
}

// ---- erd.dbml: баганын мөр
function columnLine(model, files, table, column) {
  const t = model.tables.get(table);
  const c = t?.columns.find((x) => x.name === column);
  return c ? { file: t.file, line: c.line, text: lines(files[t.file])[c.line - 1] } : null;
}
function editColumn(files, model, table, column, fn, what) {
  const cl = columnLine(model, files, table, column);
  if (!cl) return { error: `багана «${table}.${column}» алга` };
  const nxt = fn(cl.text);
  if (nxt === null) return { error: `«${table}.${column}» мөрийг танихгүй` };
  if (nxt === cl.text) return { same: true };
  const ls = lines(files[cl.file]); ls[cl.line - 1] = nxt;
  return { files: { ...files, [cl.file]: ls.join('\n') }, summary: `${cl.file}:${cl.line}: «${table}.${column}» ${what}` };
}
// баганын [тохиргоо] (комментоос өмнөх) — байхгүй бол нэмнэ
function withSetting(line, add, remove = null) {
  const cm = line.indexOf('//');
  const code = cm >= 0 ? line.slice(0, cm).trimEnd() : line.trimEnd();
  const comment = cm >= 0 ? `  ${line.slice(cm)}` : '';
  const m = /\[([^\]]*)\]\s*$/.exec(code);
  let parts = m ? m[1].split(',').map(str).filter(Boolean) : [];
  if (remove) parts = parts.filter((p) => low(p) !== remove);
  if (add && !parts.some((p) => low(p) === add)) parts.unshift(add);
  const head = m ? code.slice(0, m.index).trimEnd() : code;
  return `${head}${parts.length ? ` [${parts.join(', ')}]` : ''}${comment}`;
}

// ---- states.mmd: машины блокийн төгсгөлд мөр нэмэх
function addToMachine(files, model, machine, newLines) {
  const m = model.machines.find((x) => x.name === machine);
  if (!m) return { error: `машин «${machine}» алга` };
  const ls = lines(files[m.file]);
  const next = model.machines.filter((x) => x.file === m.file && x.line > m.line).map((x) => x.line).sort((a, b) => a - b)[0] ?? ls.length + 1;
  let at = next - 1; // 0-ээс эхэлсэн индекс: дараагийн машины өмнө
  while (at > m.line && !str(ls[at - 1])) at--; // хоосон мөрийн өмнө
  const block = ls.slice(m.line, next - 1); // зөвхөн энэ машины мөрүүд (өөр машинд ижил мөр байж болно)
  const add = newLines.filter((l) => !block.some((x) => str(x) === str(l)));
  if (!add.length) return { same: true };
  const indent = (/^(\s*)\S/.exec(ls.slice(m.line, at).find((x) => x.includes('-->')) ?? '') ?? [])[1] ?? '    ';
  ls.splice(at, 0, ...add.map((l) => `${indent}${l}`));
  return { files: { ...files, [m.file]: ls.join('\n') }, summary: `${m.file}: «${machine}»-д ${add.map((l) => `\`${l}\``).join(', ')}` };
}
function transitionLine(model, el) {
  const m = model.machines.find((x) => x.name === el.machine);
  return m?.transitions.find((t) => t.caption === el.caption && (!el.from || t.from === el.from)) ? { m, t: m.transitions.find((t) => t.caption === el.caption && (!el.from || t.from === el.from)) } : null;
}

// ---- шийдвэрийн мөр (requirements.md) — patch хийх боломжгүй хариулт
function decisionNote(files, model, q, reason) {
  const f = model.requirements[0]?.file ?? (files['requirements.md'] !== undefined ? 'requirements.md' : null);
  if (!f) return { error: 'requirements.md алга' };
  if (model.requirements.some((r) => r.id === q.id)) return { same: true };
  const e = parseElement(q.element);
  const link = { machine: e.machine, state: e.machine && e.state ? `${e.machine} [${e.state}]` : null, table: e.table, column: e.table && e.column ? `${e.table}.${e.column}` : null }[e.kind] ?? e.name;
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const row = `| ${q.id} | Д | ${cell(`${q.ask} — Хариулт: ${answers(q.answer).join(', ') || str(q.answer)}`)} | 2 | ${cell(link ?? '')} |`;
  const ls = lines(files[f]);
  const last = Math.max(...model.requirements.map((r) => r.line));
  ls.splice(last, 0, row);
  return { files: { ...files, [f]: ls.join('\n') }, summary: `${f}: шийдвэрийн мөр ${q.id}${reason ? ` (${reason})` : ''}`, note: true };
}

// ---- acceptance.md: сценари нэмэх («Сценари => Хүлээгдэх»)
function addScenario(files, model, reqId, answer) {
  const sc = model.scenarios.filter((s) => Array.isArray(s.requirements));
  if (!sc.length) return { error: 'acceptance.md-д «Шаардлага» баганатай хүснэгт алга' };
  const f = sc[0].file;
  const [scenario, expected = '(хүлээгдэх үр дүнг тодруулна)'] = str(answer).split(/\s*=>\s*/);
  if (!scenario) return { error: 'сценари хоосон' };
  if (sc.some((s) => str(s.scenario) === scenario && s.requirements.includes(reqId))) return { same: true };
  const nums = sc.map((s) => /^([A-Za-zА-Яа-я]*)(\d+)$/.exec(str(s.no))).filter(Boolean);
  const prefix = nums[0]?.[1] ?? '', n = Math.max(0, ...nums.map((x) => Number(x[2]))) + 1;
  const header = lines(files[f]).find((l) => /^\|\s*#\s*\|/.test(l)) ?? '';
  const width = header.split('|').length - 2;
  const cells = [`${prefix}${n}`, scenario, expected, ...Array(Math.max(0, width - 3)).fill('')];
  const reqCol = header.split('|').slice(1, -1).map(low).findIndex((h) => ['шаардлага', 'requirements', 'requirement'].includes(h));
  if (reqCol > 0) cells[reqCol] = reqId;
  const ls = lines(files[f]);
  const last = Math.max(...sc.map((s) => s.line));
  ls.splice(last, 0, `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
  return { files: { ...files, [f]: ls.join('\n') }, summary: `${f}: сценари ${prefix}${n} (${reqId})` };
}

// ---- screens.yaml: маягтын эхний fields-д багана нэмэх
function addFormField(files, model, table, column) {
  const sf = model.files.find((f) => /^screens\.ya?ml$/i.test(f));
  if (!sf) return { error: 'screens.yaml алга' };
  const doc = parseDocument(files[sf]);
  const screens = doc.get('screens');
  const list = isSeq(screens) ? screens.items : isMap(screens) ? screens.items.map((p) => p.value) : [];
  const form = list.find((s) => isMap(s) && str(s.get('type')) === 'form' && str(s.get('table')) === table && s.get('layout'));
  if (!form) return { error: `«${table}»-ийн layout-тай маягт алга` };
  let target = null;
  const find = (n) => { if (target) return; if (isMap(n)) for (const p of n.items) { if (str(p.key?.value) === 'fields' && isSeq(p.value)) { target = p.value; return; } find(p.value); } else if (isSeq(n)) n.items.forEach(find); };
  find(form.get('layout'));
  if (!target) {
    // хоосон layout (талбаргүй) — эхний section-д fields үүсгэнэ
    const layout = form.get('layout');
    const sections = isMap(layout) ? layout.get('sections') : null;
    const sec = isSeq(sections) && isMap(sections.items[0]) ? sections.items[0] : null;
    if (!sec) return { error: 'маягтын layout-д section алга' };
    sec.set('fields', doc.createNode([column]));
  } else {
    if (target.items.some((it) => str(it?.value ?? it?.get?.('field')) === column)) return { same: true };
    target.items.push(doc.createNode(column));
  }
  return { files: { ...files, [sf]: doc.toString({ lineWidth: 0 }) }, summary: `${sf}: «${str(form.get('id'))}» маягтад «${column}»` };
}

// код/слот → patch (хариулт таарахгүй бол null → шийдвэрийн мөр)
function patcher(q, model) {
  const e = parseElement(q.element);
  const a = answers(q.answer);
  const roles = a.map((r) => knownRole(model, r));
  const allRoles = roles.length && roles.every(Boolean);
  const first = str(Array.isArray(q.answer) ? q.answer[0] : q.answer);
  const machine = e.machine && model.machines.find((m) => m.name === e.machine);
  const stateNames = new Set(machine?.states.map((s) => s.name) ?? []);
  const viaRoles = (op) => (allRoles ? (f) => seq(f, roles.map((r) => (g) => setRight(g, model, r, e.table, op, '1'))) : null);
  switch (q.slot ?? q.code) {
    case 'table.viewer': return viaRoles('view');
    case 'table.creator': case 'PERM-TABLE-NOCREATOR': return viaRoles('create');
    case 'table.deleter':
      if (NEG.test(first)) return (f) => seq(f, model.roles.filter((r) => r.table === e.table && !r.object && !r.role.startsWith('@')).map((r) => (g) => setRight(g, model, r.role, e.table, 'remove', '-')));
      return viaRoles('remove');
    case 'table.key': {
      const col = model.tables.get(e.table)?.columns.find((c) => c.name === first);
      return col ? (f) => editColumn(f, model, e.table, first, (l) => withSetting(l, 'unique'), 'unique') : null;
    }
    case 'SM-NO-ACTOR': case 'machine.actor': {
      if (!allRoles || e.kind !== 'transition') return null;
      const tl = transitionLine(model, e);
      if (!tl) return null;
      return (f) => {
        const ls = lines(f[tl.m.file]); const raw = ls[tl.t.line - 1];
        if (/\/\s*(хэн|who)\s*:/.test(raw)) return { error: 'шилжилтэд хэн аль хэдийн бий' };
        const add = `хэн: ${roles.join(', ')}`;
        ls[tl.t.line - 1] = / \/ /.test(raw) ? raw.replace(/ \/ /, ` / ${add} ; `) : `${raw.trimEnd()} / ${add}`;
        return { files: { ...f, [tl.m.file]: ls.join('\n') }, summary: `${tl.m.file}:${tl.t.line}: «${e.caption}»-д \`${add}\`` };
      };
    }
    case 'SM-DEAD-END': case 'SM-FINAL-UNMARKED': {
      if (/^(эцсийн|тийм)/i.test(first)) return (f) => addToMachine(f, model, e.machine, [`${e.state} --> [*]`]);
      const to = first.replace(/ рүү шилжинэ$/, '');
      return stateNames.has(to) ? (f) => addToMachine(f, model, e.machine, [`${e.state} --> ${to} : ${to} болгох`]) : null;
    }
    case 'SM-NO-FINAL': case 'machine.final': return stateNames.has(first) ? (f) => addToMachine(f, model, e.machine, [`${first} --> [*]`]) : null;
    case 'SM-UNREACHABLE': {
      const from = first.replace(/-аас шилжинэ$/, '');
      return stateNames.has(from) ? (f) => addToMachine(f, model, e.machine, [`${from} --> ${e.state} : ${e.state} болгох`]) : null;
    }
    case 'SM-NO-PATH-TO-FINAL': {
      const to = first.replace(/ рүү шилжинэ$/, '');
      return stateNames.has(to) ? (f) => addToMachine(f, model, e.machine, [`${e.state} --> ${to} : ${to} болгох`]) : null;
    }
    case 'machine.reject': {
      // хариулт: татгалзах боломжтой төлөв (сонголтоос); зорилт «Цуцлагдсан» (эцсийн) — хэн-ийг SM-NO-ACTOR асуулт дараа нь асууна
      const from = a.filter((s) => stateNames.has(s));
      if (!from.length) return null;
      return (f) => addToMachine(f, model, e.machine, [...from.map((s) => `${s} --> Цуцлагдсан : Цуцлах`), 'Цуцлагдсан --> [*]']);
    }
    case 'PERM-TRANSITION-NOWRITE': case 'PERM-CREATE-NOCREATE': case 'PERM-TASK-NOVIEW': case 'PERM-SCREEN-NOVIEW': {
      if (!/эрх өгнө$/.test(first)) return null;
      const role = knownRole(model, q.subject ?? '');
      const table = e.machine ? model.machines.find((m) => m.name === e.machine)?.table : e.table;
      const op = { 'PERM-TRANSITION-NOWRITE': 'update', 'PERM-CREATE-NOCREATE': 'create', 'PERM-TASK-NOVIEW': 'view', 'PERM-SCREEN-NOVIEW': 'view' }[q.code];
      return role && table ? (f) => setRight(f, model, role, table, op, '1') : null;
    }
    case 'X0-ENUM-LITERAL': {
      const m = /^(.+)=(.*)$/.exec(q.subject ?? '');
      if (!m) return null;
      const [, col, typo] = m;
      if (/шинэ утгаар нэмнэ$/.test(first)) {
        const table = e.table ?? (e.machine ? model.machines.find((x) => x.name === e.machine)?.table : null);
        return table ? (f) => editColumn(f, model, table, col, (l) => (/enum\(([^)]*)\)/.test(l) ? l.replace(/enum\(([^)]*)\)/, (_, v) => `enum(${v},${typo})`) : null), `enum-д «${typo}»`) : null;
      }
      if (!q.options?.includes(first) || !q.file || !q.line) return null;
      return (f) => {
        const ls = lines(f[q.file]); const raw = ls[q.line - 1] ?? '';
        const nxt = raw.replace(new RegExp(`(["'])${esc(typo)}\\1`), `$1${first}$1`);
        if (nxt === raw) return { error: 'утга мөрөнд олдсонгүй' };
        ls[q.line - 1] = nxt;
        return { files: { ...f, [q.file]: ls.join('\n') }, summary: `${q.file}:${q.line}: «${typo}» → «${first}»` };
      };
    }
    case 'COV-REQUIRED-NOFORM':
      if (/^маягтад нэмнэ/i.test(first)) return (f) => addFormField(f, model, e.table, e.column);
      if (/^заавал биш/i.test(first)) return (f) => editColumn(f, model, e.table, e.column, (l) => withSetting(l, null, 'not null'), 'not null хасав');
      return null;
    case 'COV-P1-UNTESTED': case 'requirement.acceptance': return first ? (f) => addScenario(f, model, e.name, q.answer) : null;
    default: return null;
  }
}
// олон patch-ийг дараалан: аль нэг нь алдаа бол алдаа; бүгд «аль хэдийн» бол same
function seq(files, steps) {
  let cur = files, changed = false;
  const summary = [];
  for (const step of steps) {
    const r = step(cur);
    if (r.error) return r;
    if (r.files) { cur = r.files; changed = true; summary.push(r.summary); }
  }
  return changed ? { files: cur, summary: summary.join('; ') } : { same: true };
}

// doc — questions.yaml, files — багц; → {files, doc, applied: [{id, summary, note}], skipped: [{id, reason}]}
export function applyAnswers(files, doc, model, { now = new Date().toISOString(), only = null } = {}) {
  let cur = files;
  const applied = [], skipped = [];
  for (const q of doc?.questions ?? []) {
    if (only && !only.includes(q.id)) continue;
    if (q.status !== 'answered' || q.applied_at) { if (q.status === 'assumed') skipped.push({ id: q.id, reason: 'assumed — хүн батлаагүй' }); continue; }
    const p = patcher(q, model);
    let r = p ? p(cur) : null;
    let note = false;
    if (!r || r.error) { const reason = r?.error ?? 'автоматаар буулгах хэлбэргүй'; r = decisionNote(cur, model, q, reason); note = true; if (r.error) { skipped.push({ id: q.id, reason: `${reason}; ${r.error}` }); continue; } }
    if (r.files) cur = r.files;
    q.applied_at = now;
    q.patch = r.same ? 'аль хэдийн тусгагдсан' : r.summary;
    applied.push({ id: q.id, summary: q.patch, note: note || !!r.note });
  }
  return { files: cur, doc, applied, skipped };
}
