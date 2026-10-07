// Parsing of OWA HTML pages and JSON responses. Pure functions, unit-tested.
import type { CalendarEvent, EventAttendee, EventDetails, ResponseType } from '../../shared/types';
import { detectMeetingUrl, detectPlatform, safeUrl, stripHtml } from '../../shared/meetingUrl';
import { clean, clip, oneLine } from '../../shared/text';
import type { FolderIdentifier } from './payloads';

// ---------- CANARY ----------

// Every quantifier is bounded: a page is the server's to write, and an unbounded `[^"]*` after a
// phrase that repeats a million times makes the scan quadratic.
const CANARY_PATTERNS = [
  /"canary"\s{0,32}:\s{0,32}"([^"]{1,512})"/i,
  /name="canary"\s{1,32}value="([^"]{1,512})"/i,
  /name="canary" content="([^"]{1,512})"/i,
  /var\s{1,32}g_canary\s{0,32}=\s{0,32}"([^"]{1,512})"/i,
  /X-OWA-CANARY[^"]{0,200}"\s{0,32},\s{0,32}"([^"]{1,512})"/i,
  /data-canary="([^"]{1,512})"/i,
  /canary:\s{0,32}'([^']{1,512})'/i,
];

/** The token is near the top of OWA's page; a multi-megabyte answer is not scanned to the end. */
const MAX_CANARY_SCAN = 4 * 1024 * 1024;

export function extractCanaryFromHtml(html: string): string | undefined {
  const text = html.length > MAX_CANARY_SCAN ? html.slice(0, MAX_CANARY_SCAN) : html;
  for (const re of CANARY_PATTERNS) {
    const m = re.exec(text);
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

/** A logon page is a few KB; the rest of a huge answer is not read, and each tag is looked at once. */
const MAX_FORM_HTML = 256 * 1024;
const MAX_HIDDEN_FIELDS = 64;

/** A tag's attribute value, either quote style. The tag text is already cut to one tag, so this is bounded. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`[\\s"']${name}\\s{0,8}=\\s{0,8}(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** Start tags of the given names, in order. `[^<>]` keeps each match inside one tag, so the scan is linear. */
function* tags(html: string, ...names: string[]): Generator<{ name: string; text: string }> {
  const re = new RegExp(`<(${names.join('|')})(?=[\\s/>])[^<>]{0,4000}>`, 'gi');
  for (const m of html.slice(0, MAX_FORM_HTML).matchAll(re)) yield { name: m[1].toLowerCase(), text: m[0] };
}

/**
 * Reads the logon form. An absolute `action` is accepted only on the origin that served the page
 * (federation posts back to itself); a form that points somewhere else keeps /owa/auth.owa.
 */
export function parseLoginForm(html: string, pageUrl: string, base: string): LoginForm {
  const fallback = fallbackLoginForm(base);
  const page = new URL(pageUrl);
  let action = fallback.action;
  let formSeen = false;
  const hidden: Array<[string, string]> = [];
  for (const t of tags(html, 'form', 'input')) {
    if (t.name === 'form') {
      const raw = attr(t.text, 'action');
      if (formSeen || raw === undefined) continue;
      formSeen = true;
      try {
        const resolved = new URL(raw.replaceAll('&amp;', '&'), pageUrl);
        if (resolved.protocol === 'https:' && resolved.host.toLowerCase() === page.host.toLowerCase()) action = resolved.toString();
      } catch {
        /* keep default */
      }
    } else if (hidden.length < MAX_HIDDEN_FIELDS && attr(t.text, 'type')?.toLowerCase() === 'hidden') {
      const name = attr(t.text, 'name');
      if (name) hidden.push([clip(name, 256), clip(attr(t.text, 'value') ?? '', 4096)]);
    }
  }
  return { action, hiddenFields: hidden.length ? hidden : fallback.hiddenFields, referer: pageUrl };
}

/**
 * The only form a password may be posted to: OWA's own forms-based authentication, which always
 * posts to `…/auth.owa` over https on the same host and port and has a password field. A 404 page,
 * a portal or a reverse-proxy login page gets null, and the caller explains instead of sending the password.
 */
export function owaLoginForm(html: string, pageUrl: string, base: string): LoginForm | null {
  let hasPassword = false;
  for (const t of tags(html, 'input')) {
    if (attr(t.text, 'type')?.toLowerCase() === 'password' || /^(?:password|passwd)$/i.test(attr(t.text, 'name') ?? '')) {
      hasPassword = true;
      break;
    }
  }
  if (!hasPassword) return null;
  const raw = formActionOf(html);
  if (!raw) return null;
  try {
    const action = new URL(raw.replaceAll('&amp;', '&'), pageUrl);
    // A cleartext action would send the password where anyone on the path can read it, even from a trusted host.
    if (action.protocol !== 'https:') return null;
    if (!/\/auth\.owa$/i.test(action.pathname)) return null;
    if (action.host.toLowerCase() !== new URL(base).host.toLowerCase()) return null;
  } catch {
    return null;
  }
  return parseLoginForm(html, pageUrl, base);
}

/** Where a page's first form posts, for an error message (cleaned: it is the server's text). */
export function formActionOf(html: string): string | undefined {
  for (const t of tags(html, 'form')) {
    const raw = attr(t.text, 'action');
    if (raw !== undefined) return oneLine(raw, 300);
  }
  return undefined;
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

// Exchange enforces its own limits, but a server (or whatever answers in its place) is not trusted
// to: every text that reaches the window, the tray or the cache is cut to a sane size and stripped
// of control and bidi-override characters.
const MAX_EVENTS = 3000;
const MAX_TITLE = 500;
const MAX_LOCATION = 500;
const MAX_PERSON = 200;
const MAX_PREVIEW = 600;
const MAX_CATEGORIES = 20;
const MAX_ID = 2048;
const MAX_ATTENDEES = 500;
const MAX_BODY_TEXT = 100_000;
/** JSON nesting followed when looking for folders and attendees. */
const MAX_DEPTH = 40;
/** Text from a body that is scanned for a preview: the beginning is all that is shown. */
const PREVIEW_SOURCE = 20_000;
const text = (v: unknown, max: number): string | undefined => {
  const s = str(v);
  return s === undefined ? undefined : clean(s, max);
};

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
    .slice(0, MAX_CATEGORIES)
    .map((s) => (s === undefined ? undefined : clean(s, 100).trim()))
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
  const title = text(item.Subject, MAX_TITLE);
  const start = parseOwaDate(str(item.Start));
  const end = parseOwaDate(str(item.End));
  if (title === undefined || !start || !end) return null;

  const itemId = obj(item.ItemId);
  const isOrganizer = item.IsOrganizer === true;
  const preview = bodyTexts(item)[0];
  const { joinUrl, platform } = resolveJoin(item);

  return {
    id: clip(str(itemId?.Id) ?? `${title}-${start.toISOString()}`, MAX_ID),
    changeKey: str(itemId?.ChangeKey) ? clip(str(itemId?.ChangeKey)!, 512) : undefined,
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    isAllDay: item.IsAllDayEvent === true,
    location: text(obj(item.Location)?.DisplayName, MAX_LOCATION) || undefined,
    organizer: text(obj(obj(item.Organizer)?.Mailbox)?.Name, MAX_PERSON) || undefined,
    bodyPreview: preview ? clean(stripHtml(preview.slice(0, PREVIEW_SOURCE)), PREVIEW_SOURCE).replace(/\s+/g, ' ').trim().slice(0, MAX_PREVIEW) || undefined : undefined,
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
  return items.slice(0, MAX_EVENTS).map(mapCalendarItem).filter((e): e is CalendarEvent => !!e);
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
  const walk = (v: unknown, depth = 0) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
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
    Object.values(o).forEach((x) => walk(x, depth + 1));
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
  const name = clean(str(mailbox?.Name) ?? str(o.Name) ?? '', MAX_PERSON).trim();
  const email = clean(str(mailbox?.EmailAddress) ?? str(o.EmailAddress) ?? '', 320).trim() || undefined;
  const display = name || email || '';
  if (!display) return null;
  return { name: display, email, kind, response: mapResponseType(o.ResponseType, false) };
}

function parseAttendeeContainer(v: unknown, kind: EventAttendee['kind']): EventAttendee[] {
  const inner = obj(v)?.Attendee ?? v;
  const list = Array.isArray(inner) ? inner : [inner];
  return list
    .slice(0, MAX_ATTENDEES)
    .map((a) => parseAttendee(a, kind))
    .filter((a): a is EventAttendee => !!a);
}

const BODY_FIELDS = ['TextBody', 'UniqueBody', 'Body', 'NormalizedBody'] as const;

export function parseEventDetails(json: unknown): EventDetails {
  const attendees: EventAttendee[] = [];
  const bodies: Partial<Record<(typeof BODY_FIELDS)[number], { value: string; isHtml: boolean }>> = {};

  const walk = (v: unknown, depth = 0) => {
    if (depth > MAX_DEPTH || attendees.length >= MAX_ATTENDEES * 2) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
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
      if (k !== 'RequiredAttendees' && k !== 'OptionalAttendees') walk(nested, depth + 1);
    }
  };
  walk(json);

  const capped = attendees.slice(0, MAX_ATTENDEES * 2);
  const body = BODY_FIELDS.map((f) => bodies[f]).find(Boolean);
  if (!body) return { attendees: capped };
  const isHtml = body.isHtml || /<\/?[a-z][^<>]{0,200}>/i.test(body.value.slice(0, 50_000));
  // Only text goes to the window: markup from a stranger's invite never leaves this function.
  const readable = isHtml ? htmlToText(body.value) : body.value.trim().slice(0, MAX_BODY_TEXT * 2);
  return { attendees: capped, bodyText: clean(readable, MAX_BODY_TEXT) || undefined };
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

/** `<a href="https://…">label</a>` → `label (https://…)`, in one pass with indexOf so unclosed tags cost nothing extra. */
function linkText(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let pos = 0;
  let gt = -2; // next '>' at or after the current anchor (-1: there is none, so there is no further tag at all)
  let close = -2; // next '</a>'
  for (;;) {
    let a = lower.indexOf('<a', pos);
    while (a >= 0 && !/\s/.test(lower[a + 2] ?? '')) a = lower.indexOf('<a', a + 2);
    if (a < 0) break;
    if (gt !== -1 && gt < a) gt = lower.indexOf('>', a);
    if (gt < 0) break;
    const tag = html.slice(a, gt + 1);
    const href = tag.length <= 4000 && !tag.includes('<', 1) ? /\shref="(https?:[^"<>]+)"/i.exec(tag)?.[1] : undefined;
    if (href === undefined) {
      out += html.slice(pos, a + 2);
      pos = a + 2;
      continue;
    }
    if (close !== -1 && close < gt) close = lower.indexOf('</a>', gt);
    if (close < 0) break; // never closed, and no later anchor can be closed either
    const label = html.slice(gt + 1, close).replace(/<[^<>]*>/g, '').trim();
    out += html.slice(pos, a) + (label && label !== href ? `${label} (${href})` : href);
    pos = close + 4;
  }
  return out + html.slice(pos);
}

export function htmlToText(input: string): string {
  let html = input.length > MAX_BODY_CHARS ? input.slice(0, MAX_BODY_CHARS) : input;
  for (const tag of ['script', 'style', 'head']) html = removeBlocks(html, tag);
  const text = linkText(html)
    .replace(/<br\s{0,16}\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<li[^<>]*>/gi, '• ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^<>]*>/g, '')
    .replace(/&(#?\w{1,12});/g, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith('#')) {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return m;
    });
  // Line by line: a regex for "spaces before a newline" rescans a long run of spaces from every position.
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
