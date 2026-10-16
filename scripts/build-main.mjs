// Bundles the Electron main process, preload and standalone Node MCP CLI with esbuild.
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { englishZodLocalePlugin } from './zod-locales.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));

const watch = process.argv.includes('--watch');
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=', 2)[1];
const outdir = option('outdir') ?? 'dist';
const metadataDir = option('metadata-dir');

const common = {
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    minify: !watch,
    metafile: !!metadataDir,
    // The .map files are kept out of the package (see electron-builder.yml), so a production bundle must
    // not point at them either: 'external' writes the map for reading a release stack trace locally but
    // emits no sourceMappingURL comment. Under --watch the comment is what makes devtools useful.
    sourcemap: watch ? true : 'external',
    external: ['electron'],
    logLevel: 'info',
};

const configs = [
    { ...common, entryPoints: ['src/main/index.ts'], outfile: path.join(outdir, 'main/index.js') },
    {
        ...common,
        entryPoints: ['src/preload/index.ts'],
        outfile: path.join(outdir, 'preload/index.js'),
    },
    {
        ...common,
        entryPoints: ['src/mcp/index.ts'],
        outfile: path.join(outdir, 'mcp/index.cjs'),
        define: { MCP_BUILD_VERSION: JSON.stringify(version) },
        plugins: watch ? [] : [englishZodLocalePlugin()],
    },
];

await Promise.all(
    configs.map(async (cfg) => {
        if (!watch) {
            const result = await build(cfg);
            if (metadataDir) {
                await mkdir(metadataDir, { recursive: true });
                const name = path.basename(path.dirname(cfg.outfile));
                await writeFile(
                    path.join(metadataDir, `${name}.json`),
                    JSON.stringify(result.metafile),
                );
            }
            return;
        }
        const ctx = await context(cfg);
        await ctx.watch();
    }),
);

await mkdir(path.join(outdir, 'mcp'), { recursive: true });
await copyFile('THIRD_PARTY_NOTICES.txt', path.join(outdir, 'mcp/THIRD_PARTY_NOTICES.txt'));
