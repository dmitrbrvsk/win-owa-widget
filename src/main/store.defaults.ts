// Defaults live apart from store.ts so tests can use them without loading Electron.
import type { AppSettings } from '../shared/types';

export const DEFAULT_SETTINGS: AppSettings = {
  account: { serverUrl: '', useWindowsAuth: true, username: '', hasPassword: false },
  syncIntervalMinutes: 5,
  reminderMinutes: 1,
  launchAtLogin: true,
  theme: 'system',
  language: 'system',
  popupSize: 'regular',
  joinHotkeyEnabled: true,
};
