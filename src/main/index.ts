// Electron main process: tray, windows, IPC.
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC, type CalendarEvent, type CreateMeetingInput, type CreateMeetingResult, type EditMeetingInput, type MeetingBefore, type CreateMeetingPrefill, type ReminderPayload, type SettingsUpdate, type Snapshot } from '../shared/types';
import { joinCandidates, joinUrlForActions, displayTitle } from '../shared/events';
import { linksInText, safeUrl, urlHost } from '../shared/meetingUrl';
import { describeChanges, type EventChange } from '../shared/changes';
import { doneText, noteToast, reminderToast } from '../shared/toasts';
import { oneLine } from '../shared/text';
import { meetingMenuItems } from '../shared/meetingMenu';
import { parseEditMeeting, parseAvailabilityRequest, parseClipboardText, parseCreatePrefill, parseHeight, parseId, parseMinutes, parsePeopleQuery, parseRsvpAction, parseStatsRequest, parseUrlArg, isFingerprint } from '../shared/validate';
import { meetingCancelText, meetingChangeText, meetingConfirmText } from '../shared/meetingConfirm';
import { hardenSession, hardenWebContents, isTrustedSender } from './security';
import { describeError, log, logPath } from './log';
import { CalendarService } from './calendarService';
import { ReminderScheduler } from './reminders';
import { TrayPulse } from './trayPulse';
import { drawTrayBitmap, TRAY_ICON_SIZE } from './trayRaster';
import { trayPresentation } from '../shared/status';
import { tooltipFor } from '../shared/trayTooltip';
import { dict, type Lang } from '../shared/i18n';
import { createAvailability, createMeetingWindow, createPopup, createReminder, createSettings, createStats, createWelcome, fitReminder, popupSize, positionPopup } from './windows';
import { MeetingGate, SlidingWindow } from './meetingGate';
import { changedFields } from './owa/ewsMeeting';
import { OwaError } from './owa/errors';
import { isFirstRun } from './store';
import { showToast, toastsSupported } from './toasts';

// Demo data and the screenshot hook are developer tools: an installed build ignores them.
const DEMO = !app.isPackaged && (process.env.OWA_DEMO === '1' || process.argv.includes('--demo'));

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
let createWin: BrowserWindow | undefined;
/** What the "Create meeting" window was last asked to start with; it asks for it when it opens. */
let pendingPrefill: CreateMeetingPrefill | null = null;
let availabilityWin: BrowserWindow | undefined;
let statsWin: BrowserWindow | undefined;
let welcomeWin: BrowserWindow | undefined;
let reminderWin: BrowserWindow | undefined;
let pendingReminder: ReminderPayload | null = null;
let lastPopupHide = 0;
/** When the native "Copy…" menu of a meeting was opened (0: none). The menu takes the focus from the popup, which would hide it. */
let meetingMenuOpenedAt = 0;
/** A menu that never reports closing must not keep the popup from ever hiding again. */
const MENU_GUARD_MS = 120_000;
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
        refreshTray();
      }
    },
  );
}

// ---------- Links the app may open ----------

/**
 * Only a link the main process itself handed to a window is ever opened in the browser: the join
 * link of a meeting and the links inside the location and the description it served. A window that
 * has been taken over therefore cannot use `owa:openUrl` as a way out for what it has read — the
 * browser would otherwise carry the calendar, the server address and the user name to any site.
 */
const openableLinks = new Set<string>();
const MAX_OPENABLE_LINKS = 5000;
let linkedEvents: CalendarEvent[] | undefined;

function allowLink(url: string | undefined | null) {
  const safe = safeUrl(url ?? undefined);
  if (!safe) return;
  if (openableLinks.size >= MAX_OPENABLE_LINKS) openableLinks.clear();
  openableLinks.add(safe);
}

/** The links of the meetings as the windows see them now; recomputed only when the list changes. */
function refreshOpenableLinks() {
  if (service.events === linkedEvents) return;
  linkedEvents = service.events;
  for (const e of service.events) {
    allowLink(e.joinUrl);
    if (e.location) for (const u of linksInText(e.location)) allowLink(u);
  }
}

function snapshot(): Snapshot {
  refreshOpenableLinks();
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
    if (popup?.webContents.isDevToolsOpened()) return;
    if (meetingMenuOpenedAt && Date.now() - meetingMenuOpenedAt < MENU_GUARD_MS) return; // the menu has the focus, not another program
    hidePopup();
  });
  popup.on('closed', () => (popup = undefined));
  return popup;
}

/**
 * The popup is a whole browser process, about 60 MB. It is kept for a few minutes after it hides, so
 * opening it again in a burst of looks at the calendar is instant, and then released: the tray icon is
 * drawn by the main process and no longer needs it.
 */
// (A copy run from source may shorten the wait, to test the release; an installed build ignores it.)
const POPUP_IDLE_MS = !app.isPackaged && Number(process.env.OWA_POPUP_IDLE_MS) > 0 ? Number(process.env.OWA_POPUP_IDLE_MS) : 3 * 60_000;
let popupIdleTimer: NodeJS.Timeout | undefined;

function cancelPopupRelease() {
  if (popupIdleTimer) clearTimeout(popupIdleTimer);
  popupIdleTimer = undefined;
}

function schedulePopupRelease() {
  cancelPopupRelease();
  popupIdleTimer = setTimeout(() => {
    popupIdleTimer = undefined;
    if (!popup || popup.isDestroyed() || popup.isVisible() || popup.webContents.isDevToolsOpened()) return;
    popup.close();
  }, POPUP_IDLE_MS);
}

function hidePopup() {
  if (popup?.isVisible()) {
    popup.hide();
    lastPopupHide = Date.now();
    schedulePopupRelease();
  }
}

function showPopup() {
  const fresh = !popup || popup.isDestroyed();
  const win = ensurePopup();
  cancelPopupRelease();
  const reveal = () => {
    if (win.isDestroyed()) return;
    positionPopup(win, tray?.getBounds());
    win.show();
    win.focus();
    win.webContents.send(IPC.popupShown);
  };
  // A window that was released is built again: it appears once it has painted, not as an empty frame.
  if (fresh) win.once('ready-to-show', reveal);
  else reveal();
  void service.syncNow('popup');
}

/**
 * Right-click on a meeting: a native menu with three ways to copy it. The page sends only the id;
 * the title, time and link come from the meeting the service holds, and the clipboard is written
 * here, so a page cannot put its own text on the clipboard through this menu.
 */
/** Right-clicking is a human action: a page that asks faster than this is not a person with a mouse. */
const menuOpenings = new SlidingWindow(20, 60_000);

function openMeetingMenu(win: BrowserWindow, eventId: string) {
  if (meetingMenuOpenedAt && Date.now() - meetingMenuOpenedAt < MENU_GUARD_MS) return; // one menu at a time
  if (!menuOpenings.allows(Date.now())) return;
  menuOpenings.take(Date.now());
  const meeting = service.events.find((e) => e.id === eventId);
  if (!meeting) return; // gone with the last sync
  const menu = Menu.buildFromTemplate(
    meetingMenuItems(meeting, uiLang()).map((item) => ({
      label: item.label,
      // The clipboard can be locked by another program for a moment; that is logged, without the text.
      click: () => void clipboard.writeText(item.text).catch((e) => log.warn(`copy from the meeting menu failed: ${describeError(e)}`)),
    })),
  );
  meetingMenuOpenedAt = Date.now();
  menu.popup({
    window: win,
    callback: () => {
      // The guard stays up a moment longer: Windows hands the focus back (and may deliver a late blur)
      // just after the menu closes. If the menu was dismissed by a click on another program the popup
      // is not focused by then, and it hides as it would have on blur.
      setTimeout(() => {
        meetingMenuOpenedAt = 0;
        if (popup && !popup.isDestroyed() && popup.isVisible() && !popup.isFocused() && !popup.webContents.isDevToolsOpened()) hidePopup();
      }, 200);
    },
  });
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

/** First run: the settings, and when they are closed the widget shows itself once. */
function openSettingsForSetup() {
  openSettings();
  settingsWin?.once('closed', () => {
    if (!popup?.isVisible()) showPopup();
  });
}

// ---------- Create meeting ----------

/**
 * Opens the "Create meeting" window, or focuses it. With a prefill (already validated by the
 * caller) an open window starts over with it; without one an open window is left as the person has it.
 */
function openCreateMeeting(prefill?: CreateMeetingPrefill) {
  hidePopup();
  if (createWin && !createWin.isDestroyed()) {
    if (prefill !== undefined) {
      pendingPrefill = prefill;
      createWin.webContents.send(IPC.createPrefill, prefill);
    }
    if (createWin.isMinimized()) createWin.restore();
    createWin.show();
    createWin.focus();
    return;
  }
  pendingPrefill = prefill ?? null;
  createWin = createMeetingWindow(service.settings.theme);
  createWin.on('closed', () => {
    createWin = undefined;
    pendingPrefill = null;
  });
}

// ---------- Free time search ----------

function openAvailability() {
  hidePopup();
  if (availabilityWin && !availabilityWin.isDestroyed()) {
    availabilityWin.show();
    availabilityWin.focus();
    return;
  }
  availabilityWin = createAvailability(service.settings.theme);
  availabilityWin.on('closed', () => (availabilityWin = undefined));
}

// ---------- Meeting statistics ----------

function openStats() {
  hidePopup();
  if (statsWin && !statsWin.isDestroyed()) {
    statsWin.show();
    statsWin.focus();
    return;
  }
  statsWin = createStats(service.settings.theme);
  statsWin.on('closed', () => (statsWin = undefined));
}

// ---------- The tour on the first run ----------

function openWelcome() {
  hidePopup();
  if (welcomeWin && !welcomeWin.isDestroyed()) {
    welcomeWin.show();
    welcomeWin.focus();
    return;
  }
  welcomeWin = createWelcome(service.settings.theme);
  welcomeWin.on('closed', () => {
    welcomeWin = undefined;
    // However it was closed — the last step, "Пропустить" or the window's own cross — it has been
    // seen, and it is not shown again by itself. Without a server there is still nothing to show,
    // so the settings open even for someone who skipped the tour.
    const first = !service.settings.welcomeDone;
    service.markWelcomeDone();
    if (first && !DEMO) openSettingsForSetup();
  });
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
    // The link the button is labelled with, kept as it was when the toast was written. A sticky
    // notification can wait a long time, and the organizer can change the meeting meanwhile: the
    // button must never open a link the person was not shown. If it changed, the window opens instead.
    const advertised = joinUrlForActions(events[0]);
    const shown = showToast(
      reminderToast(events, new Date(), uiLang()),
      {
        onAction: (id, minutes) => {
          if (id === 'join') {
            const current = service.events.find((e) => e.id === events[0].id) ?? events[0];
            const url = joinUrlForActions(current);
            if (url && advertised && url === advertised) void openExternal(url);
            else openMeeting(events[0].id);
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
  const fresh = !popup || popup.isDestroyed();
  showPopup();
  if (!eventId) return;
  const send = () => popup?.webContents.send(IPC.openEvent, eventId);
  // A popup that was released is rebuilt: its page listens only after it has started, so the request waits for that.
  if (fresh && popup) popup.webContents.once('did-finish-load', () => setTimeout(send, 400));
  else send();
}

// ---------- Join ----------

async function openExternal(url: string) {
  const safe = safeUrl(url);
  if (safe) await shell.openExternal(safe);
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
      // The title is a stranger's text: one line, so it cannot run into the item's shortcut column or below it.
      ...join.map((e) => ({ label: `Подключиться${e.platform === 'generic' ? ` (${urlHost(joinUrlForActions(e)) ?? '?'})` : ''}: ${oneLine(displayTitle(e), 40)}`, click: () => void openExternal(joinUrlForActions(e)!) })),
      { label: 'Создать встречу…', click: () => openCreateMeeting() },
      { label: 'Обновить', click: () => void service.syncNow('manual') },
      { label: 'Найти свободное время…', click: openAvailability },
      { label: 'Статистика встреч…', click: openStats },
      { type: 'separator' as const },
      { label: 'Настройки…', click: openSettings },
      { label: 'Выход', role: 'quit' as const },
    ]),
  );
}

let lastTooltip = '';
let lastTrayKey = '';
let baseFrame: Electron.NativeImage | undefined;
let pulseFrame: Electron.NativeImage | undefined;

/** Windows' "show animations" switched off (or a remote session): the tray icon stays still. */
function animationsAllowed(): boolean {
  try {
    const a = systemPreferences.getAnimationSettings();
    return !a.prefersReducedMotion && a.shouldRenderRichAnimation;
  } catch {
    return true;
  }
}

// Swaps the two frames while a meeting is about to start; no timer exists the rest of the time.
const trayPulse = new TrayPulse({
  show: (frame) => {
    const img = frame === 1 ? pulseFrame : baseFrame;
    if (img && tray && !tray.isDestroyed()) tray.setImage(img);
  },
  allowed: animationsAllowed,
});

/** The language the widget is shown in: the setting, or the system's when it is left on "auto" (as the windows decide it). */
function trayLang(): Lang {
  const pref = service.settings.language;
  if (pref === 'ru' || pref === 'en') return pref;
  return app.getLocale().toLowerCase().startsWith('en') ? 'en' : 'ru';
}

const bitmapImage = (bgra: Buffer) => nativeImage.createFromBitmap(bgra, { width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });

/**
 * Draws the tray icon and writes the tooltip for the clock as it is now. It runs when the calendar, the
 * taskbar theme or the language change, and on a timer; an unchanged picture neither redraws the icon
 * nor restarts the pulse.
 */
function refreshTray(now = new Date()) {
  if (!tray || tray.isDestroyed() || !service) return;
  const lang = trayLang();
  const p = trayPresentation(service.events, now);
  const tooltip = tooltipFor(p, dict(lang), lang).slice(0, 127);
  lastTooltip = tooltip;
  const key = [p.kind, p.badge ?? '', p.invites, p.pulseUntil ?? '', taskbarLight, tooltip].join('\n');
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  trayPulse.stop();
  const img = bitmapImage(drawTrayBitmap(p, taskbarLight, 'base'));
  baseFrame = img.isEmpty() ? undefined : img;
  pulseFrame = undefined;
  if (baseFrame) tray.setImage(baseFrame);
  tray.setToolTip(tooltip);
  if (baseFrame && p.pulseUntil !== undefined) {
    const alt = bitmapImage(drawTrayBitmap(p, taskbarLight, 'pulse'));
    if (!alt.isEmpty()) {
      pulseFrame = alt;
      trayPulse.start(p.pulseUntil);
    }
  }
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

/**
 * "Send the invitations?" in a native dialog built from the validated meeting. The window cannot
 * click it. The default (and Esc) is "Cancel". Returns true only when the person pressed "Send".
 */
async function confirmInvitations(meeting: CreateMeetingInput): Promise<boolean> {
  // Development only (never in an installed build): the end-to-end test runs under a bare X server
  // where nobody can click a native dialog, so it asks for the "Send" answer by environment variable.
  if (!app.isPackaged && process.env.OWA_E2E_AUTOCONFIRM === '1') {
    log.warn('createMeeting: confirmation answered automatically (OWA_E2E_AUTOCONFIRM, development build)');
    return true;
  }
  const text = meetingConfirmText(meeting, uiLang());
  const parent = createWin && !createWin.isDestroyed() ? createWin : undefined;
  const answer = await askNative({ type: 'question', title: 'OWA Widget', message: text.message, detail: text.detail, buttons: text.buttons, defaultId: 0, cancelId: 0, noLink: true }, parent);
  return answer === 1;
}

/** "Save the change?" — built in the main process from the meeting as it is and as it would become. */
async function confirmChange(before: MeetingBefore, after: EditMeetingInput, fields: readonly string[]): Promise<boolean> {
  if (!app.isPackaged && process.env.OWA_E2E_AUTOCONFIRM === '1') {
    log.warn('editMeeting: confirmation answered automatically (OWA_E2E_AUTOCONFIRM, development build)');
    return true;
  }
  const text = meetingChangeText(before, after, fields, uiLang());
  const parent = createWin && !createWin.isDestroyed() ? createWin : undefined;
  return (await askNative({ type: 'question', title: 'OWA Widget', message: text.message, detail: text.detail, buttons: text.buttons, defaultId: 0, cancelId: 0, noLink: true }, parent)) === 1;
}

/** "Call the meeting off?" — the one answer that mails everybody at once, so it is asked plainly. */
async function confirmCancellation(before: MeetingBefore, count: number): Promise<boolean> {
  if (!app.isPackaged && process.env.OWA_E2E_AUTOCONFIRM === '1') {
    log.warn('cancelMeeting: confirmation answered automatically (OWA_E2E_AUTOCONFIRM, development build)');
    return true;
  }
  const text = meetingCancelText(before, count, uiLang());
  return (await askNative({ type: 'warning', title: 'OWA Widget', message: text.message, detail: text.detail, buttons: text.buttons, defaultId: 0, cancelId: 0, noLink: true })) === 1;
}

function registerIpc() {
  // Everything about creating a meeting goes through this one gate (see meetingGate.ts for the order).
  const meetingGate = new MeetingGate({ confirm: confirmInvitations, deliver: (m) => service.createMeeting(m) });
  // A page that asks the directory more than this is not someone typing.
  const peopleLookups = new SlidingWindow(60, 60_000);

  handle(IPC.getSnapshot, () => snapshot());
  handle(IPC.syncNow, () => service.syncNow('manual'));
  handle(IPC.getDetails, async (_e, id) => {
    const details = await service.details(parseId(id));
    // The description is served to the window, which makes its links clickable: the same links, and
    // only those, may be opened afterwards.
    if (details?.bodyText) for (const u of linksInText(details.bodyText)) allowLink(u);
    return details;
  });
  handle(IPC.respond, (_e, id, action) => service.respond(parseId(id), parseRsvpAction(action)));
  handle(IPC.openUrl, async (_e, url) => {
    const arg = parseUrlArg(url);
    const safe = arg ? safeUrl(arg) : null;
    if (safe && openableLinks.has(safe)) await openExternal(safe);
    else if (arg) log.warn('openUrl: refused a link the app did not hand to the window');
    hidePopup();
  });
  handle(IPC.copyText, (_e, text) => clipboard.writeText(parseClipboardText(text)));
  handle(IPC.meetingMenu, (e, id) => {
    const eventId = parseId(id);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && win === popup) openMeetingMenu(win, eventId);
  });
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
  handle(IPC.openWelcome, () => openWelcome());
  // The window's own "closed" handler remembers the tour and opens the settings when they are needed.
  handle(IPC.finishWelcome, () => welcomeWin?.close());
  handle(IPC.openCreateMeeting, (_e, prefill) => openCreateMeeting(prefill === undefined || prefill === null ? undefined : parseCreatePrefill(prefill)));
  handle(IPC.getCreatePrefill, () => pendingPrefill);
  handle(IPC.resolvePeople, async (_e, query) => {
    const q = parsePeopleQuery(query);
    if (!q || !peopleLookups.allows(Date.now())) return [];
    peopleLookups.take(Date.now());
    return service.resolvePeople(q);
  });
  handle(IPC.createMeeting, async (_e, input) => {
    try {
      const result = await meetingGate.submit(input);
      log.info(`createMeeting: ${result.status}${result.status === 'created' ? `, ${result.invited} invited` : ''}`);
      return result;
    } catch (e) {
      // Counts and kinds only: what failed may quote what the person typed (an address), which is never logged.
      log.warn(`createMeeting: failed (${e instanceof OwaError ? `${e.kind}${e.status ? `, HTTP ${e.status}` : ''}` : 'refused'})`);
      throw e;
    }
  });
  handle(IPC.openEditMeeting, async (_e, id) => {
    const before = await service.meetingBefore(parseId(id));
    const event = service.events.find((x) => x.id === before.id);
    openCreateMeeting({
      editId: before.id,
      editRecurring: event?.isRecurring === true,
      title: before.title,
      start: before.start,
      end: before.end,
      location: before.location,
      body: before.body,
      attendees: before.requiredAttendees,
      optional: before.optionalAttendees,
    });
  });
  handle(IPC.editMeeting, async (_e, input) => {
    try {
      // Everything a change needs is worked out inside the gate: what the meeting is now, what differs,
      // and who would be told — so a window cannot describe a change that was never made.
      const result = await meetingGate.run(async () => {
        const after = parseEditMeeting(input, new Date());
        const before = await service.meetingBefore(after.id);
        const fields = changedFields(before, after);
        if (!fields.length) throw new Error('Во встрече ничего не изменилось');
        // Everyone who is invited now, plus anyone being removed: the server tells them all.
        const told = new Set([...before.requiredAttendees, ...before.optionalAttendees, ...after.requiredAttendees, ...after.optionalAttendees].map((a) => a.toLowerCase()));
        const invited = after.requiredAttendees.length + after.optionalAttendees.length;
        return {
          recipients: told.size,
          confirm: () => confirmChange(before, after, fields),
          deliver: async () => {
            await service.updateMeeting(before, after, fields);
            return { status: 'updated', invited } as CreateMeetingResult;
          },
        };
      });
      log.info(`editMeeting: ${result.status}`);
      return result;
    } catch (e) {
      log.warn(`editMeeting: failed (${e instanceof OwaError ? `${e.kind}${e.status ? `, HTTP ${e.status}` : ''}` : 'refused'})`);
      throw e;
    }
  });
  handle(IPC.cancelMeeting, async (_e, id) => {
    try {
      const result = await meetingGate.run(async () => {
        const before = await service.meetingBefore(parseId(id));
        const count = before.requiredAttendees.length + before.optionalAttendees.length;
        return {
          recipients: count,
          confirm: () => confirmCancellation(before, count),
          deliver: async () => {
            await service.cancelMeeting(before);
            return { status: 'cancelledMeeting', invited: count } as CreateMeetingResult;
          },
        };
      });
      log.info(`cancelMeeting: ${result.status}`);
      return result;
    } catch (e) {
      log.warn(`cancelMeeting: failed (${e instanceof OwaError ? `${e.kind}${e.status ? `, HTTP ${e.status}` : ''}` : 'refused'})`);
      throw e;
    }
  });
  handle(IPC.openAvailability, () => openAvailability());
  // Validated here, whatever the page sent: at most 20 plain addresses, a window of at most 14 days.
  handle(IPC.getAvailability, (_e, request) => service.availability(parseAvailabilityRequest(request)));
  handle(IPC.openStats, () => openStats());
  // Validated here, whatever the page sent: a period of at most 60 days, not far from today.
  handle(IPC.getStatsEvents, (_e, request) => service.statsEvents(parseStatsRequest(request)));
  handle(IPC.closeWindow, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === popup) hidePopup();
    else win?.close();
  });
  handle(IPC.quit, () => app.quit());
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
  trayPulse.stop();
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

  service.on('changed', broadcast);
  // The icon follows the clock: once the calendar is known, whenever it changes, and every few seconds.
  service.on('changed', () => refreshTray());
  setInterval(() => refreshTray(), 15_000);
  refreshTray();
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
    applyLoginItem();
    refreshTray();
  });
  service.start();

  reminders = new ReminderScheduler(
    () => service.events,
    () => service.settings.reminderMinutes,
    showReminder,
  );
  reminders.start();

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
        openCreateMeeting();
        await new Promise((r) => setTimeout(r, 2500));
        writeFileSync(out.replace(/\.png$/i, '') + '-create.png', (await createWin!.webContents.capturePage()).toPNG());
        const createOk = await createWin!.webContents.executeJavaScript('!!document.querySelector(".create")');
        openAvailability();
        await new Promise((r) => setTimeout(r, 2500));
        writeFileSync(out.replace(/\.png$/i, '') + '-availability.png', (await availabilityWin!.webContents.capturePage()).toPNG());
        const availabilityOk = await availabilityWin!.webContents.executeJavaScript('!!document.querySelector(".avail")');
        openStats();
        await new Promise((r) => setTimeout(r, 2500));
        writeFileSync(out.replace(/\.png$/i, '') + '-stats.png', (await statsWin!.webContents.capturePage()).toPNG());
        const statsOk = await statsWin!.webContents.executeJavaScript('!!document.querySelector(".stats")');
        const metrics = app.getAppMetrics().map((m) => `${m.type}${m.name ? `(${m.name})` : ''}=${Math.round(m.memory.workingSetSize / 1024)}MB`);
        const total = Math.round(app.getAppMetrics().reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024);
        console.log(`SMOKE memory total=${total}MB ${metrics.join(' ')}`);
        const all = popupOk && settingsOk && createOk && availabilityOk && statsOk;
        console.log(`SMOKE ${all ? 'ok' : 'FAIL'} popup=${popupOk} settings=${settingsOk} create=${createOk} availability=${availabilityOk} stats=${statsOk} tray-tooltip="${lastTooltip.replace(/\n/g, ' | ')}" events=${service.events.length}`);
        app.exit(all ? 0 : 1);
      } catch (e) {
        console.log(`SMOKE FAIL ${describeError(e)}`);
        app.exit(1);
      }
    }, 1500);
    return;
  }

  // First launch: show the prefilled server address so the person can confirm or change it, and say
  // where the app lives, because Windows 11 hides new tray icons behind the "^" overflow button.
  const setupNeeded = (firstRun || !service.settings.account.serverUrl) && !DEMO;
  // The very first launch starts with the four-step tour; its last step opens the settings. Someone
  // who skips it lands in the settings all the same, because without a server there is nothing to show.
  // Only a genuinely first launch: an update must not greet people who have been using the app for weeks.
  if (firstRun && !service.settings.welcomeDone && !DEMO) openWelcome();
  else if (setupNeeded) openSettingsForSetup();
  else if (!process.argv.includes('--hidden')) {
    // A launch the person started themselves (not the one at sign-in) opens the widget.
    showPopup();
  }
  if (firstRun && process.platform === 'win32') {
    tray.displayBalloon({
      iconType: 'info',
      title: 'OWA Widget работает',
      content: 'Приложение живёт в области уведомлений (иконка может быть под стрелкой «^»). Закрытие окна его не завершает: «Выход» — в меню иконки или в настройках.',
    });
  }
  else if (!process.argv.includes('--hidden') && !app.isPackaged) showPopup();
});
