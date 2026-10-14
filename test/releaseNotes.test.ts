import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];
const body = '**Новые возможности.**\n\n## Что изменилось\n\n- Текст с кавычками "и переносами".\n';

function fixture(version: string, notes?: string) {
  const root = mkdtempSync(join(tmpdir(), 'owa-release-notes-'));
  fixtures.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'docs', 'releases'), { recursive: true });
  copyFileSync(new URL('../scripts/release-notes.mjs', import.meta.url), join(root, 'scripts', 'release-notes.mjs'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  if (notes !== undefined) writeFileSync(join(root, 'docs', 'releases', `v${version}.md`), notes);
  return (args: string[] = []) => spawnSync(process.execPath, [join(root, 'scripts', 'release-notes.mjs'), ...args], { encoding: 'utf8', cwd: tmpdir() });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('release notes used for publication', () => {
  it('preserves the exact Markdown independently of the working directory', () => {
    const result = fixture('1.3.0', body)();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(body);
    expect(result.stderr).toBe('');
  });

  it('refuses a version bump without its own notes', () => {
    const result = fixture('1.3.0')(['--check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing docs/releases/v1.3.0.md');
    expect(result.stdout).toBe('');
  });

  it('refuses an unfinished release template', () => {
    const result = fixture('1.3.0', body + '\nTODO: <версия>\n')();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('template placeholders');
    expect(result.stdout).toBe('');
  });

  it('rejects a version that could escape the notes directory', () => {
    const result = fixture('../private')();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('valid release version');
  });
});
