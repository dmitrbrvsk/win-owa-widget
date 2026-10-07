// Electron main process: tray, windows, IPC, global hotkey.
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
  Tray,
} from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC, type ReminderPayload, type SettingsUpdate, type Snapshot, type TrayStatus, type CalendarEvent } from '../shared/types';
import { joinCandidates, joinUrlForActions, displayTitle, isEngaged } from '../shared/events';
import { safeUrl, urlHost } from '../shared/meetingUrl';
import { describeChanges, type EventChange } from '../shared/changes';
import { doneText, noteToast, reminderToast } from '../shared/toasts';
import { oneLine } from '../shared/text';
import { parseClipboardText, parseHeight, parseId, parseMinutes, parseRsvpAction, parseTrayStatus, parseUrlArg, isFingerprint } from '../shared/validate';
import { hardenSession, hardenWebContents, isTrustedSender } from './security';
import { describeError, log, logPath } from './log';
import { CalendarService } from './calendarService';
import { ReminderScheduler } from './reminders';
import { createPopup, createReminder, createSettings, fitReminder, popupSize, positionPopup } from './windows';
import { isFirstRun } from './store';
import { showToast, toastsSupported } from './toasts';

// Demo data and the screenshot hook are developer tools: an installed build ignores them.
const DEMO = !app.isPackaged && (process.env.OWA_DEMO === '1' || process.argv.includes('--demo'));
const JOIN_HOTKEY = 'Control+Alt+J';

app.setAppUserModelId('com.dmitrbrvsk.owawidget');

// A tray widget has nothing for a GPU to do: software rendering inside the browser process drops
// a whole Chromium process (and its memory) and sidesteps driver glitches on corporate laptops.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');

const VERSION = app.getVersion();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const instanceFile = () => join(app.getPath('userData'), 'instance.json');

/** The running instance leaves its version here, so a second launch knows whether to wait for a handover. */
function runningVersion(): string | undefined {
  try {
    return (JSON.parse(readFileSync(instanceFile(), 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/**
 * One instance at a time. The same build launched again just brings the running popup forward and
 * exits. A different build asks the running one to quit and waits for the lock (builds before 0.1.6
 * do not answer, so the wait ends in a dialog that says where to close them).
 */
async function acquireSingleInstance(): Promise<'ok' | 'same' | 'busy'> {
  const sameBuild = runningVersion() === VERSION;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (app.requestSingleInstanceLock({ version: VERSION, attempt })) {
      try {
        mkdirSync(app.getPath('userData'), { recursive: true });
        writeFileSync(instanceFile(), JSON.stringify({ version: VERSION, pid: process.pid }));
      } catch (e) {
        log.warn(`instance marker not written: ${describeError(e)}`);
      }
      return 'ok';
    }
    if (sameBuild) return 'same';
    await sleep(250);
  }
  return 'busy';
}

process.on('uncaughtException', (e) => log.error(`uncaught: ${describeError(e)}\n${e.stack ?? ''}`));
process.on('unhandledRejection', (e) => log.error(`unhandled rejection: ${describeError(e)}`));

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
  // Full path: a program named reg.exe earlier in PATH must not be able to stand in.
  const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  execFile(
    reg,
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
  return { events: service.events, sync: service.sync, settings: service.settings, demo: DEMO, version: app.getVersion(), taskbarLight, logPath: logPath() };
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

/**
 * Whether the reminder is a Windows notification with buttons. "Automatic" uses it only for an
 * installed copy: that one has a Start-menu shortcut, which Windows needs to deliver notifications
 * of this app. The portable zip has none, so it keeps the widget's own window, which always shows.
 */
function reminderAsToast(): boolean {
  const style = service.settings.reminderStyle;
  if (style === 'window' || !toastsSupported()) return false;
  if (style === 'system') return true;
  return process.platform === 'win32' && existsSync(join(dirname(process.execPath), 'Uninstall OWA Widget.exe'));
}

function showReminderWindow(events: CalendarEvent[]) {
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

function showReminder(events: CalendarEvent[]) {
  if (reminderAsToast()) {
    const shown = showToast(
      reminderToast(events, new Date(), uiLang()),
      {
        onAction: (id, minutes) => {
          if (id === 'join') {
            // The link as the meeting has it now; the one from when the toast appeared if it is gone.
            const current = service.events.find((e) => e.id === events[0].id) ?? events[0];
            const url = joinUrlForActions(current);
            if (url) void openExternal(url);
          } else if (id === 'snooze') reminders.snooze(events, minutes);
          else if (id === 'open') showPopup();
        },
        onClick: () => openMeeting(events.length === 1 ? events[0].id : undefined),
        // Windows refused the notification: the person must not miss the meeting because of it.
        onFailed: () => showReminderWindow(events),
      },
      { sticky: true, group: 'reminder' },
    );
    if (shown) return;
  }
  showReminderWindow(events);
}

/** Brings the widget forward, on one meeting when it is known. */
function openMeeting(eventId?: string) {
  showPopup();
  if (eventId) popup?.webContents.send(IPC.openEvent, eventId);
}

// ---------- Join ----------

async function openExternal(url: string) {
  const safe = safeUrl(url);
  if (safe) await shell.openExternal(safe);
}

function joinFromHotkey() {
  const candidates = joinCandidates(service.events, new Date());
  const only = candidates.length === 1 ? candidates[0] : undefined;
  // A link to an unknown host, or from an invitation nobody answered, is never opened blindly from a
  // hotkey: the popup shows it first.
  if (only && only.platform !== 'generic' && isEngaged(only) && joinUrlForActions(only)?.startsWith('https://')) {
    void openExternal(joinUrlForActions(only)!);
    return;
  }
  if (candidates.length > 0) {
    showPopup(); // several at once, or an unfamiliar link: the popup lets the user look and pick
    return;
  }
  showToast({ title: 'OWA Widget', body: uiLang() === 'en' ? 'No meeting with a join link right now' : 'Сейчас нет встречи со ссылкой для подключения', buttons: [] }, {}, { silent: true });
}

function applyHotkey() {
  globalShortcut.unregister(JOIN_HOTKEY);
  if (service.settings.joinHotkeyEnabled) globalShortcut.register(JOIN_HOTKEY, joinFromHotkey);
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: service.settings.launchAtLogin, args: ['--hidden'] });
}

// ---------- Change notifications ----------

const toldChanges = new Set<string>();
let noteTimes: number[] = [];
/** Whatever a server sends, the person gets at most this many notifications an hour. */
const NOTES_PER_HOUR = 6;

function uiLang(): 'ru' | 'en' {
  const pref = service.settings.language;
  if (pref === 'ru' || pref === 'en') return pref;
  return app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** Accept pressed on an invitation's notification: answers the server, then says how it went. */
async function acceptFromToast(eventId: string) {
  const text = doneText(uiLang());
  try {
    await service.respond(eventId, 'accept');
    showToast({ title: text.accepted, body: '', buttons: [] }, {}, { silent: true });
  } catch (e) {
    log.warn(`accept from notification failed: ${describeError(e)}`);
    showToast({ title: text.failed, body: oneLine(describeError(e), 160), buttons: [] }, { onClick: () => openMeeting(eventId) });
  }
}

function notifyChanges(changes: EventChange[]) {
  if (!service.settings.notifyChanges || !toastsSupported()) return;
  if (toldChanges.size > 1000) toldChanges.clear();
  // A change is told once per run, even if the server flips a meeting back and forth.
  const fresh = changes.filter((c) => {
    const key = `${c.kind}|${c.event.id}|${c.event.start}|${c.event.end}`;
    if (toldChanges.has(key)) return false;
    toldChanges.add(key);
    return true;
  });
  if (fresh.length) log.info(`changes: ${fresh.length} new (${fresh.filter((c) => c.kind === 'moved').length} moved, ${fresh.filter((c) => c.kind === 'cancelled').length} cancelled, ${fresh.filter((c) => c.kind === 'invited').length} invited)`);
  const now = Date.now();
  noteTimes = noteTimes.filter((t) => now - t < 3_600_000);
  for (const note of describeChanges(fresh, new Date(), uiLang())) {
    if (noteTimes.length >= NOTES_PER_HOUR) break;
    noteTimes.push(now);
    const eventId = note.eventId;
    showToast(
      noteToast(note, uiLang()),
      {
        onClick: () => openMeeting(eventId),
        onAction: (id) => {
          if (id === 'accept' && eventId) void acceptFromToast(eventId);
        },
      },
      // A change is news, not an alarm: it can go quietly to the notification centre after a while.
      {},
    );
  }
}

// ---------- Tray ----------

function updateTrayMenu() {
  if (!tray) return;
  const join = joinCandidates(service.events, new Date());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть', click: showPopup },
      // A link to an unfamiliar site shows where it goes, as the buttons in the windows do.
      ...join.map((e) => ({ label: `Подключиться${e.platform === 'generic' ? ` (${urlHost(joinUrlForActions(e)) ?? '?'})` : ''}: ${displayTitle(e).slice(0, 40)}`, click: () => void openExternal(joinUrlForActions(e)!) })),
      { label: 'Обновить', click: () => void service.syncNow('manual') },
      { type: 'separator' as const },
      { label: 'Настройки…', click: openSettings },
      { label: 'Выход', role: 'quit' as const },
    ]),
  );
}

let lastTooltip = '';

function setTrayStatus(status: TrayStatus) {
  if (!tray) return;
  lastTooltip = status.tooltip;
  const img = nativeImage.createFromDataURL(status.iconDataUrl);
  if (!img.isEmpty()) tray.setImage(img);
  tray.setToolTip(status.tooltip.slice(0, 127));
}

// ---------- IPC ----------

/** `ipcMain.handle` that answers only our own renderer page. */
function handle<A extends unknown[]>(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: A) => unknown) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error('Недопустимый отправитель');
    return fn(e, ...(args as A));
  });
}

function listen(channel: string, fn: (e: Electron.IpcMainEvent, ...args: unknown[]) => void) {
  ipcMain.on(channel, (e, ...args) => {
    if (isTrustedSender(e)) fn(e, ...args);
  });
}

/** One native confirmation at a time: a page that keeps asking cannot stack dialogs on the person. */
let modalOpen = false;

async function askNative(options: Electron.MessageBoxOptions, parent?: BrowserWindow): Promise<number> {
  if (modalOpen) throw new Error('Уже открыто окно подтверждения — ответьте на него');
  modalOpen = true;
  try {
    const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return response;
  } finally {
    modalOpen = false;
  }
}

/**
 * Pointing the app at another server sends it the password and the Windows identity, so a change of
 * server is confirmed in a native dialog the page cannot click. Returns false when the person declines.
 */
async function confirmServerChange(host: string, parent?: BrowserWindow): Promise<boolean> {
  const answer = await askNative(
    {
      type: 'warning',
      title: 'OWA Widget',
      message: `Подключиться к серверу ${host}?`,
      detail:
        'Приложение будет отправлять на этот сервер ваш логин и пароль (а если логин не указан — данные вашей учётной записи Windows) и читать с него календарь.\n\n' +
        'Пароль, сохранённый для прежнего сервера, на новый не передаётся: его придётся ввести заново.\n\n' +
        'Если вы не меняли адрес сервера сами, нажмите «Отмена».',
      buttons: ['Отмена', 'Подключиться'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    },
    parent,
  );
  return answer === 1;
}

/** Trusting a certificate is a decision for the person, so it is asked in a native dialog the page cannot fake or click. */
async function confirmTrustCertificate(parent?: BrowserWindow): Promise<boolean> {
  const pending = service.pendingCertificate();
  if (!pending) return false;
  const until = new Date(pending.validTo).toLocaleDateString('ru-RU');
  const response = await askNative({
    type: 'warning',
    title: 'OWA Widget',
    message: `Сертификат сервера ${pending.host} не прошёл проверку Windows`,
    detail:
      `Сертификат ${pending.reason}.\n\n` +
      `Выдан: ${pending.issuer}\nДля: ${pending.subject}\nДействует до: ${until}\nОтпечаток: ${pending.fingerprint}\n\n` +
      'Если это внутренний сертификат компании, правильнее установить корневой сертификат компании в Windows — тогда ему будут доверять и браузер, и это приложение. ' +
      'Если всё же довериться здесь, приложение будет отправлять на этот сервер ваш пароль и читать календарь, пока сертификат совпадает с отпечатком выше.\n\n' +
      'Сверьте отпечаток с тем, что показывает ваш ИТ-отдел. Если не уверены — нажмите «Отмена»: так можно отдать пароль подставному серверу.',
    buttons: ['Отмена', 'Довериться этому сертификату'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }, parent);
  return response === 1;
}

function registerIpc() {
  handle(IPC.getSnapshot, () => snapshot());
  handle(IPC.syncNow, () => service.syncNow('manual'));
  handle(IPC.getDetails, (_e, id) => service.details(parseId(id)));
  handle(IPC.respond, (_e, id, action) => service.respond(parseId(id), parseRsvpAction(action)));
  handle(IPC.openUrl, async (_e, url) => {
    const arg = parseUrlArg(url);
    if (arg) await openExternal(arg);
    hidePopup();
  });
  handle(IPC.copyText, (_e, text) => clipboard.writeText(parseClipboardText(text)));
  handle(IPC.saveSettings, async (e, update) => {
    const next = service.serverChangeOf(update);
    if (next && !(await confirmServerChange(next, BrowserWindow.fromWebContents(e.sender) ?? undefined))) {
      throw new Error('Смена сервера отменена: адрес не изменён');
    }
    return service.applySettings(update as SettingsUpdate);
  });
  handle(IPC.testConnection, async (e, update) => {
    const next = service.serverChangeOf(update);
    if (next && !(await confirmServerChange(next, BrowserWindow.fromWebContents(e.sender) ?? undefined))) {
      return { ok: false, message: 'Проверка отменена: подключение к новому серверу не подтверждено' };
    }
    return service.testConnection(update as SettingsUpdate);
  });
  handle(IPC.trustCertificate, async (e, fp) => {
    if (!isFingerprint(fp)) throw new Error('Недопустимый отпечаток');
    if (!(await confirmTrustCertificate(BrowserWindow.fromWebContents(e.sender) ?? undefined))) return;
    await service.trustCertificate(fp);
  });
  handle(IPC.forgetCertificate, () => service.forgetCertificate());
  handle(IPC.clearCache, () => service.clearCache());
  handle(IPC.openLog, () => shell.showItemInFolder(logPath()));
  handle(IPC.openSettings, () => openSettings());
  handle(IPC.closeWindow, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === popup) hidePopup();
    else win?.close();
  });
  handle(IPC.quit, () => app.quit());
  listen(IPC.setTrayStatus, (_e, status) => {
    const ok = parseTrayStatus(status);
    if (ok) setTrayStatus(ok);
  });
  handle(IPC.getReminder, () => pendingReminder);
  handle(IPC.snoozeReminder, (_e, minutes) => {
    if (pendingReminder) reminders.snooze(pendingReminder.events, parseMinutes(minutes));
    reminderWin?.close();
  });
  listen(IPC.resizePopup, (e, height) => {
    const h = parseHeight(height);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (h !== null && win && win === reminderWin) fitReminder(win, h);
  });
}

// ---------- Lifecycle ----------

app.on('second-instance', (_e, _argv, _cwd, data) => {
  // Whatever a second launch sends is only a hint: read as plain values, never trusted for more.
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const other = { version: typeof d.version === 'string' ? d.version.slice(0, 32) : undefined, attempt: typeof d.attempt === 'number' ? d.attempt : 0 };
  if (other.version && other.version !== VERSION) {
    // A different build wants to take over: let it, instead of making the person hunt for the tray icon.
    log.info(`another build (${other.version}) is starting; this instance (${VERSION}) quits`);
    app.quit();
    return;
  }
  if (!other.attempt) showPopup();
});
app.on('window-all-closed', () => {
  /* keep running in the tray */
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  rmSync(instanceFile(), { force: true });
});

app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));

void app.whenReady().then(async () => {
  const lock = await acquireSingleInstance();
  if (lock === 'same') {
    app.exit(0); // the running copy has shown its popup
    return;
  }
  if (lock === 'busy') {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'OWA Widget',
      message: 'OWA Widget уже запущен',
      detail:
        'Работающая копия не ответила на просьбу завершиться (так бывает с версиями до 0.1.6). ' +
        'Закройте её: иконка в области уведомлений (возможно, под стрелкой «^») → правая кнопка → «Выход», ' +
        'или завершите «OWA Widget.exe» в диспетчере задач. Затем запустите приложение снова.',
      buttons: ['Понятно'],
      noLink: true,
    });
    app.exit(0);
    return;
  }
  log.info(`start: OWA Widget ${VERSION}, electron ${process.versions.electron}, ${process.platform} ${process.arch}, packaged=${app.isPackaged}${DEMO ? ', demo' : ''}`);
  Menu.setApplicationMenu(null); // no default menu: no Reload/DevTools accelerators in any window
  hardenSession();
  const firstRun = isFirstRun();
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
  service.on('changes', notifyChanges);
  service.on('cacheCleared', () => toldChanges.clear());
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

  // Smoke test for CI / local checks: render the popup through the real preload bridge, save a PNG, exit.
  if (!app.isPackaged && process.env.OWA_SMOKE_SHOT) {
    const out = process.env.OWA_SMOKE_SHOT;
    setTimeout(async () => {
      try {
        showPopup();
        await new Promise((r) => setTimeout(r, 2500));
        writeFileSync(out, (await popup!.webContents.capturePage()).toPNG());
        const popupOk = await popup!.webContents.executeJavaScript('!!document.querySelector(".popup")');
        openSettings();
        await new Promise((r) => setTimeout(r, 2500));
        writeFileSync(out.replace(/\.png$/i, '') + '-settings.png', (await settingsWin!.webContents.capturePage()).toPNG());
        const settingsOk = await settingsWin!.webContents.executeJavaScript('!!document.querySelector(".settings")');
        const metrics = app.getAppMetrics().map((m) => `${m.type}${m.name ? `(${m.name})` : ''}=${Math.round(m.memory.workingSetSize / 1024)}MB`);
        const total = Math.round(app.getAppMetrics().reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024);
        console.log(`SMOKE memory total=${total}MB ${metrics.join(' ')}`);
        console.log(`SMOKE ${popupOk && settingsOk ? 'ok' : 'FAIL'} popup=${popupOk} settings=${settingsOk} tray-tooltip="${lastTooltip.replace(/\n/g, ' | ')}" events=${service.events.length}`);
        app.exit(popupOk && settingsOk ? 0 : 1);
      } catch (e) {
        console.log(`SMOKE FAIL ${describeError(e)}`);
        app.exit(1);
      }
    }, 1500);
    return;
  }

  // First launch: show the prefilled server address so the person can confirm or change it, and say
  // where the app lives, because Windows 11 hides new tray icons behind the "^" overflow button.
  if ((firstRun || !service.settings.account.serverUrl) && !DEMO) openSettings();
  if (firstRun && process.platform === 'win32') {
    tray.displayBalloon({
      iconType: 'info',
      title: 'OWA Widget работает',
      content: 'Приложение живёт в области уведомлений (иконка может быть под стрелкой «^»). Закрытие окна его не завершает: «Выход» — в меню иконки или в настройках.',
    });
  }
  else if (!process.argv.includes('--hidden') && !app.isPackaged) showPopup();
});
