// Input validation for everything that crosses the IPC boundary. The renderer is our own code,
// but it also shows text written by strangers (meeting titles, bodies), so the main process never
// trusts what it receives: values are checked, clamped or dropped here.
import type { AppSettings, CalendarEvent, MeetingPlatform, ResponseType, RsvpAction, SettingsUpdate, TrayStatus } from './types';
import { safeUrl } from './meetingUrl';
import { clean } from './text';

const THEMES = ['system', 'light', 'dark'] as const;
const LANGS = ['system', 'ru', 'en'] as const;
const SIZES = ['compact', 'regular', 'large'] as const;
const REMINDER_STYLES = ['auto', 'system', 'window'] as const;
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
    notifyChanges: bool(r.notifyChanges, base.notifyChanges),
    reminderStyle: oneOf(r.reminderStyle, REMINDER_STYLES, base.reminderStyle),
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

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_ICON_SIDE = 128;

/** The first bytes of the PNG must be a real header of a small image: the main process decodes this picture, so it is checked before it gets there. */
function isSmallPng(dataUrl: string): boolean {
  let bin: string;
  try {
    bin = atob(dataUrl.slice(PNG_PREFIX.length, PNG_PREFIX.length + 48));
  } catch {
    return false;
  }
  if (bin.length < 24 || PNG_SIGNATURE.some((b, i) => bin.charCodeAt(i) !== b) || bin.slice(12, 16) !== 'IHDR') return false;
  const u32 = (at: number) => ((bin.charCodeAt(at) << 24) | (bin.charCodeAt(at + 1) << 16) | (bin.charCodeAt(at + 2) << 8) | bin.charCodeAt(at + 3)) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width >= 1 && height >= 1 && width <= MAX_ICON_SIDE && height <= MAX_ICON_SIDE;
}

/** The tray icon is a small PNG the renderer drew; anything else is dropped. */
export function parseTrayStatus(v: unknown): TrayStatus | null {
  if (!isObj(v)) return null;
  const icon = v.iconDataUrl;
  if (typeof icon !== 'string' || icon.length > MAX_TRAY_ICON || !icon.startsWith(PNG_PREFIX) || !isSmallPng(icon)) return null;
  return { iconDataUrl: icon, tooltip: clean(text(v.tooltip, 127), 127) };
}

// ---------- The event cache ----------

const RESPONSES: readonly ResponseType[] = ['accepted', 'tentative', 'declined', 'organizer', 'notResponded'];
const PLATFORMS: readonly MeetingPlatform[] = ['teams', 'zoom', 'webex', 'googleMeet', 'ktalk', 'generic'];
const MAX_CACHED_EVENTS = 3000;

const iso = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};
const opt = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v ? clean(v, max) : undefined);

function sanitizeEvent(raw: unknown): CalendarEvent | null {
  if (!isObj(raw)) return null;
  const start = iso(raw.start);
  const end = iso(raw.end);
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.title !== 'string' || !start || !end) return null;
  const joinUrl = typeof raw.joinUrl === 'string' ? (safeUrl(raw.joinUrl) ?? undefined) : undefined;
  return {
    id: raw.id.slice(0, 2048),
    changeKey: opt(raw.changeKey, 512),
    title: clean(raw.title, 500),
    start,
    end,
    isAllDay: raw.isAllDay === true,
    location: opt(raw.location, 500),
    organizer: opt(raw.organizer, 200),
    bodyPreview: opt(raw.bodyPreview, 600),
    joinUrl,
    platform: joinUrl ? oneOf(raw.platform, PLATFORMS, 'generic') : 'generic',
    isCancelled: raw.isCancelled === true,
    isOrganizer: raw.isOrganizer === true,
    responseType: oneOf(raw.responseType, RESPONSES, 'notResponded'),
    categories: Array.isArray(raw.categories) ? raw.categories.filter((c): c is string => typeof c === 'string').slice(0, 20).map((c) => clean(c, 100)) : [],
    isRecurring: raw.isRecurring === true,
  };
}

/** The cache is a file on disk: whatever it holds is rebuilt field by field, and a broken file gives an empty list. */
export function sanitizeEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarEvent[] = [];
  for (const item of raw.slice(0, MAX_CACHED_EVENTS)) {
    const e = sanitizeEvent(item);
    if (e) out.push(e);
  }
  return out;
}
