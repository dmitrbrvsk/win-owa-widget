// A private, in-process origin for bundled UI. No listener or OS protocol association is created.
import { protocol } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import nodePath from 'node:path';

const SCHEME = 'owa-widget';
const ORIGIN = `${SCHEME}://app`;
const PAGE = '/index.html';
const ROOT = nodePath.resolve(__dirname, '../renderer');

/** Must run before app.ready. CSP, fetch, workers and extensions keep their restricted defaults. */
export function registerRendererScheme() {
    protocol.registerSchemesAsPrivileged([
        { scheme: SCHEME, privileges: { standard: true, secure: true, corsEnabled: true } },
    ]);
}

export function rendererPageUrl(route: string): string {
    return `${ORIGIN}${PAGE}#/${encodeURIComponent(route)}`;
}

function rendererUrl(raw: string): URL | undefined {
    try {
        const u = new URL(raw);
        if (
            u.protocol === `${SCHEME}:` &&
            u.hostname === 'app' &&
            !u.port &&
            !u.username &&
            !u.password &&
            !u.search
        )
            return u;
    } catch {
        /* Invalid URLs are untrusted. */
    }
    return undefined;
}

/** One document only, regardless of the route. Assets and legacy file URLs cannot send IPC. */
export function isRendererPageUrl(raw: string): boolean {
    return rendererUrl(raw)?.pathname === PAGE;
}

type RendererRequest = { url: string; method: string; initiatorOrigin?: string };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

/** Only the entry HTML and Vite's flat JS/CSS assets are exposed, never arbitrary application files. */
export async function serveRendererRequest(
    request: RendererRequest,
    root = ROOT,
): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response(null, { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
    if (request.initiatorOrigin !== undefined && request.initiatorOrigin !== ORIGIN)
        return new Response(null, { status: 403, headers: HEADERS });
    const u = rendererUrl(request.url);
    if (!u) return new Response(null, { status: 404, headers: HEADERS });
    const asset = /^\/assets\/[A-Za-z0-9_-]{1,160}\.(js|css)$/.exec(u.pathname);
    let mime: string | undefined;
    if (u.pathname === PAGE) mime = 'text/html';
    else if (asset?.[1] === 'js') mime = 'text/javascript';
    else if (asset?.[1] === 'css') mime = 'text/css';
    if (!mime) return new Response(null, { status: 404, headers: HEADERS });
    try {
        const base = await realpath(root);
        const file = await realpath(nodePath.join(base, u.pathname.slice(1)));
        const rel = nodePath.relative(base, file);
        if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel))
            return new Response(null, { status: 404, headers: HEADERS });
        const data = await readFile(file);
        return new Response(request.method === 'HEAD' ? null : new Uint8Array(data), {
            headers: { ...HEADERS, 'Content-Type': `${mime}; charset=utf-8` },
        });
    } catch {
        // No filesystem paths or OS errors are disclosed to the page.
        return new Response(null, { status: 404, headers: HEADERS });
    }
}

/** All UI windows use the default session; Exchange sessions receive no renderer handler. */
export function installRendererProtocol() {
    protocol.handle(SCHEME, (request) => serveRendererRequest(request));
}
