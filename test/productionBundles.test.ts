import { type Metafile, transformSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Rollup } from 'vite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

let root: string;
let renderer: Rollup.RollupOutput;
let demo: Rollup.RollupOutput;
const read = (path: string) => readFileSync(nodePath.join(root, path), 'utf8');

async function rendererBuild(mode: string): Promise<Rollup.RollupOutput> {
    const result = await build({
        configFile: nodePath.resolve('vite.config.ts'),
        mode,
        logLevel: 'silent',
        build: { outDir: nodePath.join(root, mode) },
    });
    if (!Array.isArray(result) && 'output' in result) return result;
    throw new Error('Expected one completed renderer build.');
}

beforeAll(async () => {
    root = mkdtempSync(nodePath.join(tmpdir(), 'owa-production-bundles-'));
    vi.stubEnv('NODE_ENV', 'production');
    execFileSync(
        process.execPath,
        ['scripts/build-main.mjs', `--outdir=${root}`, `--metadata-dir=${root}/metadata`],
        { stdio: 'pipe' },
    );
    renderer = await rendererBuild('production');
    demo = await rendererBuild('browser-demo');
}, 30_000);

afterAll(() => {
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
});

it('minifies shipped Node bundles and emits only local external source maps', () => {
    for (const file of ['main/index.js', 'preload/index.js', 'mcp/index.cjs']) {
        const code = read(file);
        expect(code).not.toContain('sourceMappingURL');
        // Template literals and legal notices can retain newlines even in a minified bundle.
        expect(code.split('\n').length).toBeLessThan(200);
        const map = JSON.parse(read(`${file}.map`)) as {
            sources: string[];
            sourcesContent: string[];
        };
        expect(map.sources.length).toBeGreaterThan(0);
        expect(map.sourcesContent.length).toBe(map.sources.length);
    }
    expect(Buffer.byteLength(read('main/index.js'))).toBeLessThan(370_000);
    expect(Buffer.byteLength(read('preload/index.js'))).toBeLessThan(10_000);
    expect(Buffer.byteLength(read('mcp/index.cjs'))).toBeLessThan(530_000);
});

it('keeps English Zod validation and the real SDK while excluding unused locale implementations', () => {
    const metadata = JSON.parse(read('metadata/mcp.json')) as Metafile;
    const inputs = Object.keys(metadata.inputs);
    const locales = inputs.filter((file) => /\/zod\/v4\/locales\//.test(file));
    expect(locales.map((file) => nodePath.basename(file)).toSorted()).toEqual([
        'en.js',
        'index.js',
    ]);
    expect(inputs.some((file) => file.includes('@modelcontextprotocol/server/dist/'))).toBe(true);
    expect(inputs.some((file) => file.endsWith('zod/v4/core/parse.js'))).toBe(true);
    expect(inputs.some((file) => file.endsWith('zod/v4/classic/schemas.js'))).toBe(true);
});

const chunks = (result: Rollup.RollupOutput) =>
    result.output.filter((output): output is Rollup.OutputChunk => output.type === 'chunk');
const renderedModules = (result: Rollup.RollupOutput) =>
    chunks(result).flatMap((chunk) =>
        Object.entries(chunk.modules)
            .filter(([, info]) => info.renderedLength > 0)
            .map(([id]) => id),
    );

it('removes browser fixtures from production while retaining the explicit browser demo build', () => {
    const fixtures = /\/(?:main\/demo|renderer\/(?:browserDemoApi|mcpMock))\.ts$/;
    expect(renderedModules(renderer).filter((id) => fixtures.test(id))).toEqual([]);
    expect(renderedModules(demo).some((id) => id.endsWith('/main/demo.ts'))).toBe(true);
    expect(renderedModules(demo).some((id) => id.endsWith('/renderer/browserDemoApi.ts'))).toBe(
        true,
    );
    expect(read('production/index.html')).toContain("connect-src 'none'");
    expect(read('browser-demo/index.html')).toContain("connect-src 'none'");
});

it('loads each screen through a flat JavaScript route chunk and keeps entry code below its budget', () => {
    const entry = chunks(renderer).find((chunk) => chunk.isEntry)!;
    expect(Buffer.byteLength(entry.code)).toBeLessThan(300_000);
    const dynamicChunks = chunks(renderer).filter((chunk) => chunk.isDynamicEntry);
    for (const name of [
        'Popup',
        'Calendar',
        'Settings',
        'Welcome',
        'Reminder',
        'Create',
        'Availability',
        'Stats',
        'PrivateCalendar',
    ])
        expect(dynamicChunks.some((chunk) => chunk.facadeModuleId?.endsWith(`/${name}.tsx`))).toBe(
            true,
        );
    for (const chunk of chunks(renderer)) expect(chunk.fileName).toMatch(/^assets\/[\w-]+\.js$/);
});

it('surfaces a missing production preload without constructing a mock calendar', () => {
    const source = readFileSync('src/renderer/api.ts', 'utf8').replace(
        "import { mockApi } from './browserDemoApi';",
        'const mockApi = () => { throw new Error("Unexpected demo fallback"); };',
    );
    const { code } = transformSync(source, {
        loader: 'ts',
        format: 'cjs',
        define: { BROWSER_DEMO_BUILD: 'false' },
    });
    const bridge = { getSnapshot: () => 'real snapshot' };
    const missing = { exports: {} as { preloadError?: string; api?: typeof bridge } };
    runInNewContext(code, { module: missing, window: {} });
    expect(missing.exports.preloadError).toContain('preload bridge is unavailable');
    expect(() => missing.exports.api?.getSnapshot()).toThrow('preload bridge is unavailable');
    const connected = { exports: {} as { preloadError?: string; api?: typeof bridge } };
    runInNewContext(code, { module: connected, window: { owa: bridge } });
    expect(connected.exports.preloadError).toBe(null);
    expect(connected.exports.api).toBe(bridge);
});
