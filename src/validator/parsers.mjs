// requirements.md, acceptance.md, roles.csv, states.mmd задлагч — серверийн `cgi/src/solution/Package.cpp`-тэй ижил дүрэм, мөрийн дугаартай.
// Сервер «алгасав» гэж анхааруулаад үргэлжилдэг газрыг `issues` болгоно (баталгаажуулагч алдаа болгоно).

const trim = (s) => String(s ?? '').trim();
// сервер std::tolower — зөвхөн ASCII (кирилл том үсэг хэвээр: «Тийм», «Хэн:» таарахгүй)
const asciiLower = (s) => String(s ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase());

// Хаалт (), [], {} ба хашилтын гаднах `sep`-ээр хуваана (Package.cpp splitTop)
export function splitTop(s, sep) {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (const c of String(s ?? '')) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((x) => x !== '');
}

export function markdownTables(text) {
  const tables = [];
  let cur = null;
  String(text ?? '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith('|')) { cur = null; return; }
    const cells = [];
    let c = '';
    for (let k = 1; k < line.length; k++) {
      if (line[k] === '\\' && line[k + 1] === '|') { c += '|'; k++; continue; }
      if (line[k] === '|') { cells.push(c.trim()); c = ''; continue; }
      c += line[k];
    }
    if (c.trim()) cells.push(c.trim());
    if (cells.length && cells.every((x) => /^:?-{1,}:?$/.test(x))) return;
    if (!cur) { cur = { header: cells, headerLine: i + 1, rows: [] }; tables.push(cur); } else cur.rows.push({ cells, line: i + 1 });
  });
  return tables;
}

const stripBold = (s) => trim(s).replace(/^\*\*(.*)\*\*$/, '$1').trim();

export function parseRequirements(md) {
  const out = [];
  for (const t of markdownTables(md)) {
    if (!t.header.length || t.header[0].toLowerCase() !== 'id') continue;
    for (const r of t.rows) {
      const cell = (i) => stripBold(r.cells[i] ?? '');
      if (!cell(0)) continue;
      out.push({ id: cell(0), kind: cell(1), text: cell(2), priority: cell(3), links: splitTop(cell(4), ','), line: r.line, header: t.header });
    }
  }
  return out;
}

export function parseAcceptance(md) {
  const out = [];
  for (const t of markdownTables(md)) {
    if (!t.header.length || t.header[0] !== '#') continue;
    const reqCol = t.header.findIndex((h, i) => i > 0 && ['шаардлага', 'requirements', 'requirement'].includes(trim(h).toLowerCase()));
    for (const r of t.rows) {
      const cell = (i) => r.cells[i] ?? '';
      if (!cell(0)) continue;
      out.push({ no: cell(0), scenario: cell(1), expected: cell(2), requirements: reqCol > 0 ? splitTop(cell(reqCol), ',').map(trim).filter(Boolean) : null, line: r.line });
    }
  }
  return out;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, any = false, line = 1, rowLine = 1;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!quoted && !any && cell === '' && c === '#') { while (i < s.length && s[i] !== '\n') i++; line++; rowLine = line; continue; }
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"') { quoted = true; any = true; }
    else if (c === ',') { row.push(cell); cell = ''; any = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      if (any || cell) { row.push(cell); rows.push({ cells: row, line: rowLine }); }
      row = []; cell = ''; any = false; line++; rowLine = line;
    } else { cell += c; any = true; }
  }
  if (any || cell) { row.push(cell); rows.push({ cells: row, line: rowLine }); }
  return rows;
}

const FLAG_TRUE = ['1', 'true', 'тийм', 'x'];
const FLAG_FALSE = ['0', 'false', 'үгүй', ''];
export function parseRoles(csv) {
  const rows = parseCsv(csv);
  const issues = [];
  const out = [];
  const header = rows[0];
  rows.slice(1).forEach((r) => {
    const cell = (i) => trim(r.cells[i] ?? '');
    if (!cell(0) || !cell(1)) {
      if (r.cells.some((c) => trim(c))) issues.push({ severity: 'error', code: 'roles_row', line: r.line, message: 'Үүрэг эсвэл Хүснэгт хоосон — сервер мөрийг алгасна' });
      return;
    }
    for (const i of [2, 3, 4, 5]) {
      const v = asciiLower(cell(i));
      if (!FLAG_TRUE.includes(v) && !FLAG_FALSE.includes(v)) issues.push({ severity: 'error', code: 'roles_flag', line: r.line, message: `${header?.cells[i] ?? `${i + 1}-р багана`}: «${cell(i)}» — 0/1 байх ёстой (сервер үгүй гэж уншина)` });
    }
    if (r.cells.length > 9 && r.cells.slice(9).some((c) => trim(c))) issues.push({ severity: 'error', code: 'roles_columns', line: r.line, message: `${r.cells.length} багана — 9-өөс хойших баганыг сервер уншихгүй` });
    const semi = (s) => s.split(';').map(trim).filter(Boolean);
    const fl = (i) => FLAG_TRUE.includes(asciiLower(cell(i)));
    out.push({ role: cell(0), table: cell(1), view: fl(2), create: fl(3), update: fl(4), remove: fl(5), rowFilter: cell(6), hidden: semi(cell(7)), readOnly: semi(cell(8)), line: r.line });
  });
  return { roles: out, issues, header: header?.cells ?? [] };
}

export function isoDuration(raw) {
  const v = trim(raw);
  if (!v) return '';
  if (v[0] === 'P') return /^P(\d+[YMWD])*(T(\d+[HMS])+)?$/.test(v) ? v : '';
  const m = /^(\d+)\s*(d|h|m|w|хоног|өдөр|цаг|мин|долоо хоног)$/.exec(v);
  if (!m) return '';
  return m[2];
}

// → {machines: [{name, table, column, line, states: [{name, initial, final, sla, line}], transitions: [...], notes: [{state, text, line}]}], issues}
export function parseStates(text) {
  const machines = [];
  const issues = [];
  const warn = (line, code, message, severity = 'error') => issues.push({ severity, code, line, message });
  const ensure = (m, name, line) => {
    let s = m.states.find((x) => x.name === name);
    if (!s) { s = { name, initial: false, final: false, line }; m.states.push(s); }
    return s;
  };
  String(text ?? '').split('\n').forEach((raw, idx) => {
    const ln = idx + 1;
    const line = raw.trim();
    const mm = /^%%\s*machine:\s*(.+?)\s+table:\s*(.+?)\s+column:\s*(.+?)\s*$/.exec(line);
    if (mm) { machines.push({ name: mm[1].trim(), table: mm[2].trim(), column: mm[3].trim(), line: ln, states: [], transitions: [], notes: [] }); return; }
    if (/^%%\s*machine:/.test(line)) { warn(ln, 'states_header', '`%% machine: <Нэр> table: <Хүснэгт> column: <Багана>` хэлбэртэй биш — сервер тайлбар гэж алгасна'); return; }
    if (!line || line.startsWith('%%') || line === 'stateDiagram-v2' || line === 'stateDiagram') return;
    if (!machines.length) { warn(ln, 'states_orphan', '`%% machine:` мөрийн өмнө агуулга — сервер алгасна'); return; }
    const m = machines[machines.length - 1];
    const nm = /^note\s+(?:right|left)\s+of\s+(.+?)\s*:\s*(.*)$/.exec(line);
    if (nm) {
      const st = nm[1].trim(), txt = nm[2].trim();
      const sla = /^(?:sla|SLA)\s*:?\s*(.+)$/.exec(txt);
      if (sla) {
        if (!isoDuration(sla[1])) warn(ln, 'states_sla', `SLA хугацаа танигдаагүй (2d, 4h, 30m, P2D): ${txt}`);
        else ensure(m, st, ln).sla = sla[1].trim();
        return;
      }
      m.notes.push({ state: st, text: txt, line: ln }); ensure(m, st, ln); return;
    }
    const arrow = line.indexOf('-->');
    if (arrow < 0) { warn(ln, 'states_line', `танигдаагүй мөр — сервер алгасна: ${line}`); return; }
    const from = line.slice(0, arrow).trim();
    const rest = line.slice(arrow + 3).trim();
    let to = rest, label = '';
    const colon = rest.indexOf(':');
    if (colon >= 0) { to = rest.slice(0, colon).trim(); label = rest.slice(colon + 1).trim(); }
    const create = from === '[*]' && to !== '[*]' && !!label;
    if (from === '[*]') { ensure(m, to, ln).initial = true; if (!create) return; }
    else if (to === '[*]') {
      ensure(m, from, ln).final = true;
      if (label) warn(ln, 'states_final_label', `эцсийн шилжилт \`${from} --> [*]\`-ийн шошго «${label}» хэрэгжихгүй`);
      return;
    } else { ensure(m, from, ln); ensure(m, to, ln); }
    let left = label, right = '';
    const slash = label.indexOf(' / ');
    if (slash >= 0) { left = label.slice(0, slash).trim(); right = label.slice(slash + 3).trim(); }
    else if (/\/\s*(хэн|who|action)\s*:/i.test(label)) warn(ln, 'states_label', `« / » (хоёр талдаа зайтай) алга — хэн/action хэсгийг сервер шилжилтийн нэрэнд оруулна: ${label}`);
    let caption = left, guard = '';
    if (left.endsWith(']')) {
      const lb = left.lastIndexOf('[');
      if (lb >= 0) { guard = left.slice(lb + 1, -1).trim(); caption = left.slice(0, lb).trim(); }
    }
    let requireComment = false, autoAfter = '', autoWhen = '';
    if (guard === 'тайлбар заавал' || guard === 'comment required') { requireComment = true; guard = ''; }
    if (/^after /i.test(guard)) { autoAfter = guard.slice(6).trim(); if (!isoDuration(autoAfter)) warn(ln, 'states_after', `after хугацаа танигдаагүй: ${guard}`); guard = ''; }
    else if (/^when /i.test(guard)) { autoWhen = guard.slice(5).trim(); guard = ''; }
    let who = '';
    const actions = [];
    for (const part of right.split(';').map(trim).filter(Boolean)) {
      const c = part.indexOf(':');
      if (c < 0) { warn(ln, 'states_label_part', `«${part}» — \`хэн: …\` эсвэл \`action: …\` хэлбэртэй биш, сервер алгасна`); continue; }
      const key = asciiLower(part.slice(0, c).trim()), value = part.slice(c + 1).trim();
      if (key === 'хэн' || key === 'who') who = value;
      else if (key === 'action' || key === 'actions') {
        for (const a of splitTop(value, ',')) {
          const p = a.indexOf('(');
          const name = (p < 0 ? a : a.slice(0, p)).trim();
          let arg = '';
          if (p >= 0) { const q = a.lastIndexOf(')'); arg = a.slice(p + 1, q < 0 ? a.length : q).trim(); if (q < 0) warn(ln, 'states_action', `action «${a}»: «)» алга`); }
          actions.push({ name, arg, line: ln });
        }
      } else warn(ln, 'states_label_part', `«${key}:» — танигдаагүй (хэн, action); сервер алгасна`);
    }
    if (!caption) caption = to;
    if (create && (requireComment || autoAfter || autoWhen)) warn(ln, 'states_create', `үүсгэх шилжилт «${caption}»: ${requireComment ? '«тайлбар заавал»' : autoAfter ? 'after' : 'when'} үүсгэхэд утгагүй — сервер алгасна`);
    m.transitions.push({ from, to, caption, guard, who, processOnly: ['процесс', 'process'].includes(asciiLower(who)), requireComment, actions, create, autoAfter, autoWhen, line: ln });
  });
  for (const m of machines) {
    const n = m.states.filter((s) => s.initial).length;
    if (n !== 1) warn(m.line, 'states_initial', `машин «${m.name}»: анхны төлөв ${n} (яг нэг \`[*] --> X\` байх ёстой)`);
  }
  return { machines, issues };
}
