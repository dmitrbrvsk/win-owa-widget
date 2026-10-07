import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

// The shipped Content-Security-Policy used to be produced by a string replace during the build, which
// a reformatted meta tag would have turned into a silent no-op. The safe value now lives in the source
// and the dev server loosens it, so these checks are what keeps it there.
describe('the page that ships forbids every network connection', () => {
  it('states connect-src none in the source, with no dev-server origin left in it', () => {
    const html = read('src/renderer/index.html');
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain('ws://');
  });

  it('keeps connect-src none through the build', () => {
    const built = resolve(repoRoot, 'dist/renderer/index.html');
    // Skipped on a tree that has not been built: `npm test` must not depend on `npm run build`.
    if (!existsSync(built)) return;
    expect(readFileSync(built, 'utf8')).toContain("connect-src 'none'");
  });
});
