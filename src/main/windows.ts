// Popup at the tray, settings window, reminder toast window.
import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { PopupSize, ThemePref } from '../shared/types';

const POPUP_SIZES: Record<PopupSize, { width: number; height: number }> = {
  compact: { width: 360, height: 540 },
  regular: { width: 400, height: 660 },
  large: { width: 460, height: 780 },
};

function rendererUrl(route: string): { url?: string; file?: string; hash: string } {
  // The dev server URL is honoured only when running from source, never in an installed build.
  const dev = app.isPackaged ? undefined : process.env.VITE_DEV_URL;
  return dev ? { url: `${dev}/#/${route}`, hash: route } : { file: join(__dirname, '../renderer/index.html'), hash: `/${route}` };
}

function load(win: BrowserWindow, route: string) {
  const target = rendererUrl(route);
  if (target.url) void win.loadURL(target.url);
  else void win.loadFile(target.file!, { hash: target.hash });
}

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  navigateOnDragDrop: false,
  devTools: !app.isPackaged,
});

export function backgroundColor(theme: ThemePref) {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#202020' : '#f3f3f3';
}

export function createPopup(size: PopupSize, theme: ThemePref): BrowserWindow {
  const { width, height } = POPUP_SIZES[size];
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: backgroundColor(theme),
    roundedCorners: true,
    // The popup lives hidden and draws the tray icon: Chromium slows timers of a hidden page to once a
    // minute after a few minutes, which would make the countdown and the pulse start late.
    webPreferences: { ...webPreferences(), backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  load(win, 'popup');
  return win;
}

export function popupSize(size: PopupSize) {
  return POPUP_SIZES[size];
}

/**
 * Places the popup next to the tray icon on whichever edge the taskbar sits, clamped into the
 * work area. Falls back to the cursor position when the tray cannot report its bounds.
 */
export function positionPopup(win: BrowserWindow, trayBounds: Rectangle | undefined) {
  const [w, h] = win.getSize();
  const anchor = trayBounds && trayBounds.width > 0 ? trayBounds : { ...screen.getCursorScreenPoint(), width: 1, height: 1 };
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
  const wa = display.workArea;
  const b = display.bounds;
  const gap = 12;

  let x: number;
  let y: number;
  if (wa.y > b.y) {
    // taskbar on top
    x = anchor.x + anchor.width / 2 - w / 2;
    y = wa.y + gap;
  } else if (wa.x > b.x) {
    // taskbar on the left
    x = wa.x + gap;
    y = anchor.y + anchor.height / 2 - h / 2;
  } else if (wa.width < b.width) {
    // taskbar on the right
    x = wa.x + wa.width - w - gap;
    y = anchor.y + anchor.height / 2 - h / 2;
  } else {
    // taskbar at the bottom (default)
    x = anchor.x + anchor.width / 2 - w / 2;
    y = wa.y + wa.height - h - gap;
  }
  x = Math.round(Math.min(Math.max(x, wa.x + gap), wa.x + wa.width - w - gap));
  y = Math.round(Math.min(Math.max(y, wa.y + gap), wa.y + wa.height - h - gap));
  win.setPosition(x, y, false);
}

export function createSettings(theme: ThemePref): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 720,
    minWidth: 520,
    minHeight: 560,
    show: false,
    title: 'OWA Widget — настройки',
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(theme),
    webPreferences: webPreferences(),
  });
  win.setMenu(null);
  load(win, 'settings');
  win.once('ready-to-show', () => win.show());
  return win;
}

/** The "Create meeting" window: a normal window like the settings, with the same hardening. */
export function createMeetingWindow(theme: ThemePref): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 780,
    minWidth: 500,
    minHeight: 620,
    show: false,
    title: 'OWA Widget — создать встречу',
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(theme),
    webPreferences: webPreferences(),
  });
  win.setMenu(null);
  load(win, 'create');
  win.once('ready-to-show', () => win.show());
  return win;
}

/** The free time search: a resizable window with the week grid; same hardening as the settings window. */
export function createAvailability(theme: ThemePref): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'OWA Widget — поиск свободного времени',
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(theme),
    webPreferences: webPreferences(),
  });
  win.setMenu(null);
  load(win, 'availability');
  win.once('ready-to-show', () => win.show());
  return win;
}

/** Meeting statistics: a resizable window with the day chart and the breakdowns; same hardening as the settings. */
export function createStats(theme: ThemePref): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 680,
    minHeight: 520,
    show: false,
    title: 'OWA Widget — статистика встреч',
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(theme),
    webPreferences: webPreferences(),
  });
  win.setMenu(null);
  load(win, 'stats');
  win.once('ready-to-show', () => win.show());
  return win;
}

/** The short tour on the first run: one fixed-size window, centred, with no menu. */
export function createWelcome(theme: ThemePref): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 560,
    resizable: false,
    show: false,
    title: 'OWA Widget',
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(theme),
    webPreferences: webPreferences(),
  });
  win.setMenu(null);
  load(win, 'welcome');
  win.once('ready-to-show', () => win.show());
  return win;
}

export function createReminder(theme: ThemePref): BrowserWindow {
  const width = 380;
  const height = 200;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const win = new BrowserWindow({
    width,
    height,
    x: wa.x + wa.width - width - 16,
    y: wa.y + wa.height - height - 16,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    focusable: true,
    backgroundColor: backgroundColor(theme),
    roundedCorners: true,
    webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  load(win, 'reminder');
  return win;
}

/** Reminder content decides its height; keep the bottom edge anchored above the taskbar. */
export function fitReminder(win: BrowserWindow, height: number) {
  const [x] = win.getPosition();
  const [w] = win.getSize();
  const display = screen.getDisplayNearestPoint({ x, y: win.getPosition()[1] });
  const wa = display.workArea;
  const h = Math.min(Math.max(120, Math.ceil(height)), 480);
  win.setBounds({ x, y: wa.y + wa.height - h - 16, width: w, height: h });
}
