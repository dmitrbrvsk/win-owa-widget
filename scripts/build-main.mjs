// Bundles the Electron main process and the preload script with esbuild.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
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
];

if (watch) {
  for (const cfg of configs) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
} else {
  await Promise.all(configs.map((cfg) => build(cfg)));
}
