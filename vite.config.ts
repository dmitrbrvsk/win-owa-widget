import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer only. Main and preload are bundled by scripts/build-main.mjs (esbuild).
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    {
      // The dev-server websocket is allowed only while developing; the built page talks to nobody.
      name: 'strict-csp-in-build',
      transformIndexHtml: (html, ctx) => (ctx.server ? html : html.replace(" connect-src 'self' ws://localhost:5199;", " connect-src 'none';")),
    },
  ],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
  },
  server: { port: 5199, strictPort: true },
});
