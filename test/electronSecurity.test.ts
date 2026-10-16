import { type IpcMainInvokeEvent, type WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as logModule from '../src/main/log';
import { afterRendererReady } from '../src/main/rendererReady';
import {
    hardenSession,
    hardenWebContents,
    isTrustedSender,
    isTrustedUrl,
} from '../src/main/security';

const state = vi.hoisted(() => ({
    packaged: true,
    warn: vi.fn(),
    info: vi.fn(),
    permissionRequest:
        vi.fn<
            (
                handler: (
                    contents: unknown,
                    permission: string,
                    callback: (allowed: boolean) => void,
                ) => void,
            ) => void
        >(),
    permissionCheck: vi.fn<(handler: () => boolean) => void>(),
}));
vi.mock('electron', () => ({
    app: {
        get isPackaged() {
            return state.packaged;
        },
    },
    session: {
        defaultSession: {
            setPermissionRequestHandler: state.permissionRequest,
            setPermissionCheckHandler: state.permissionCheck,
        },
    },
}));
vi.mock('../src/main/log', async () => {
    const real = await vi.importActual<typeof logModule>('../src/main/log');
    return { ...real, log: { warn: state.warn, info: state.info, error: vi.fn() } };
});

const page = 'owa-widget://app/index.html';
const oldDev = process.env.VITE_DEV_URL;
beforeEach(() => {
    state.packaged = true;
    vi.clearAllMocks();
    delete process.env.VITE_DEV_URL;
});
afterEach(() => {
    if (oldDev === undefined) delete process.env.VITE_DEV_URL;
    else process.env.VITE_DEV_URL = oldDev;
});
function contents(url = page) {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    let opening!: (details: { url: string }) => { action: string };
    const wc = {
        isDestroyed: () => false,
        getURL: () => url,
        setWindowOpenHandler: (fn: typeof opening) => {
            opening = fn;
        },
        on: (name: string, fn: (...args: unknown[]) => void) => {
            listeners.set(name, fn);
        },
        once: (name: string, fn: (...args: unknown[]) => void) => {
            listeners.set(name, fn);
        },
    };
    hardenWebContents(wc as unknown as WebContents);
    return {
        listeners,
        webContents: wc as unknown as WebContents,
        opening: (targetUrl: string) => opening({ url: targetUrl }),
    };
}
describe('Electron trust boundaries', () => {
    it('accepts only the shipped renderer origin in a packaged build', () => {
        expect(isTrustedUrl(`${page}#/calendar`)).toBe(true);
        expect(isTrustedUrl(`${page}?state=ok#/popup`)).toBe(false);
        process.env.VITE_DEV_URL = 'http://localhost:5199';
        for (const value of [
            'https://evil.example',
            'http://localhost:5199/',
            page.replace('index.html', 'other.html'),
            `${page}/extra`,
            'data:text/html,hello',
            // eslint-disable-next-line no-script-url -- The script URL is intentional rejected input for a security regression test.
            'javascript:alert(1)',
            'file:///etc/passwd',
        ])
            expect(isTrustedUrl(value)).toBe(false);
    });
    it('compares development origins rather than string prefixes', () => {
        state.packaged = false;
        process.env.VITE_DEV_URL = 'http://localhost:5199';
        expect(isTrustedUrl('http://localhost:5199/#/popup')).toBe(true);
        for (const value of [
            'http://localhost:5199@evil.example/',
            'http://localhost:51990/',
            'http://localhost.evil.example:5199/',
            'https://localhost:5199/',
        ])
            expect(isTrustedUrl(value)).toBe(false);
    });
    it('rejects a trusted URL in a subframe and a foreign URL in the main frame', () => {
        const main = { url: page };
        const event = (frame: typeof main | null) =>
            ({ senderFrame: frame, sender: { mainFrame: main } }) as unknown as IpcMainInvokeEvent;
        expect(isTrustedSender(event(main))).toBe(true);
        expect(isTrustedSender(event({ url: page }))).toBe(false);
        expect(isTrustedSender(event(null))).toBe(false);
        main.url = 'https://evil.example';
        expect(isTrustedSender(event(main))).toBe(false);
    });
    it('blocks popups, foreign navigation, redirects and webviews', () => {
        const wc = contents();
        expect(wc.opening('https://evil.example').action).toBe('deny');
        const preventDefault = vi.fn();
        wc.listeners.get('will-navigate')!({ preventDefault }, 'https://evil.example');
        wc.listeners.get('will-frame-navigate')!({ preventDefault, url: 'https://evil.example' });
        wc.listeners.get('will-redirect')!({ preventDefault });
        wc.listeners.get('will-attach-webview')!({ preventDefault });
        expect(preventDefault).toHaveBeenCalledTimes(4);
    });
    it('denies permissions instead of using Electron defaults', () => {
        hardenSession();
        const callback = vi.fn();
        state.permissionRequest.mock.calls[0][0]({}, 'camera', callback);
        expect(callback).toHaveBeenCalledWith(false);
        expect(state.permissionCheck.mock.calls[0][0]()).toBe(false);
    });
    it('does not write a blocked meeting link token into the diagnostic log', () => {
        const wc = contents();
        const url = 'https://meeting.example/PRIVATE_PATH?pwd=PRIVATE_TOKEN#PRIVATE_FRAGMENT';
        wc.opening(url);
        const preventDefault = vi.fn();
        wc.listeners.get('will-navigate')!({ preventDefault }, url);
        wc.listeners.get('will-frame-navigate')!({ preventDefault, url });
        expect(JSON.stringify(state.warn.mock.calls)).not.toContain('PRIVATE_');
    });
});

it('recognizes UI readiness only from a trusted page', () => {
    const event = { level: 'info', message: 'OWA_WIDGET_RENDERER_READY' };
    const trusted = contents();
    const dispatched = vi.fn();
    afterRendererReady(trusted.webContents, dispatched);
    trusted.listeners.get('console-message')!(event);
    expect(dispatched).toHaveBeenCalledOnce();
    expect(state.info).toHaveBeenCalledWith('renderer ready');
    state.info.mockClear();
    const foreign = contents('https://evil.example');
    const blocked = vi.fn();
    afterRendererReady(foreign.webContents, blocked);
    foreign.listeners.get('console-message')!(event);
    trusted.listeners.get('console-message')!({ ...event, level: 'warning' });
    expect(blocked).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalled();
});
