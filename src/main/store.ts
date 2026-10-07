// Settings (plain JSON) and secrets / cache (encrypted with Windows DPAPI via safeStorage).
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings, CalendarEvent } from '../shared/types';

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

const dir = () => {
  const d = app.getPath('userData');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
};

function writeAtomic(path: string, data: string | Buffer) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8')) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      account: { ...DEFAULT_SETTINGS.account, ...(raw.account ?? {}), hasPassword: !!loadPassword() },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, account: { ...DEFAULT_SETTINGS.account } };
  }
}

export function saveSettings(s: AppSettings) {
  writeAtomic(join(dir(), 'settings.json'), JSON.stringify(s, null, 2));
}

function encrypt(text: string): Buffer | null {
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : null;
}

function decrypt(buf: Buffer): string | null {
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
  } catch {
    return null;
  }
}

export function loadPassword(): string | undefined {
  const p = join(dir(), 'secret.bin');
  if (!existsSync(p)) return undefined;
  return decrypt(readFileSync(p)) ?? undefined;
}

export function savePassword(password: string | undefined) {
  const p = join(dir(), 'secret.bin');
  if (!password) {
    if (existsSync(p)) writeAtomic(p, Buffer.alloc(0));
    return;
  }
  const enc = encrypt(password);
  // No OS encryption available → do not persist the password at all.
  if (enc) writeAtomic(p, enc);
}

/** The last synced meetings, so the widget shows something offline and right after launch. */
export function loadEventCache(): CalendarEvent[] {
  const p = join(dir(), 'cache.bin');
  if (!existsSync(p)) return [];
  const text = decrypt(readFileSync(p));
  if (!text) return [];
  try {
    return JSON.parse(text) as CalendarEvent[];
  } catch {
    return [];
  }
}

export function saveEventCache(events: CalendarEvent[]) {
  const enc = encrypt(JSON.stringify(events));
  if (enc) writeAtomic(join(dir(), 'cache.bin'), enc);
}
