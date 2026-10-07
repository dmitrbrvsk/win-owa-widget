// Dev loop: Vite dev server for the renderer + esbuild for main/preload + Electron.
// `npm run dev:demo` runs with fake meetings, no Exchange needed.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';
import { build } from 'esbuild';

const demo = process.argv.includes('--demo');

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron'] };
await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' });

const env = { ...process.env, VITE_DEV_URL: url };
if (demo) env.OWA_DEMO = '1';

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
