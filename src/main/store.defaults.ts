// Defaults live apart from store.ts so tests can use them without loading Electron.
import type { AppSettings } from '../shared/types';

export const DEFAULT_SETTINGS: AppSettings = {
  // Prefilled for the team this build is made for; any other server can be typed over it.
  account: { serverUrl: 'owa.alfabank.ru', useWindowsAuth: true, username: '', hasPassword: false },
  syncIntervalMinutes: 5,
  reminderMinutes: 1,
  workdayStartHour: 8,
  workdayEndHour: 20,
  notifyChanges: true,
  reminderStyle: 'auto',
  launchAtLogin: true,
  theme: 'system',
  language: 'system',
  popupSize: 'regular',
  joinHotkeyEnabled: true,
};
