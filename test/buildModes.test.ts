import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string;
beforeEach(() => {
    root = mkdtempSync(nodePath.join(tmpdir(), 'owa-build-modes-'));
});
afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

it('refuses an unreviewed Zod version or a locale barrel with initialization code', () => {
    const packageDir = nodePath.join(root, 'node_modules/zod');
    const locales = nodePath.join(packageDir, 'v4/locales');
    mkdirSync(locales, { recursive: true });
    const source = readFileSync('node_modules/zod/v4/locales/index.js', 'utf8');
    writeFileSync(nodePath.join(locales, 'index.js'), source);
    writeFileSync(nodePath.join(locales, 'en.js'), 'export default () => ({});');
    const packageFile = nodePath.join(packageDir, 'package.json');
    writeFileSync(packageFile, JSON.stringify({ version: '4.6.7' }));
    const entry = nodePath.join(root, 'index.js');
    writeFileSync(entry, 'export { en } from "./node_modules/zod/v4/locales/index.js";');
    const bundle = () =>
        execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                'import { build } from "esbuild"; ' +
                    'const { englishZodLocalePlugin } = await import(process.argv[2]); ' +
                    'await build({ entryPoints: [process.argv[1]], bundle: true, write: false, ' +
                    'plugins: [englishZodLocalePlugin()] });',
                entry,
                pathToFileURL(nodePath.resolve('scripts/zod-locales.mjs')).href,
            ],
            { stdio: 'pipe' },
        );
    expect(bundle).not.toThrow();
    writeFileSync(packageFile, JSON.stringify({ version: '4.6.8' }));
    expect(bundle).toThrow('Re-audit MCP English-only locales');
    writeFileSync(packageFile, JSON.stringify({ version: '4.6.7' }));
    writeFileSync(nodePath.join(locales, 'index.js'), `${source}\ninitializeLocaleRegistry();`);
    expect(bundle).toThrow('Re-audit MCP English-only locales');
});

it('keeps watch bundles readable, source maps linked and all developer locale exports intact', async () => {
    const child = spawn(
        process.execPath,
        ['scripts/build-main.mjs', '--watch', `--outdir=${root}`],
        {
            stdio: ['ignore', 'ignore', 'pipe'],
        },
    );
    try {
        await new Promise<void>((resolve, reject) => {
            let output = '';
            const timer = setTimeout(
                () => reject(new Error('Watch builds did not complete')),
                5000,
            );
            child.once('error', reject);
            child.stderr.on('data', (chunk: Buffer) => {
                output += chunk.toString('utf8');
                if ((output.match(/build finished, watching for changes/g) ?? []).length === 3) {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
        for (const file of ['main/index.js', 'preload/index.js', 'mcp/index.cjs']) {
            const code = readFileSync(nodePath.join(root, file), 'utf8');
            expect(code).toContain('sourceMappingURL=');
            expect(code.split('\n').length).toBeGreaterThan(100);
        }
        const map = JSON.parse(readFileSync(nodePath.join(root, 'mcp/index.cjs.map'), 'utf8')) as {
            sources: string[];
        };
        expect(map.sources.filter((source) => source.includes('/zod/v4/locales/'))).toHaveLength(
            64,
        );
    } finally {
        if (child.exitCode === null)
            await new Promise<void>((resolve) => {
                child.once('exit', () => resolve());
                child.kill();
            });
    }
}, 10_000);
