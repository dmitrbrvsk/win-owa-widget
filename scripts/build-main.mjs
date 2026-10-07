// Bundles the Electron main process and the preload script with esbuild.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
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
