import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const TEXT_FILES = /\.(ya?ml|md|csv|mmd|dbml|dmn|bpmn|html|json|txt|sql)$/i;

export function readPackageFiles(packageDir) {
  const dir = resolve(packageDir);
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (TEXT_FILES.test(name)) {
        files[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(dir);
  return { dir, files };
}

export function validatePackage(files) {
  const findings = [];
  const addFinding = (file, line, severity, message) => {
    findings.push({ file, line, severity, message });
  };

  // 1. Manifest шалгах
  const manifestRaw = files['manifest.yaml'] ?? files['manifest.yml'];
  if (!manifestRaw) {
    addFinding('manifest.yaml', 1, 'error', 'manifest.yaml файл олдсонгүй');
    return { ok: false, errors: 1, warnings: 0, findings, stats: {} };
  }

  const manifestKey = manifestRaw.match(/^key:\s*["']?([A-Za-z0-9_.-]+)["']?/m)?.[1];
  const manifestName = manifestRaw.match(/^name:\s*["']?([^"'\n\r]+)["']?/m)?.[1];
  const manifestVer = manifestRaw.match(/^version:\s*["']?([^"'\n\r]+)["']?/m)?.[1];

  if (!manifestKey) {
    addFinding('manifest.yaml', 1, 'error', 'manifest.yaml: "key" талбар дутуу байна');
  } else if (!/^[a-z][a-z0-9-]{1,49}$/.test(manifestKey)) {
    addFinding('manifest.yaml', 1, 'error', `manifest.yaml: key "${manifestKey}" буруу хэлбэртэй (жижиг латин үсэг, тоо, зураас; 2–50 тэмдэгт)`);
  }

  if (!manifestName) {
    addFinding('manifest.yaml', 1, 'error', 'manifest.yaml: "name" талбар дутуу байна');
  }

  // 2. ERD задлах
  const tables = new Map(); // tableName -> Set<columnName>
  const erdRaw = files['erd.dbml'];
  if (erdRaw) {
    const tableRegex = /Table\s+(?:"([^"]+)"|([A-Za-z0-9_]+))\s*\{([^}]*)\}/gs;
    let match;
    while ((match = tableRegex.exec(erdRaw)) !== null) {
      const tblName = match[1] || match[2];
      const body = match[3];
      const cols = new Set();
      const colRegex = /^\s*(?:"([^"]+)"|([A-Za-z0-9_]+))\s+([A-Za-z0-9_]+(?:\([^)]*\))?)/gm;
      let cMatch;
      while ((cMatch = colRegex.exec(body)) !== null) {
        cols.add(cMatch[1] || cMatch[2]);
      }
      tables.set(tblName, cols);
    }
  }

  // 3. States шалгах
  const statesRaw = files['states.mmd'];
  if (statesRaw) {
    const directiveRegex = /%%\s*machine:\s*([^\s]+)\s+table:\s*([^\s]+)\s+column:\s*([^\s\n\r]+)/g;
    let dMatch;
    while ((dMatch = directiveRegex.exec(statesRaw)) !== null) {
      const machineName = dMatch[1];
      const tbl = dMatch[2];
      const col = dMatch[3];
      if (tables.size > 0 && !tables.has(tbl)) {
        addFinding('states.mmd', 1, 'error', `Төлөвийн машин "${machineName}"-ийн заасан "${tbl}" хүснэгт erd.dbml-д олдсонгүй`);
      } else if (tables.size > 0 && tables.has(tbl) && !tables.get(tbl).has(col)) {
        addFinding('states.mmd', 1, 'error', `"${tbl}" хүснэгтэд төлөвийн "${col}" багана erd.dbml-д тодорхойлогдоогүй байна`);
      }
    }
  }

  // 4. Screens шалгах
  const screensRaw = files['screens.yaml'];
  if (screensRaw && tables.size > 0) {
    const tableMatches = [...screensRaw.matchAll(/table:\s*["']?([^"'\n\r]+)["']?/g)];
    for (const tm of tableMatches) {
      const tName = tm[1].trim();
      if (!tables.has(tName)) {
        addFinding('screens.yaml', 1, 'error', `screens.yaml-д ашигласан "${tName}" хүснэгт erd.dbml-д байхгүй байна`);
      }
    }
  }

  // 5. Requirements шалгах
  const reqRaw = files['requirements.md'];
  let reqCount = 0;
  if (reqRaw) {
    const lines = reqRaw.split('\n');
    const seenIds = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (!cells.length || cells.every(c => /^:?-+:?$/.test(c))) continue;
      if (cells[0].toLowerCase() === 'id') continue;

      const reqId = cells[0];
      if (seenIds.has(reqId)) {
        addFinding('requirements.md', i + 1, 'error', `Шаардлагын ID "${reqId}" давхардсан байна`);
      } else {
        seenIds.add(reqId);
        reqCount++;
      }
    }
  }

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;

  return {
    ok: errors === 0,
    errors,
    warnings,
    findings,
    stats: {
      tables: tables.size,
      requirements: reqCount,
      files: Object.keys(files).length
    }
  };
}
