import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function createProjectFiles(name, key, withExample = true) {
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(key)) {
    throw new Error('key нь 2–50 тэмдэгт, зөвхөн жижиг латин үсэг, тоо, зураас агуулсан байх ёстой');
  }

  const manifest = [
    `name: "${name}"`,
    `key: "${key}"`,
    `version: "0.1.0"`,
    `description: "${name} системийн BRD+PRD багц"`,
    `orgScoped: true`,
    `language: "mn"`,
    `files:`,
    `  requirements: "requirements.md"`,
    `  erd: "erd.dbml"`,
    `  screens: "screens.yaml"`,
    `  roles: "roles.csv"`,
    withExample ? `  states: "states.mmd"` : null
  ].filter(Boolean).join('\n') + '\n';

  const requirements = [
    '| ID | Төрөл | Шаардлага | Эрэмбэ | Холбоос |',
    '|---|---|---|---|---|',
    withExample ? '| R01 | Үйл ажиллагаа | Хүсэлт бүртгэж төлөвөөр удирдах | 1 | Хүсэлт, Хүсэлтийн явц |' : ''
  ].filter(Boolean).join('\n') + '\n';

  const erd = withExample
    ? `// Өгөгдлийн сангийн хүснэгтүүд
Table "Хүсэлт" {
  "Гарчиг" text(200) [not null]
  "Төлөв" text(30) [not null, note: 'state: Хүсэлтийн явц']
  "Тайлбар" text
}
`
    : `// Өгөгдлийн сангийн хүснэгтүүдийг энд бичнэ.\n`;

  const states = withExample
    ? `%% machine: Хүсэлтийн явц table: Хүсэлт column: Төлөв
stateDiagram-v2
    [*] --> Ноорог
    Ноорог --> Илгээсэн : Илгээх
    Илгээсэн --> Зөвшөөрсөн : Зөвшөөрөх
    Илгээсэн --> Цуцалсан : Цуцлах
    Зөвшөөрсөн --> [*]
    Цуцалсан --> [*]
`
    : '';

  const screens = withExample
    ? `version: 0.1
screens:
  - id: request_list
    title: "Хүсэлтийн жагсаалт"
    table: "Хүсэлт"
    fields:
      - "Гарчиг"
      - "Төлөв"
`
    : `version: 0.1\nscreens: []\n`;

  const roles = `Үүрэг,Хүснэгт,Харах,Үүсгэх,Өөрчлөх,Устгах,Мөрийн шүүлт,Нуух талбар,Зөвхөн унших талбар
Админ,Хүснэгт,Тийм,Тийм,Тийм,Тийм,,,
`;

  const files = {
    'manifest.yaml': manifest,
    'requirements.md': requirements,
    'erd.dbml': erd,
    'screens.yaml': screens,
    'roles.csv': roles
  };
  if (withExample) files['states.mmd'] = states;
  return files;
}

export function initProject(targetDir, name, key, withExample = true) {
  const dir = resolve(targetDir);
  if (existsSync(join(dir, 'manifest.yaml'))) {
    throw new Error(`Хавтас аль хэдийн төсөл агуулж байна: ${dir}`);
  }
  mkdirSync(dir, { recursive: true });
  const files = createProjectFiles(name, key, withExample);
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(dir, filename), content, 'utf8');
  }
  return { dir, files };
}
