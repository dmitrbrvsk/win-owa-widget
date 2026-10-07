// `window.owa` comes from the preload script. In a plain browser (`vite` without Electron, used
// for UI work and screenshots) a mock with demo meetings stands in.
import type { OwaApi, Snapshot, AppSettings } from '../shared/types';
import { demoDetails, demoEvents } from '../main/demo';

declare global {
  interface Window {
    owa?: OwaApi;
  }
}

function mockApi(): OwaApi {
  const params = new URLSearchParams(location.search);
  const settings: AppSettings = {
    account: { serverUrl: 'mail.example.ru', useWindowsAuth: true, username: '', hasPassword: false },
    syncIntervalMinutes: 5,
    reminderMinutes: 1,
    launchAtLogin: true,
    theme: (params.get('theme') as AppSettings['theme']) ?? 'system',
    language: (params.get('lang') as AppSettings['language']) ?? 'ru',
    popupSize: 'regular',
    joinHotkeyEnabled: true,
  };
  let snap: Snapshot = {
    events: demoEvents(),
    sync: { phase: 'ok', lastSuccess: new Date().toISOString() },
    settings,
    demo: true,
    version: '0.1.6',
    taskbarLight: false,
    logPath: 'C:\\Users\\you\\AppData\\Roaming\\OWA Widget\\logs\\owa-widget.log',
  };
  if (params.get('error') === 'network') snap.sync = { phase: 'error', error: 'Сервер недоступен — возможно, выключен VPN', errorKind: 'network', lastSuccess: new Date(Date.now() - 42 * 60_000).toISOString() };
  const listeners = new Set<(s: Snapshot) => void>();
  const emit = () => listeners.forEach((l) => l(snap));
  return {
    getSnapshot: async () => snap,
    onSnapshot: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    syncNow: async () => {
      snap = { ...snap, sync: { phase: 'ok', lastSuccess: new Date().toISOString() } };
      emit();
    },
    getDetails: async (id) => demoDetails(snap.events.find((e) => e.id === id)!),
    respond: async (id, action) => {
      snap = {
        ...snap,
        events: snap.events.map((e) => (e.id === id ? { ...e, responseType: action === 'accept' ? 'accepted' : action === 'tentative' ? 'tentative' : 'declined' } : e)),
      };
      emit();
    },
    openUrl: async (url) => void window.open(url, '_blank'),
    copyText: async (text) => navigator.clipboard?.writeText(text),
    saveSettings: async (u) => {
      snap = { ...snap, settings: u.settings };
      emit();
    },
    testConnection: async () => ({ ok: true, message: 'Подключено. Встреч на неделю: 12', eventCount: 12 }),
    trustCertificate: async () => {},
    forgetCertificate: async () => {},
    openLog: async () => {},
    openSettings: async () => void (location.hash = '#/settings'),
    closeWindow: async () => {},
    quit: async () => {},
    setTrayStatus: (s) => {
      (window as unknown as { __tray?: unknown }).__tray = s;
    },
    onReminder: () => () => {},
    getReminder: async () => ({ events: snap.events.filter((e) => e.title.startsWith('Дизайн') || e.title.startsWith('Синк')).slice(0, params.get('many') ? 2 : 1) }),
    snoozeReminder: async () => {},
    onPopupShown: () => () => {},
    resizePopup: () => {},
  };
}

export const api: OwaApi = window.owa ?? mockApi();
export const isMock = !window.owa;
