// Input validation for everything that crosses the IPC boundary. The renderer is our own code,
// but it also shows text written by strangers (meeting titles, bodies), so the main process never
// trusts what it receives: values are checked, clamped or dropped here.
import type { AppSettings, RsvpAction, SettingsUpdate, TrayStatus } from './types';

const THEMES = ['system', 'light', 'dark'] as const;
const LANGS = ['system', 'ru', 'en'] as const;
const SIZES = ['compact', 'regular', 'large'] as const;
const RSVP: readonly RsvpAction[] = ['accept', 'tentative', 'decline'];

/** Chromium's certificate fingerprint: "sha256/" + base64 of 32 bytes. */
export const FINGERPRINT_RE = /^sha256\/[A-Za-z0-9+/]{43}=$/;

const MAX_URL = 4096;
const MAX_CLIPBOARD = 64 * 1024;
const MAX_TRAY_ICON = 64 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const intIn = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

export function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && FINGERPRINT_RE.test(v);
}

/** Rebuilds settings from untrusted input: unknown keys vanish, numbers are clamped. */
export function sanitizeSettings(raw: unknown, base: AppSettings): AppSettings {
  const r = isObj(raw) ? raw : {};
  const a = isObj(r.account) ? r.account : {};
  return {
    account: {
      serverUrl: text(a.serverUrl, 255).trim(),
      useWindowsAuth: true, // recomputed by the main process from login + password
      username: text(a.username, 256).trim(),
      // Decided by the main process, never by the renderer.
      hasPassword: base.account.hasPassword,
      trustedCertFingerprint: base.account.trustedCertFingerprint,
      trustedCertHost: base.account.trustedCertHost,
    },
    // A 1 ms or NaN interval would hammer the server and lock the domain account.
    syncIntervalMinutes: intIn(r.syncIntervalMinutes, 1, 24 * 60, base.syncIntervalMinutes),
    reminderMinutes: intIn(r.reminderMinutes, -1, 60, base.reminderMinutes),
    ...workday(r, base),
    launchAtLogin: bool(r.launchAtLogin, base.launchAtLogin),
    theme: oneOf(r.theme, THEMES, base.theme),
    language: oneOf(r.language, LANGS, base.language),
    popupSize: oneOf(r.popupSize, SIZES, base.popupSize),
    joinHotkeyEnabled: bool(r.joinHotkeyEnabled, base.joinHotkeyEnabled),
  };
}

/** The certificate pin as stored on disk: only the main process writes it, so it is read back here, not from the page. */
export function readStoredPin(raw: unknown): Pick<AppSettings['account'], 'trustedCertFingerprint' | 'trustedCertHost'> {
  const a = isObj(raw) && isObj(raw.account) ? raw.account : {};
  const host = text(a.trustedCertHost, 255).trim().toLowerCase();
  return isFingerprint(a.trustedCertFingerprint) && host ? { trustedCertFingerprint: a.trustedCertFingerprint, trustedCertHost: host } : {};
}

/** Start before end, both on the hour; anything else falls back to the current values. */
function workday(r: Record<string, unknown>, base: AppSettings): Pick<AppSettings, 'workdayStartHour' | 'workdayEndHour'> {
  const start = intIn(r.workdayStartHour, 0, 23, base.workdayStartHour);
  const end = intIn(r.workdayEndHour, 1, 24, base.workdayEndHour);
  return start < end ? { workdayStartHour: start, workdayEndHour: end } : { workdayStartHour: base.workdayStartHour, workdayEndHour: base.workdayEndHour };
}

export function sanitizeUpdate(raw: unknown, base: AppSettings): SettingsUpdate {
  const r = isObj(raw) ? raw : {};
  const password = typeof r.password === 'string' ? r.password.slice(0, 1024) : undefined;
  return { settings: sanitizeSettings(r.settings, base), password };
}

export function parseRsvpAction(v: unknown): RsvpAction {
  if (!RSVP.includes(v as RsvpAction)) throw new Error('Недопустимое действие');
  return v as RsvpAction;
}

export function parseId(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 2048) throw new Error('Недопустимый идентификатор');
  return v;
}

export function parseUrlArg(v: unknown): string | null {
  return typeof v === 'string' && v.length <= MAX_URL ? v : null;
}

export function parseClipboardText(v: unknown): string {
  if (typeof v !== 'string') throw new Error('Нужна строка');
  return v.slice(0, MAX_CLIPBOARD);
}

export function parseMinutes(v: unknown): number {
  return intIn(v, 1, 240, 5);
}

export function parseHeight(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The tray icon is a PNG the renderer drew; anything else is dropped. */
export function parseTrayStatus(v: unknown): TrayStatus | null {
  if (!isObj(v)) return null;
  const icon = v.iconDataUrl;
  if (typeof icon !== 'string' || icon.length > MAX_TRAY_ICON || !icon.startsWith('data:image/png;base64,')) return null;
  return { iconDataUrl: icon, tooltip: text(v.tooltip, 127) };
}
