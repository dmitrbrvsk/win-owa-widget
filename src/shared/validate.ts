// Input validation for everything that crosses the IPC boundary. The renderer is our own code,
// but it also shows text written by strangers (meeting titles, bodies), so the main process never
// trusts what it receives: values are checked, clamped or dropped here.
import type { AppSettings, AvailabilityRequest, CalendarEvent, CreateMeetingInput, CreateMeetingPrefill, MeetingPlatform, ResponseType, RsvpAction, SettingsUpdate, TrayStatus } from './types';
import { safeUrl } from './meetingUrl';
import { clean, oneLine } from './text';
import { dedupeEmails, emailKey, isEmail, normalizeEmail } from './email';
import { MAX_PEOPLE, MAX_RANGE_DAYS } from './availability';

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

function isTrayPng(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_TRAY_ICON && v.startsWith(PNG_PREFIX) && isSmallPng(v);
}

/**
 * The tray icon is a small PNG the renderer drew; anything else is dropped. The pulse frame is held
 * to the same rules as the icon, and a bad one (or a missing end time) only costs the pulse: the
 * icon and the tooltip still apply.
 */
export function parseTrayStatus(v: unknown): TrayStatus | null {
  if (!isObj(v)) return null;
  const icon = v.iconDataUrl;
  if (!isTrayPng(icon)) return null;
  const status: TrayStatus = { iconDataUrl: icon, tooltip: clean(text(v.tooltip, 127), 127) };
  if (isTrayPng(v.pulseIconDataUrl) && typeof v.pulseUntil === 'number' && Number.isFinite(v.pulseUntil)) {
    status.pulseIconDataUrl = v.pulseIconDataUrl;
    status.pulseUntil = Math.round(v.pulseUntil);
  }
  return status;
}

// ---------- Free time search ----------

/** An instant with an explicit zone ("…Z" or "…+03:00"), the way `Date#toISOString` writes it. */
const ISO_INSTANT_LOOSE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** A window further than this from today is not something the screen can ask for. */
const MAX_DISTANCE_DAYS = 3 * 366;

function instant(v: unknown, what: string): number {
  if (typeof v !== 'string' || v.length > 40 || !ISO_INSTANT_LOOSE.test(v)) throw new Error(`Недопустимая дата (${what})`);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`Недопустимая дата (${what})`);
  return t;
}

/**
 * The request of the free time search, checked before anything leaves for the server: at most 20
 * plain e-mail addresses (a whole list is refused if one is bad, never silently trimmed), a window
 * of at most 14 days with the start before the end, and not further than three years from today.
 */
export function parseAvailabilityRequest(v: unknown, now = new Date()): AvailabilityRequest {
  if (!isObj(v)) throw new Error('Недопустимый запрос');
  const raw = v.emails;
  if (!Array.isArray(raw) || raw.length > MAX_PEOPLE) throw new Error(`Можно указать не больше ${MAX_PEOPLE} адресов`);
  const emails: string[] = [];
  for (const e of raw) {
    if (typeof e !== 'string' || !isEmail(e)) throw new Error('Недопустимый адрес электронной почты');
    const n = normalizeEmail(e);
    if (!emails.includes(n)) emails.push(n);
  }
  const start = instant(v.start, 'начало');
  const end = instant(v.end, 'конец');
  if (!(end > start)) throw new Error('Конец периода раньше начала');
  if (end - start > MAX_RANGE_DAYS * 86_400_000) throw new Error(`Период не может быть длиннее ${MAX_RANGE_DAYS} дней`);
  if (Math.abs(start - now.getTime()) > MAX_DISTANCE_DAYS * 86_400_000) throw new Error('Период слишком далеко от сегодняшнего дня');
  return { emails, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
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
    organizerEmail: isEmail(raw.organizerEmail) ? raw.organizerEmail : undefined,
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

// ---------- Create a meeting ----------
// Whatever the "Create meeting" window sends is rebuilt here, field by field, before the person is
// asked to confirm and before anything is sent. A page that is not our own code gets nothing through
// that these rules refuse: the limits below also bound what one mistaken or hostile call can send.

export const MAX_MEETING_ATTENDEES = 100;
export const MAX_MEETING_TITLE = 500;
export const MAX_MEETING_LOCATION = 500;
export const MAX_MEETING_BODY = 20_000;
/** A meeting longer than a week, or one more than two years from now, is a typo or an attack, not a plan. */
const MAX_MEETING_LENGTH_MS = 7 * 24 * 3_600_000;
const MAX_START_DISTANCE_MS = 731 * 24 * 3_600_000;
/** What a prefill from another window may span: the form shows one date, and the end may fall on the next day. */
const MAX_PREFILL_LENGTH_MS = 24 * 3_600_000;
/** An array longer than this is refused before any element is looked at. */
const MAX_RAW_ADDRESSES = 400;

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An ISO 8601 date-time WITH a zone ("Z" or an offset) as epoch milliseconds, or null. A time with no
 * zone is refused (it would mean different instants on different machines), and so is a date that does
 * not exist: `Date.parse` rolls "February 31" over to March, this does not.
 */
export function parseIsoInstant(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const m = ISO_INSTANT.exec(v);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  if (year < 1970 || year > 2200 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, Number(((m[7] ?? '') + '00').slice(0, 3)));
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (m[8] === 'Z') return ms;
  const offHours = Number(m[8].slice(1, 3));
  const offMinutes = Number(m[8].slice(4, 6));
  if (offHours > 23 || offMinutes > 59) return null;
  return ms - (m[8][0] === '-' ? -1 : 1) * (offHours * 60 + offMinutes) * 60_000;
}

const fail = (message: string): never => {
  throw new Error(message);
};

/** One line of text: hidden characters and line breaks go, the length is refused rather than silently cut. */
function lineField(v: unknown, max: number, what: string, required: boolean): string {
  if (v === undefined || v === null) return required ? fail(`${what}: не указано`) : '';
  if (typeof v !== 'string' || v.length > max * 8) return fail(`${what}: недопустимое значение`);
  const t = oneLine(v, max + 1);
  if (t.length > max) fail(`${what}: не длиннее ${max} символов`);
  if (required && !t) fail(`${what}: не указано`);
  return t;
}

function bodyField(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > MAX_MEETING_BODY * 4) return fail('Описание: недопустимое значение');
  const t = clean(v.replace(/\r\n?/g, '\n'), MAX_MEETING_BODY * 2).trim();
  if (t.length > MAX_MEETING_BODY) fail(`Описание: не длиннее ${MAX_MEETING_BODY} символов`);
  return t;
}

function addressesField(v: unknown, max: number, what: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > Math.max(max, MAX_RAW_ADDRESSES)) return fail(`${what}: слишком много адресов (не больше ${MAX_MEETING_ATTENDEES})`);
  return v.map((x) => {
    const e = typeof x === 'string' ? x.trim() : '';
    return isEmail(e) ? e : fail(`${what}: некорректный адрес «${oneLine(typeof x === 'string' ? x : '?', 60)}»`);
  });
}

/**
 * Checks and normalizes a meeting before it is confirmed and sent: text without hidden characters and
 * within its limits, addresses that are plain e-mail addresses (no repeats, 100 at most), and a start
 * and end that are real instants, in order, at most a week long and within two years of now.
 * Throws an Error with a message the person can read.
 */
export function parseCreateMeeting(raw: unknown, now: Date = new Date()): CreateMeetingInput {
  if (!isObj(raw)) return fail('Недопустимые данные встречи');
  const title = lineField(raw.title, MAX_MEETING_TITLE, 'Тема', true);
  const location = lineField(raw.location, MAX_MEETING_LOCATION, 'Место', false);
  const body = bodyField(raw.body);

  const required = dedupeEmails(addressesField(raw.requiredAttendees, MAX_MEETING_ATTENDEES, 'Обязательные'));
  const requiredKeys = new Set(required.map(emailKey));
  // Someone listed as both is a required attendee.
  const optional = dedupeEmails(addressesField(raw.optionalAttendees, MAX_MEETING_ATTENDEES, 'Необязательные')).filter((e) => !requiredKeys.has(emailKey(e)));
  if (required.length + optional.length > MAX_MEETING_ATTENDEES) fail(`Слишком много получателей: не больше ${MAX_MEETING_ATTENDEES}`);

  const start = parseIsoInstant(raw.start);
  const end = parseIsoInstant(raw.end);
  if (start === null || end === null) return fail('Недопустимые дата или время встречи');
  if (end <= start) fail('Встреча должна заканчиваться позже, чем начинается');
  if (end - start > MAX_MEETING_LENGTH_MS) fail('Встреча не может быть длиннее 7 суток');
  if (Math.abs(start - now.getTime()) > MAX_START_DISTANCE_MS) fail('Дата встречи должна быть не дальше двух лет от сегодняшней');

  return {
    title,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    requiredAttendees: required,
    optionalAttendees: optional,
    location,
    body,
  };
}

/**
 * What another window may ask the form to start with: ISO instants, up to 100 valid addresses, a title.
 * Strict: a wrong value is an error for the caller (a bug to fix), not something quietly dropped.
 * `undefined` / `null` is an empty prefill.
 */
export function parseCreatePrefill(raw: unknown): CreateMeetingPrefill {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) return fail('Недопустимые данные для новой встречи');
  const out: CreateMeetingPrefill = {};
  if (raw.title !== undefined) out.title = lineField(raw.title, MAX_MEETING_TITLE, 'Тема', false);
  if (raw.attendees !== undefined) {
    if (Array.isArray(raw.attendees) && raw.attendees.length > MAX_MEETING_ATTENDEES) fail(`Слишком много адресов: не больше ${MAX_MEETING_ATTENDEES}`);
    out.attendees = dedupeEmails(addressesField(raw.attendees, MAX_MEETING_ATTENDEES, 'Участники'));
  }
  let start: number | undefined;
  let end: number | undefined;
  if (raw.start !== undefined) start = parseIsoInstant(raw.start) ?? fail('Недопустимое время начала');
  if (raw.end !== undefined) end = parseIsoInstant(raw.end) ?? fail('Недопустимое время окончания');
  if (start !== undefined && end !== undefined) {
    if (end <= start) fail('Встреча должна заканчиваться позже, чем начинается');
    if (end - start >= MAX_PREFILL_LENGTH_MS) fail('Форма принимает встречу короче суток');
  }
  if (start !== undefined) out.start = new Date(start).toISOString();
  if (end !== undefined) out.end = new Date(end).toISOString();
  return out;
}

/** The text typed into the recipients field, for a directory lookup: one clean line of 2–100 characters, or null when it is too short. */
export function parsePeopleQuery(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2000) return fail('Недопустимый запрос');
  const q = oneLine(v, 100);
  return q.length >= 2 ? q : null;
}
