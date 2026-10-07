// Electron main process: tray, windows, IPC, global hotkey.
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  shell,
  Tray,
} from 'electron';
import { execFile } from 'node:child_process';
import { IPC, type ReminderPayload, type SettingsUpdate, type Snapshot, type TrayStatus, type CalendarEvent } from '../shared/types';
import { joinCandidates, joinUrlForActions, displayTitle } from '../shared/events';
import { safeUrl } from '../shared/meetingUrl';
import { CalendarService } from './calendarService';
import { ReminderScheduler } from './reminders';
import { createPopup, createReminder, createSettings, fitReminder, popupSize, positionPopup } from './windows';

const DEMO = process.env.OWA_DEMO === '1' || process.argv.includes('--demo');
const JOIN_HOTKEY = 'Control+Alt+J';

app.setAppUserModelId('com.dmitrbrvsk.owawidget');
if (!app.requestSingleInstanceLock()) app.exit(0);

let tray: Tray | undefined;
let popup: BrowserWindow | undefined;
let settingsWin: BrowserWindow | undefined;
let reminderWin: BrowserWindow | undefined;
let pendingReminder: ReminderPayload | null = null;
let lastPopupHide = 0;
let service: CalendarService;
let reminders: ReminderScheduler;

/** 16×16 calendar outline, used until the renderer draws the live icon. */
function placeholderIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const px = (x: number, y: number) => {
    const i = (y * size + x) * 4;
    buf[i] = buf[i + 1] = buf[i + 2] = 0xff;
    buf[i + 3] = 0xff;
  };
  for (let x = 4; x < 28; x++) for (let t = 0; t < 2; t++) (px(x, 6 + t), px(x, 26 + t), px(x, 11 + t));
  for (let y = 6; y < 28; y++) for (let t = 0; t < 2; t++) (px(4 + t, y), px(26 + t, y));
  for (let y = 3; y < 8; y++) (px(10, y), px(11, y), px(20, y), px(21, y));
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

let taskbarLight = false;

/** Windows 10/11 keep the taskbar theme separately from the app theme. */
function readTaskbarTheme() {
  if (process.platform !== 'win32') return;
  execFile(
    'reg',
    ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'],
    { windowsHide: true, timeout: 3000 },
    (err, stdout) => {
      const light = !err && /SystemUsesLightTheme\s+REG_DWORD\s+0x1/i.test(stdout);
      if (light !== taskbarLight) {
        taskbarLight = light;
        broadcast();
      }
    },
  );
}

function snapshot(): Snapshot {
  return { events: service.events, sync: service.sync, settings: service.settings, demo: DEMO, version: app.getVersion(), taskbarLight };
}

function broadcast() {
  const s = snapshot();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.snapshot, s);
  updateTrayMenu();
}

// ---------- Popup ----------

function ensurePopup(): BrowserWindow {
  if (popup && !popup.isDestroyed()) return popup;
  popup = createPopup(service.settings.popupSize, service.settings.theme);
  popup.on('blur', () => {
    if (!popup?.webContents.isDevToolsOpened()) hidePopup();
  });
  popup.on('closed', () => (popup = undefined));
  return popup;
}

function hidePopup() {
  if (popup?.isVisible()) {
    popup.hide();
    lastPopupHide = Date.now();
  }
}

function showPopup() {
  const win = ensurePopup();
  positionPopup(win, tray?.getBounds());
  win.show();
  win.focus();
  win.webContents.send(IPC.popupShown);
  void service.syncNow('popup');
}

function togglePopup() {
  // A click on the tray first blurs (and hides) the popup; don't reopen it right away.
  if (Date.now() - lastPopupHide < 250) return;
  if (popup?.isVisible()) hidePopup();
  else showPopup();
}

// ---------- Settings ----------

function openSettings() {
  hidePopup();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = createSettings(service.settings.theme);
  settingsWin.on('closed', () => (settingsWin = undefined));
}

// ---------- Reminder ----------

function showReminder(events: CalendarEvent[]) {
  pendingReminder = { events };
  if (!reminderWin || reminderWin.isDestroyed()) {
    reminderWin = createReminder(service.settings.theme);
    reminderWin.on('closed', () => {
      reminderWin = undefined;
      pendingReminder = null;
    });
    reminderWin.once('ready-to-show', () => reminderWin?.showInactive());
  } else {
    reminderWin.webContents.send(IPC.reminder, pendingReminder);
    reminderWin.showInactive();
  }
}

// ---------- Join ----------

async function openExternal(url: string) {
  const safe = safeUrl(url);
  if (safe) await shell.openExternal(safe);
}

function joinFromHotkey() {
  const candidates = joinCandidates(service.events, new Date());
  if (candidates.length === 1) {
    void openExternal(joinUrlForActions(candidates[0])!);
    return;
  }
  if (candidates.length > 1) {
    showPopup(); // several at once: the banner in the popup lets the user pick
    return;
  }
  if (Notification.isSupported()) {
    new Notification({ title: 'OWA Widget', body: 'Сейчас нет встречи со ссылкой для подключения', silent: true }).show();
  }
}

function applyHotkey() {
  globalShortcut.unregister(JOIN_HOTKEY);
  if (service.settings.joinHotkeyEnabled) globalShortcut.register(JOIN_HOTKEY, joinFromHotkey);
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: service.settings.launchAtLogin, args: ['--hidden'] });
}

// ---------- Tray ----------

function updateTrayMenu() {
  if (!tray) return;
  const join = joinCandidates(service.events, new Date());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть', click: showPopup },
      ...join.map((e) => ({ label: `Подключиться: ${displayTitle(e).slice(0, 40)}`, click: () => void openExternal(joinUrlForActions(e)!) })),
      { label: 'Обновить', click: () => void service.syncNow('manual') },
      { type: 'separator' as const },
      { label: 'Настройки…', click: openSettings },
      { label: 'Выход', role: 'quit' as const },
    ]),
  );
}

function setTrayStatus(status: TrayStatus) {
  if (!tray) return;
  const img = nativeImage.createFromDataURL(status.iconDataUrl);
  if (!img.isEmpty()) tray.setImage(img);
  tray.setToolTip(status.tooltip.slice(0, 127));
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle(IPC.getSnapshot, () => snapshot());
  ipcMain.handle(IPC.syncNow, () => service.syncNow('manual'));
  ipcMain.handle(IPC.getDetails, (_e, id: string) => service.details(id));
  ipcMain.handle(IPC.respond, (_e, id: string, action) => service.respond(id, action));
  ipcMain.handle(IPC.openUrl, async (_e, url: string) => {
    await openExternal(url);
    hidePopup();
  });
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(String(text)));
  ipcMain.handle(IPC.saveSettings, (_e, update: SettingsUpdate) => service.applySettings(update));
  ipcMain.handle(IPC.testConnection, (_e, update: SettingsUpdate) => service.testConnection(update));
  ipcMain.handle(IPC.trustCertificate, (_e, fp: string) => service.trustCertificate(fp));
  ipcMain.handle(IPC.openSettings, () => openSettings());
  ipcMain.handle(IPC.closeWindow, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === popup) hidePopup();
    else win?.close();
  });
  ipcMain.handle(IPC.quit, () => app.quit());
  ipcMain.on(IPC.setTrayStatus, (_e, status: TrayStatus) => setTrayStatus(status));
  ipcMain.handle(IPC.getReminder, () => pendingReminder);
  ipcMain.handle(IPC.snoozeReminder, (_e, minutes: number) => {
    if (pendingReminder) reminders.snooze(pendingReminder.events, minutes);
    reminderWin?.close();
  });
  ipcMain.on(IPC.resizePopup, (e, height: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && win === reminderWin) fitReminder(win, height);
  });
}

// ---------- Lifecycle ----------

app.on('second-instance', () => showPopup());
app.on('window-all-closed', () => {
  /* keep running in the tray */
});
app.on('will-quit', () => globalShortcut.unregisterAll());

void app.whenReady().then(() => {
  service = new CalendarService(DEMO);
  nativeTheme.themeSource = service.settings.theme;

  registerIpc();

  tray = new Tray(placeholderIcon());
  tray.setToolTip('OWA Widget');
  tray.on('click', togglePopup);
  updateTrayMenu();

  // The popup lives hidden from the start: it also draws the live tray icon.
  ensurePopup();

  service.on('changed', broadcast);
  readTaskbarTheme();
  nativeTheme.on('updated', readTaskbarTheme);
  service.on('settings', (prev, next) => {
    nativeTheme.themeSource = next.theme;
    if (prev.popupSize !== next.popupSize && popup) {
      const { width, height } = popupSize(next.popupSize);
      popup.setSize(width, height);
    }
    applyHotkey();
    applyLoginItem();
  });
  service.start();

  reminders = new ReminderScheduler(
    () => service.events,
    () => service.settings.reminderMinutes,
    showReminder,
  );
  reminders.start();

  applyHotkey();
  applyLoginItem();

  powerMonitor.on('resume', () => setTimeout(() => void service.syncNow('auto'), 5000));
  powerMonitor.on('unlock-screen', () => void service.syncNow('auto'));

  if (!service.settings.account.serverUrl && !DEMO) openSettings();
  else if (!process.argv.includes('--hidden') && !app.isPackaged) showPopup();
});
