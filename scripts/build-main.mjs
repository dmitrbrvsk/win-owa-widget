// Bundles the Electron main process, preload and standalone Node MCP CLI with esbuild.
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));

const watch = process.argv.includes('--watch');

const common = {
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    // The .map files are kept out of the package (see electron-builder.yml), so a production bundle must
    // not point at them either: 'external' writes the map for reading a release stack trace locally but
    // emits no sourceMappingURL comment. Under --watch the comment is what makes devtools useful.
    sourcemap: watch ? true : 'external',
    external: ['electron'],
    logLevel: 'info',
};

const configs = [
    { ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' },
    { ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' },
    {
        ...common,
        entryPoints: ['src/mcp/index.ts'],
        outfile: 'dist/mcp/index.cjs',
        define: { MCP_BUILD_VERSION: JSON.stringify(version) },
    },
];

await Promise.all(
    configs.map(async (cfg) => {
        if (!watch) {
            await build(cfg);
            return;
        }
        const ctx = await context(cfg);
        await ctx.watch();
    }),
);

await mkdir('dist/mcp', { recursive: true });
await copyFile('THIRD_PARTY_NOTICES.txt', 'dist/mcp/THIRD_PARTY_NOTICES.txt');
