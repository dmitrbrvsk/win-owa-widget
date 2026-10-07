// Settings (plain JSON) and secrets / cache (encrypted with Windows DPAPI via safeStorage).
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings, CalendarEvent } from '../shared/types';
import { checkServerUrl } from '../shared/serverUrl';
import { readStoredPin, sanitizeSettings } from '../shared/validate';
import { log } from './log';
import { DEFAULT_SETTINGS } from './store.defaults';

export { DEFAULT_SETTINGS };

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

/** No settings file yet: the very first launch, when the settings window should open to confirm the defaults. */
export function isFirstRun(): boolean {
  return !existsSync(join(dir(), 'settings.json'));
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8')) as unknown;
    // The file is plain JSON that any program of this user can edit: read it through the same filter as the UI input.
    const clean = sanitizeSettings(raw, DEFAULT_SETTINGS);
    // A stored address that cannot be connected to (an e-mail typed into an older version, say) is
    // replaced by the default rather than failing every sync until the person finds it.
    if (clean.account.serverUrl && !checkServerUrl(clean.account.serverUrl).ok) {
      log.warn(`settings: stored server address is not a server address, using the default instead`);
      clean.account.serverUrl = DEFAULT_SETTINGS.account.serverUrl;
    }
    return { ...clean, account: { ...clean.account, ...readStoredPin(raw), hasPassword: !!loadPassword() } };
  } catch {
    return { ...DEFAULT_SETTINGS, account: { ...DEFAULT_SETTINGS.account } };
  }
}

export function saveSettings(s: AppSettings) {
  writeAtomic(join(dir(), 'settings.json'), JSON.stringify(s, null, 2));
}

// Development on Linux without a keyring: allow Electron's plain-text backend so a password can be
// kept between runs. Installed builds target Windows, where DPAPI is always available.
if (process.platform === 'linux' && !app.isPackaged) safeStorage.setUsePlainTextEncryption(true);

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

/** Returns whether the password is stored afterwards (false: cleared, or encryption unavailable). */
export function savePassword(password: string | undefined): boolean {
  const p = join(dir(), 'secret.bin');
  if (!password) {
    rmSync(p, { force: true });
    return false;
  }
  const enc = encrypt(password);
  // No OS encryption available → never write the password in the clear.
  if (!enc) return false;
  writeAtomic(p, enc);
  return true;
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
