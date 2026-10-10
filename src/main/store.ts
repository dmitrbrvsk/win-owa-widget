// Settings (plain JSON) and secrets / cache (encrypted with Windows DPAPI via safeStorage).
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings, CalendarEvent } from '../shared/types';
import { checkServerUrl, serverKey } from '../shared/serverUrl';
import { openSecret, sealSecret } from '../shared/secret';
import { NoteBook } from '../shared/notes';
import { readStoredPin, sanitizeEvents, sanitizeSettings } from '../shared/validate';
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
    return { ...clean, account: { ...clean.account, ...readStoredPin(raw), hasPassword: !!loadPassword(serverKey(clean.account.serverUrl)) } };
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

/**
 * The saved password, only for the server it was typed for (`server` is `host[:port]`, see
 * serverKey). For any other server, or none, there is no password.
 */
export function loadPassword(server: string): string | undefined {
  const p = join(dir(), 'secret.bin');
  if (!server || !existsSync(p)) return undefined;
  const plain = decrypt(readFileSync(p));
  if (plain === null) return undefined;
  const opened = openSecret(plain, server);
  if (opened.kind === 'ok') return opened.password;
  if (opened.kind === 'legacy') {
    // Saved by a version before 0.2.0, which kept the bare password with no record of the server it
    // was typed for. Binding it to whatever address is in settings.json now would hand it to a server
    // the person never confirmed (that file is editable by anything running as this user), so it is
    // forgotten instead and asked for again — once, on the way from a build nobody is running any more.
    log.warn('password: stored by a version before 0.2.0 with no server of its own; forgotten, it has to be entered again');
    rmSync(p, { force: true });
    return undefined;
  }
  return undefined;
}

/** Returns whether the password is stored afterwards (false: cleared, or encryption unavailable). */
export function savePassword(password: string | undefined, server: string): boolean {
  const p = join(dir(), 'secret.bin');
  if (!password || !server) {
    rmSync(p, { force: true });
    return false;
  }
  const enc = encrypt(sealSecret(password, server));
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
    return sanitizeEvents(JSON.parse(text));
  } catch {
    return [];
  }
}

export function saveEventCache(events: CalendarEvent[]) {
  const enc = encrypt(JSON.stringify(events));
  if (enc) writeAtomic(join(dir(), 'cache.bin'), enc);
}

/** Removes the saved meeting list from the disk (the "reset cache" button). */
export function clearEventCache() {
  rmSync(join(dir(), 'cache.bin'), { force: true });
}

/** The person's notes on meetings, encrypted with the Windows account's key like the saved password and the cache. */
export function loadNotes(now: Date = new Date()): NoteBook {
  const p = join(dir(), 'notes.bin');
  if (!existsSync(p)) return new NoteBook();
  const plain = decrypt(readFileSync(p));
  if (!plain) return new NoteBook();
  try {
    return NoteBook.parse(JSON.parse(plain), now);
  } catch {
    return new NoteBook();
  }
}

/** Returns false when nothing could be written: with no OS encryption the notes are never put on disk in the clear. */
export function saveNotes(book: NoteBook): boolean {
  const p = join(dir(), 'notes.bin');
  if (book.size === 0) {
    rmSync(p, { force: true });
    return true;
  }
  const enc = encrypt(JSON.stringify(book));
  if (!enc) return false;
  writeAtomic(p, enc);
  return true;
}
