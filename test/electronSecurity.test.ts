import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { fileURLToPath } from 'node:url';
const state = vi.hoisted(() => ({ packaged: true, warn: vi.fn(), permissionRequest: vi.fn(), permissionCheck: vi.fn() }));
vi.mock('electron', () => ({ app: { get isPackaged() { return state.packaged; } }, session: { defaultSession: { setPermissionRequestHandler: state.permissionRequest, setPermissionCheckHandler: state.permissionCheck } } }));
vi.mock('../src/main/log', async () => {
  const real = await vi.importActual<typeof import('../src/main/log')>('../src/main/log');
  return { ...real, log: { warn: state.warn, error: vi.fn() } };
});
import { hardenSession, hardenWebContents, isTrustedSender, isTrustedUrl } from '../src/main/security';
const page = new URL('../src/renderer/index.html', import.meta.url).href;
const oldDev = process.env.VITE_DEV_URL;
beforeEach(() => { state.packaged = true; vi.clearAllMocks(); delete process.env.VITE_DEV_URL; });
afterEach(() => { if (oldDev === undefined) delete process.env.VITE_DEV_URL; else process.env.VITE_DEV_URL = oldDev; });
function contents() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let opening!: (details: { url: string }) => { action: string };
  const wc = { setWindowOpenHandler: (fn: typeof opening) => { opening = fn; }, on: (name: string, fn: (...args: unknown[]) => void) => { listeners.set(name, fn); } };
  hardenWebContents(wc as unknown as WebContents);
  return { listeners, opening: (url: string) => opening({ url }) };
}
describe('Electron trust boundaries', () => {
  it('accepts only the shipped renderer file in a packaged build', () => {
    expect(isTrustedUrl(page + '#/calendar')).toBe(true);
    expect(isTrustedUrl(page + '?state=ok#/popup')).toBe(true);
    process.env.VITE_DEV_URL = 'http://localhost:5199';
    for (const value of ['https://evil.example', 'http://localhost:5199/', page.replace('index.html', 'other.html'), page + '/extra', 'data:text/html,hello', 'javascript:alert(1)', 'file:///etc/passwd']) expect(isTrustedUrl(value)).toBe(false);
    expect(fileURLToPath(page)).toContain('/src/renderer/index.html');
  });
  it('compares development origins rather than string prefixes', () => {
    state.packaged = false; process.env.VITE_DEV_URL = 'http://localhost:5199';
    expect(isTrustedUrl('http://localhost:5199/#/popup')).toBe(true);
    for (const value of ['http://localhost:5199@evil.example/', 'http://localhost:51990/', 'http://localhost.evil.example:5199/', 'https://localhost:5199/']) expect(isTrustedUrl(value)).toBe(false);
  });
  it('rejects a trusted URL in a subframe and a foreign URL in the main frame', () => {
    const main = { url: page };
    const event = (frame: typeof main | null) => ({ senderFrame: frame, sender: { mainFrame: main } }) as unknown as IpcMainInvokeEvent;
    expect(isTrustedSender(event(main))).toBe(true);
    expect(isTrustedSender(event({ url: page }))).toBe(false);
    expect(isTrustedSender(event(null))).toBe(false);
    main.url = 'https://evil.example'; expect(isTrustedSender(event(main))).toBe(false);
  });
  it('blocks popups, foreign navigation, redirects and webviews', () => {
    const wc = contents(); expect(wc.opening('https://evil.example').action).toBe('deny');
    const preventDefault = vi.fn(); wc.listeners.get('will-navigate')!({ preventDefault }, 'https://evil.example');
    wc.listeners.get('will-frame-navigate')!({ preventDefault, url: 'https://evil.example' });
    wc.listeners.get('will-redirect')!({ preventDefault }); wc.listeners.get('will-attach-webview')!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(4);
  });
  it('denies permissions instead of using Electron defaults', () => {
    hardenSession(); const callback = vi.fn(); state.permissionRequest.mock.calls[0][0]({}, 'camera', callback);
    expect(callback).toHaveBeenCalledWith(false); expect(state.permissionCheck.mock.calls[0][0]()).toBe(false);
  });
  it('does not write a blocked meeting link token into the diagnostic log', () => {
    const wc = contents(); const url = 'https://meeting.example/PRIVATE_PATH?pwd=PRIVATE_TOKEN#PRIVATE_FRAGMENT';
    wc.opening(url);
    const preventDefault = vi.fn(); wc.listeners.get('will-navigate')!({ preventDefault }, url);
    wc.listeners.get('will-frame-navigate')!({ preventDefault, url });
    expect(JSON.stringify(state.warn.mock.calls)).not.toContain('PRIVATE_');
  });
});
