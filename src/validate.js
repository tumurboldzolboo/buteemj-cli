import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { validatePackage as platformValidate } from './validator/index.mjs';

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

// PLAN13 N3: шалгалтын дүрэм нь платформын validator-ынх (src/validator/ — `npm run sync-validator`-ын хуулбар), энд давхардуулахгүй.
export function validatePackage(files, opts = {}) {
  return platformValidate(files, { packages: new Map(), ...opts });
}
