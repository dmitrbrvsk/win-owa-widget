import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const DEV_SERVER_PORT = 5199;

// Matched and rewritten verbatim, leading space included, so a stray double space cannot be mistaken
// for a match on a neighbouring directive.
const SHIPPED_CONNECT_SRC = " connect-src 'none';";
const DEV_CONNECT_SRC = ` connect-src 'self' ws://localhost:${DEV_SERVER_PORT};`;

// Renderer only. Main and preload are bundled by scripts/build-main.mjs (esbuild).
export default defineConfig(({ command, mode }) => ({
    root: path.resolve(__dirname, 'src/renderer'),
    base: './',
    define: { BROWSER_DEMO_BUILD: JSON.stringify(command === 'serve' || mode === 'browser-demo') },
    plugins: [
        react(),
        {
            // index.html already carries the shipped `connect-src 'none'`, so the only rewrite that can go
            // wrong is the one that loosens it for the dev-server websocket. Both directions assert the
            // substring first: a reformatted meta tag then stops the build instead of quietly shipping
            // whatever connect-src happens to be in the file.
            name: 'loosen-csp-for-dev-server',
            transformIndexHtml: (html, ctx) => {
                if (!html.includes(SHIPPED_CONNECT_SRC)) {
                    throw new Error(
                        `vite.config.ts expects "${SHIPPED_CONNECT_SRC.trim()}" in the Content-Security-Policy meta tag of src/renderer/index.html, and it is not there. ` +
                            'Restore it (the built page must reach nobody) and keep the spacing the plugin matches on.',
                    );
                }
                return ctx.server ? html.replace(SHIPPED_CONNECT_SRC, DEV_CONNECT_SRC) : html;
            },
        },
    ],
    build: {
        outDir: path.resolve(
            __dirname,
            mode === 'browser-demo' ? 'dist/browser-demo' : 'dist/renderer',
        ),
        emptyOutDir: true,
        target: 'chrome140',
        // Dynamic route chunks are loaded from this same private origin. Avoid Vite's preload
        // fetch helper: Chromium applies connect-src to it, while shipped CSP forbids connections.
        modulePreload: false,
    },
    server: { port: DEV_SERVER_PORT, strictPort: true },
}));
