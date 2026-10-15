import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const wire = vi.hoisted(() => ({ privileged: vi.fn(), handle: vi.fn() }));
vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: wire.privileged, handle: wire.handle } }));
import { registerRendererScheme, installRendererProtocol, rendererPageUrl, isRendererPageUrl, serveRendererRequest } from '../src/main/rendererProtocol';
let root: string;
beforeEach(async () => { vi.clearAllMocks(); root = await mkdtemp(join(tmpdir(), 'owa-protocol-')); await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), '<h1>Widget</h1>'); await writeFile(join(root, 'assets/index-123.js'), 'export const ready = true;'); await writeFile(join(root, 'assets/index-123.css'), 'body { color: red; }'); await writeFile(join(root, 'secret.txt'), 'PRIVATE'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const request = (url: string, method = 'GET', initiatorOrigin?: string) => ({ url, method, initiatorOrigin });
describe('the private renderer protocol', () => {
  it('registers a standard secure scheme without CSP or service-worker bypasses', () => {
    registerRendererScheme();
    expect(wire.privileged).toHaveBeenCalledWith([{ scheme: 'owa-widget', privileges: { standard: true, secure: true, corsEnabled: true } }]);
  });
  it('uses the same entry point for windows and IPC trust', () => {
    expect(rendererPageUrl('popup')).toBe('owa-widget://app/index.html#/popup');
    expect(isRendererPageUrl(rendererPageUrl('calendar'))).toBe(true);
    for (const url of ['file:///tmp/index.html', 'https://app/index.html', 'owa-widget://evil/index.html', 'owa-widget://app.evil/index.html', 'owa-widget://app@evil/index.html', 'owa-widget://name@app/index.html', 'owa-widget://app:80/index.html', 'owa-widget://app/index.html?x=1', 'owa-widget://app/assets/index-123.js', 'owa-widget://app/index.html/extra']) expect(isRendererPageUrl(url), url).toBe(false);
  });
  it.each([['index.html','text/html'], ['assets/index-123.js','text/javascript'], ['assets/index-123.css','text/css']])('serves bundled UI with an explicit MIME type (%s)', async (path, mime) => {
    const response = await serveRendererRequest(request('owa-widget://app/' + path, 'GET', 'owa-widget://app'), root);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain(mime);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff'); expect(await response.text()).not.toContain('PRIVATE');
  });
  it('provides HEAD without a body and makes missing assets fail', async () => {
    expect(await (await serveRendererRequest(request(rendererPageUrl('popup'), 'HEAD'), root)).text()).toBe('');
    expect((await serveRendererRequest(request('owa-widget://app/assets/missing.js'), root)).status).toBe(404);
  });
  it.each(['owa-widget://evil/index.html','https://app/index.html','owa-widget://app/secret.txt','owa-widget://app/../secret.txt','owa-widget://app/assets/%2e%2e/secret.txt','owa-widget://app/assets/..%2fsecret.txt','owa-widget://app/assets/..%5csecret.txt','owa-widget://app/assets/index-123.js.map','owa-widget://app/assets/C:%5csecret.js','owa-widget://app/%00index.html','owa-widget://app/index.html?file=secret.txt','owa-widget://app@evil/index.html','owa-widget://name@app/index.html'])('never exposes other files or hosts: %s', async url => {
    const response = await serveRendererRequest(request(url), root); expect(response.status).toBeGreaterThanOrEqual(400); expect(await response.text()).not.toContain('PRIVATE');
  });
  it('rejects writes and foreign or opaque initiators', async () => {
    expect((await serveRendererRequest(request(rendererPageUrl('popup'), 'POST'), root)).status).toBe(405);
    for (const origin of ['https://evil.example', 'file://', 'null', 'owa-widget://app.evil']) expect((await serveRendererRequest(request(rendererPageUrl('popup'), 'GET', origin), root)).status).toBe(403);
  });
  it('installs the handler into the session used by the windows', () => {
    installRendererProtocol(); expect(wire.handle).toHaveBeenCalledWith('owa-widget', expect.any(Function));
  });
});

it('cannot follow an asset symlink outside the renderer directory', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'owa-protocol-private-'));
  try {
    await writeFile(join(outside, 'secret.js'), 'PRIVATE');
    await symlink(join(outside, 'secret.js'), join(root, 'assets/linked.js'));
    const response = await serveRendererRequest(request('owa-widget://app/assets/linked.js'), root);
    expect(response.status).toBe(404); expect(await response.text()).not.toContain('PRIVATE');
  } finally { await rm(outside, { recursive: true, force: true }); }
});
