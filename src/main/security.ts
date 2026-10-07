// Electron hardening shared by every window: who may talk to the main process, what a window may
// navigate to or open, and which permissions a page can get.
import { app, session, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { log } from './log';

const PAGE = resolve(join(__dirname, '../renderer/index.html'));

/** Normalised for comparison: Windows paths are case-insensitive and may differ in slashes. */
function canonical(p: string): string {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** The only documents allowed to call into the main process. */
export function isTrustedUrl(raw: string): boolean {
  const dev = !app.isPackaged ? process.env.VITE_DEV_URL : undefined;
  if (dev && raw.startsWith(dev)) return true;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'file:') return false;
    // Compare as file paths, not URL strings: Chromium and Node percent-encode and case paths differently.
    return canonical(fileURLToPath(u)) === canonical(PAGE);
  } catch {
    return false;
  }
}

/** True when the IPC message comes from our own renderer page (not a frame or foreign page). */
export function isTrustedSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame;
  if (!frame || frame !== e.sender.mainFrame) {
    log.warn(`ipc: rejected message from a sub-frame or disposed frame (${frame?.url ?? 'no frame'})`);
    return false;
  }
  if (!isTrustedUrl(frame.url)) {
    log.warn(`ipc: rejected message from ${frame.url}; expected ${PAGE}`);
    return false;
  }
  return true;
}

/** Windows never navigate away, never open child windows or webviews, and get no permissions. */
export function hardenWebContents(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    log.warn(`window.open blocked: ${url}`);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) {
      log.warn(`navigation blocked: ${url}`);
      e.preventDefault();
    }
  });
  contents.on('will-redirect', (e) => e.preventDefault());
  contents.on('will-attach-webview', (e) => e.preventDefault());

  // Whatever goes wrong inside a window ends up in the log instead of a silently blank page.
  contents.on('console-message', (ev) => {
    if (ev.level === 'error' || ev.level === 'warning') log.warn(`renderer: ${ev.message} (${ev.sourceId}:${ev.lineNumber})`);
  });
  contents.on('render-process-gone', (_e, details) => log.error(`renderer gone: ${details.reason} (exit ${details.exitCode})`));
  contents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) log.error(`page failed to load: ${code} ${desc} ${url}`);
  });
  contents.on('unresponsive', () => log.warn('renderer unresponsive'));
  contents.on('preload-error', (_e, path, err) => log.error(`preload error in ${path}: ${err.message}`));
}

export function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}
