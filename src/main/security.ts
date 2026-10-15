// Electron hardening shared by every window: who may talk to the main process, what a window may
// navigate to or open, and which permissions a page can get.
import {
    app,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
    session,
    type WebContents,
} from 'electron';

import { RENDERER_READY_MESSAGE } from '../shared/types';

import { log, originForLog } from './log';
import { isRendererPageUrl } from './rendererProtocol';

/** The only documents allowed to call into the main process. */
export function isTrustedUrl(raw: string): boolean {
    const dev = app.isPackaged ? undefined : process.env.VITE_DEV_URL;
    try {
        const u = new URL(raw);
        // Origins, not a text prefix: "http://localhost:5199@evil.example/" starts with the dev URL and is another site.
        if (dev && u.origin === new URL(dev).origin) return true;
        return isRendererPageUrl(raw);
    } catch {
        return false;
    }
}

/** True when the IPC message comes from our own renderer page (not a frame or foreign page). */
export function isTrustedSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const frame = e.senderFrame;
    if (!frame || frame !== e.sender.mainFrame) {
        log.warn(
            `ipc: rejected message from a sub-frame or disposed frame (${frame ? originForLog(frame.url) : 'no frame'})`,
        );
        return false;
    }
    if (!isTrustedUrl(frame.url)) {
        log.warn(
            `ipc: rejected message from ${originForLog(frame.url)}; expected the bundled renderer origin`,
        );
        return false;
    }
    return true;
}

/** Windows never navigate away, never open child windows or webviews, and get no permissions. */
export function hardenWebContents(contents: WebContents) {
    contents.setWindowOpenHandler(({ url }) => {
        log.warn(`window.open blocked: ${originForLog(url)}`);
        return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
        if (!isTrustedUrl(url)) {
            log.warn(`navigation blocked: ${originForLog(url)}`);
            e.preventDefault();
        }
    });
    contents.on('will-redirect', (e) => e.preventDefault());
    // Frames inside a page never navigate anywhere but our own page either.
    contents.on('will-frame-navigate', (e) => {
        if (!isTrustedUrl(e.url)) {
            log.warn(`frame navigation blocked: ${originForLog(e.url)}`);
            e.preventDefault();
        }
    });
    contents.on('will-attach-webview', (e) => e.preventDefault());

    // Whatever goes wrong inside a window ends up in the log instead of a silently blank page.
    contents.on('console-message', (ev) => {
        if (
            ev.level === 'info' &&
            ev.message === RENDERER_READY_MESSAGE &&
            isTrustedUrl(contents.getURL())
        ) {
            log.info('renderer ready');
            return;
        }
        if (ev.level === 'error' || ev.level === 'warning')
            log.warn(`renderer: ${ev.message} (${ev.sourceId}:${ev.lineNumber})`);
    });
    contents.on('render-process-gone', (_e, details) =>
        log.error(`renderer gone: ${details.reason} (exit ${details.exitCode})`),
    );
    contents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
        if (isMainFrame && code !== -3) log.error(`page failed to load: ${code} ${desc} ${url}`);
    });
    contents.on('unresponsive', () => log.warn('renderer unresponsive'));
    contents.on('preload-error', (_e, path, err) =>
        log.error(`preload error in ${path}: ${err.message}`),
    );
}

export function hardenSession() {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
}
