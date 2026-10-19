import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectFiles, initProject } from '../src/init.js';
import { validatePackage } from '../src/validate.js';

describe('Buteemj CLI core tests', () => {
  it('creates project files with valid manifest and structure', () => {
    const files = createProjectFiles('Миний Апп', 'my-app', true);
    assert.ok(files['manifest.yaml'].includes('key: "my-app"'));
    assert.ok(files['requirements.md'].includes('R01'));
    assert.ok(files['erd.dbml'].includes('Table "Хүсэлт"'));
    assert.ok(files['states.mmd'].includes('stateDiagram-v2'));
    assert.ok(files['screens.yaml'].includes('request_list'));
  });

  it('scaffolds project on disk and validates cleanly', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bj-test-'));
    try {
      const { dir, files } = initProject(join(tmp, 'test-project'), 'Тест Төсөл', 'test-project', true);
      assert.ok(existsSync(join(dir, 'manifest.yaml')));
      assert.ok(existsSync(join(dir, 'erd.dbml')));

      const result = validatePackage(files);
      assert.equal(result.ok, true);
      assert.equal(result.errors, 0);
      assert.ok(result.stats.tables > 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('catches broken references and invalid keys', () => {
    assert.throws(() => {
      createProjectFiles('Алдаа', 'INVALID_KEY!', false);
    }, /key нь/);

    const brokenFiles = {
      'manifest.yaml': 'name: Тест\nkey: test-broken\nversion: 0.1\n',
      'erd.dbml': 'Table "Хэрэглэгч" { "Нэр" text }\n',
      'states.mmd': '%% machine: М table: Байхгүй column: Төлөв\nstateDiagram-v2\n [*] --> A\n'
    };
    const result = validatePackage(brokenFiles);
    assert.equal(result.ok, false);
    assert.ok(result.errors >= 1);
    assert.ok(result.findings.some(f => f.message.includes('Байхгүй')));
  });
});
