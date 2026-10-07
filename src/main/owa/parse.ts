// Parsing of OWA HTML pages and JSON responses. Pure functions, unit-tested.
import type { CalendarEvent, EventAttendee, EventDetails, ResponseType } from '../../shared/types';
import { detectMeetingUrl, detectPlatform, safeUrl, stripHtml } from '../../shared/meetingUrl';
import type { FolderIdentifier } from './payloads';

// ---------- CANARY ----------

const CANARY_PATTERNS = [
  /"canary"\s*:\s*"([^"]+)"/i,
  /name="canary"\s+value="([^"]+)"/i,
  /name="canary" content="([^"]+)"/i,
  /var\s+g_canary\s*=\s*"([^"]+)"/i,
  /X-OWA-CANARY[^"]*"\s*,\s*"([^"]+)"/i,
  /data-canary="([^"]+)"/i,
  /canary:\s*'([^']+)'/i,
];

export function extractCanaryFromHtml(html: string): string | undefined {
  for (const re of CANARY_PATTERNS) {
    const m = re.exec(html);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** The canary goes into a request header: only a plain token is accepted, never line breaks or spaces. */
export function validCanary(v: string | undefined): string | undefined {
  return v && v.length <= 512 && /^[A-Za-z0-9._~+/=%-]+$/.test(v) ? v : undefined;
}

// ---------- Forms login ----------

export interface LoginForm {
  action: string;
  hiddenFields: Array<[string, string]>;
  referer: string;
}

export function fallbackLoginForm(base: string): LoginForm {
  return {
    action: `${base}/owa/auth.owa`,
    hiddenFields: [
      ['destination', `${base}/owa/?bFS=1`],
      ['flags', '4'],
      ['forcedownlevel', '0'],
      ['isUtf8', '1'],
    ],
    referer: `${base}/owa/auth/logon.aspx`,
  };
}

/**
 * Reads the logon form. An absolute `action` is accepted only on the host that served the page
 * (federation posts back to itself); a form that points somewhere else keeps /owa/auth.owa.
 */
export function parseLoginForm(html: string, pageUrl: string, base: string): LoginForm {
  const fallback = fallbackLoginForm(base);
  const page = new URL(pageUrl);
  let action = fallback.action;
  const am = /<form[^>]+action="([^"]+)"/i.exec(html);
  if (am) {
    const raw = am[1].replaceAll('&amp;', '&');
    if (/^https?:/i.test(raw)) {
      try {
        if (new URL(raw).hostname.toLowerCase() === page.hostname.toLowerCase()) action = raw;
      } catch {
        /* keep default */
      }
    } else {
      try {
        action = new URL(raw, pageUrl).toString();
      } catch {
        /* keep default */
      }
    }
  }

  const hidden: Array<[string, string]> = [];
  for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]*)"[^>]+value="([^"]*)"/gi)) {
    hidden.push([m[1], m[2]]);
  }
  if (!hidden.length) {
    for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]+value="([^"]*)"[^>]+name="([^"]*)"/gi)) {
      hidden.push([m[2], m[1]]);
    }
  }
  return { action, hiddenFields: hidden.length ? hidden : fallback.hiddenFields, referer: pageUrl };
}

/**
 * The only form a password may be posted to: OWA's own forms-based authentication, which always
 * posts to `…/auth.owa` on the same host and has a password field. A 404 page, a portal or a
 * reverse-proxy login page gets null, and the caller explains instead of sending the password.
 */
export function owaLoginForm(html: string, pageUrl: string, base: string): LoginForm | null {
  if (!/<input[^<>]+type="password"/i.test(html) && !/<input[^<>]+name="(?:password|passwd)"/i.test(html)) return null;
  const raw = formActionOf(html);
  if (!raw) return null;
  try {
    const action = new URL(raw.replaceAll('&amp;', '&'), pageUrl);
    if (!/\/auth\.owa$/i.test(action.pathname)) return null;
    if (action.hostname.toLowerCase() !== new URL(base).hostname.toLowerCase()) return null;
  } catch {
    return null;
  }
  return parseLoginForm(html, pageUrl, base);
}

/** Where a page's first form posts, for an error message. */
export function formActionOf(html: string): string | undefined {
  return /<form[^<>]+action="([^"<>]+)"/i.exec(html)?.[1];
}

export function loginFormBody(form: LoginForm, username: string, password: string): string {
  const params = form.hiddenFields.filter(([k]) => !['username', 'password', 'passwd', 'passwordText'].includes(k));
  params.push(['username', username], ['password', password], ['passwordText', '']);
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * Did a login attempt that produced no CANARY land on OWA's own logon page (→ wrong password),
 * or never reach OWA at all (proxy 404 with VPN off, captive portal → connectivity)?
 */
export function looksLikeOwaLogon(finalUrl: string | undefined, body: string): boolean {
  if (finalUrl) {
    try {
      if (new URL(finalUrl).pathname.toLowerCase().includes('logon.aspx')) return true;
    } catch {
      /* ignore */
    }
  }
  const html = body.slice(0, 64_000).toLowerCase();
  if (html.includes('logon.aspx') || html.includes('auth_logon')) return true;
  const hasPasswd = html.includes('name="passwd"');
  const hasHidden = html.includes('name="destination"') || html.includes('name="flags"') || html.includes('name="isutf8"');
  return hasPasswd && hasHidden;
}

/** 401 / 440 (session timeout) / 449 (retry with: stale cookie after SSO): re-authenticate once. */
export function isSessionStaleStatus(status: number): boolean {
  return status === 401 || status === 440 || status === 449;
}

// ---------- Dates ----------

export function parseOwaDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const ms = /^\/Date\((-?\d+)/.exec(s);
  if (ms) return new Date(Number(ms[1]));
  // With an offset or Z: an absolute instant.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // No offset: local wall-clock time (the request's TimeZoneContext is the machine's zone).
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

// ---------- Calendar items ----------

export function mapResponseType(raw: unknown, isOrganizer: boolean): ResponseType {
  if (isOrganizer) return 'organizer';
  switch (raw) {
    case 'Accept':
      return 'accepted';
    case 'Tentative':
      return 'tentative';
    case 'Decline':
      return 'declined';
    case 'Organizer':
      return 'organizer';
    default:
      return 'notResponded';
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function bodyValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  return str(obj(v)?.Value);
}

function bodyTexts(item: Json): string[] {
  return [item.TextBody, item.UniqueBody, item.Body, item.NormalizedBody, item.Preview]
    .map(bodyValue)
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
}

function categories(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list
    .map((c) => {
      if (typeof c === 'string') return c;
      const o = obj(c);
      if (!o) return undefined;
      for (const k of ['Name', 'DisplayName', 'Value', 'CategoryName', 'name', 'displayName', 'value']) {
        const s = str(o[k]);
        if (s) return s;
      }
      return undefined;
    })
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
}

function resolveJoin(item: Json): { joinUrl?: string; platform: CalendarEvent['platform'] } {
  const direct = safeUrl(str(item.JoinOnlineMeetingUrl));
  if (direct) return { joinUrl: direct, platform: detectPlatform(direct) };
  const location = str(obj(item.Location)?.DisplayName)?.trim();
  if (location) {
    const d = detectMeetingUrl(location);
    if (d) return { joinUrl: d.url, platform: d.platform };
  }
  for (const body of bodyTexts(item)) {
    const d = detectMeetingUrl(body);
    if (d) return { joinUrl: d.url, platform: d.platform };
  }
  return { platform: 'generic' };
}

export function mapCalendarItem(raw: unknown): CalendarEvent | null {
  const item = obj(raw);
  if (!item) return null;
  const title = str(item.Subject);
  const start = parseOwaDate(str(item.Start));
  const end = parseOwaDate(str(item.End));
  if (title === undefined || !start || !end) return null;

  const itemId = obj(item.ItemId);
  const isOrganizer = item.IsOrganizer === true;
  const preview = bodyTexts(item)[0];
  const { joinUrl, platform } = resolveJoin(item);

  return {
    id: str(itemId?.Id) ?? `${title}-${start.toISOString()}`,
    changeKey: str(itemId?.ChangeKey),
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    isAllDay: item.IsAllDayEvent === true,
    location: str(obj(item.Location)?.DisplayName) || undefined,
    organizer: str(obj(obj(item.Organizer)?.Mailbox)?.Name) || undefined,
    bodyPreview: preview ? stripHtml(preview).replace(/\s+/g, ' ').trim() : undefined,
    joinUrl,
    platform,
    isCancelled: item.IsCancelled === true,
    isOrganizer,
    responseType: mapResponseType(item.ResponseType, isOrganizer),
    categories: categories(item.Categories),
    isRecurring: item.IsRecurring === true || !!str(item.SeriesId),
  };
}

export function parseCalendarView(json: unknown): CalendarEvent[] {
  const items = obj(obj(json)?.Body)?.Items;
  if (!Array.isArray(items)) return [];
  return items.map(mapCalendarItem).filter((e): e is CalendarEvent => !!e);
}

// ---------- GetCalendarFolders ----------

export function defaultCalendarFolder(json: unknown): FolderIdentifier | undefined {
  interface Candidate {
    id: FolderIdentifier;
    name?: string;
    distinguished?: string;
    isDefaultFolder: boolean;
    isDefaultCalendar: boolean;
  }
  const out: Candidate[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    const o = obj(v);
    if (!o) return;
    const fid = obj(o.FolderId);
    const id = str(fid?.Id);
    if (id) {
      out.push({
        id: { id, changeKey: str(fid?.ChangeKey) },
        name: str(o.DisplayName),
        distinguished: str(o.DistinguishedFolderId),
        isDefaultFolder: o.IsDefaultFolder === true,
        isDefaultCalendar: o.IsDefaultCalendar === true,
      });
    }
    Object.values(o).forEach(walk);
  };
  walk(json);
  return (
    out.find((c) => c.isDefaultCalendar)?.id ??
    out.find((c) => c.distinguished === 'calendar' || c.name?.trim().toLowerCase() === 'calendar' || c.isDefaultFolder)?.id ??
    out[0]?.id
  );
}

// ---------- GetCalendarEvent ----------

function parseAttendee(v: unknown, kind: EventAttendee['kind']): EventAttendee | null {
  const o = obj(v);
  if (!o) return null;
  const mailbox = obj(o.Mailbox);
  const name = (str(mailbox?.Name) ?? str(o.Name) ?? '').trim();
  const email = (str(mailbox?.EmailAddress) ?? str(o.EmailAddress))?.trim() || undefined;
  const display = name || email || '';
  if (!display) return null;
  return { name: display, email, kind, response: mapResponseType(o.ResponseType, false) };
}

function parseAttendeeContainer(v: unknown, kind: EventAttendee['kind']): EventAttendee[] {
  const inner = obj(v)?.Attendee ?? v;
  const list = Array.isArray(inner) ? inner : [inner];
  return list.map((a) => parseAttendee(a, kind)).filter((a): a is EventAttendee => !!a);
}

const BODY_FIELDS = ['TextBody', 'UniqueBody', 'Body', 'NormalizedBody'] as const;

export function parseEventDetails(json: unknown): EventDetails {
  const attendees: EventAttendee[] = [];
  const bodies: Partial<Record<(typeof BODY_FIELDS)[number], { value: string; isHtml: boolean }>> = {};

  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    const o = obj(v);
    if (!o) return;
    if (o.RequiredAttendees) attendees.push(...parseAttendeeContainer(o.RequiredAttendees, 'required'));
    if (o.OptionalAttendees) attendees.push(...parseAttendeeContainer(o.OptionalAttendees, 'optional'));
    for (const f of BODY_FIELDS) {
      const c = obj(o[f]);
      const value = str(c?.Value);
      if (!bodies[f] && value && value.trim()) {
        bodies[f] = { value, isHtml: str(c?.BodyType)?.toLowerCase() === 'html' };
      }
    }
    for (const [k, nested] of Object.entries(o)) {
      if (k !== 'RequiredAttendees' && k !== 'OptionalAttendees') walk(nested);
    }
  };
  walk(json);

  const body = BODY_FIELDS.map((f) => bodies[f]).find(Boolean);
  if (!body) return { attendees };
  const isHtml = body.isHtml || /<\/?[a-z][\s\S]*>/i.test(body.value);
  const text = isHtml ? htmlToText(body.value) : body.value.trim();
  return { attendees, bodyText: text || undefined, bodyHtml: isHtml ? body.value : undefined };
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Bodies come from strangers; nothing below may take more than linear time on hostile input. */
const MAX_BODY_CHARS = 400_000;

/** Drops `<name …>…</name>` blocks with indexOf, so an unclosed tag cannot trigger repeated rescans. */
function removeBlocks(html: string, name: string): string {
  const lower = html.toLowerCase();
  const open = `<${name}`;
  const close = `</${name}>`;
  let out = '';
  let pos = 0;
  for (;;) {
    const a = lower.indexOf(open, pos);
    if (a < 0) break;
    const b = lower.indexOf(close, a);
    out += html.slice(pos, a);
    if (b < 0) {
      pos = html.length; // never closed: everything after it is part of the block
      break;
    }
    pos = b + close.length;
  }
  return out + html.slice(pos);
}

export function htmlToText(input: string): string {
  let html = input.length > MAX_BODY_CHARS ? input.slice(0, MAX_BODY_CHARS) : input;
  for (const tag of ['script', 'style', 'head']) html = removeBlocks(html, tag);
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<li[^<>]*>/gi, '• ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<a[^<>]+href="(https?:[^"<>]+)"[^<>]*>([^<]*(?:<(?!\/a>)[^<]*)*)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^<>]*>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<[^<>]*>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith('#')) {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
