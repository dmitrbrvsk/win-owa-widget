// Validate version-specific notes before a build, or print them for the release artifact.
import { readFileSync } from 'node:fs';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/release-notes.mjs [--check]');
  }
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('package.json must contain a valid release version');
  }
  const relative = `docs/releases/v${version}.md`;
  let notes;
  try {
    notes = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Missing ${relative}: add the changes for this version before publishing`);
  }
  if (!/^## (Что изменилось|Что вошло в релиз)\s*$/m.test(notes) || !/^- /m.test(notes)) {
    throw new Error(`${relative} must describe the changes in a heading and a bullet list`);
  }
  if (/\b(TODO|TBD)\b|<версия>/.test(notes)) {
    throw new Error(`${relative} still contains template placeholders`);
  }
  if (notes.length > 125_000) throw new Error(`${relative} exceeds the GitHub release body limit`);
  process.stdout.write(args[0] === '--check' ? `Release notes ready: v${version}\n` : notes);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
