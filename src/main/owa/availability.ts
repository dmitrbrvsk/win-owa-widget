// Free/busy over EWS: the GetUserAvailability request and its answer. Pure functions, unit-tested.
//
// The answer is the server's to write: it is read with one linear pass (indexOf, no backtracking
// patterns), the number of people, events and characters is capped, and every text that comes out
// is cleaned and clipped before it can reach the window.
import type { AvailabilityEvent, AvailabilityStatus, PersonAvailability } from '../../shared/types';
import { isEmail, normalizeEmail } from '../../shared/email';
import { MAX_DIGITS, MAX_EVENTS_PER_PERSON, MAX_SUBJECT, SLOT_MINUTES, slotCount } from '../../shared/availability';
import { oneLine } from '../../shared/text';
import { xmlText } from './ewsMeeting';
import { owaLocalDate } from './payloads';
import { parseOwaDate } from './parse';

/** The user's own mailbox is asked for in addition to the (at most 20) people the user typed. */
export const MAX_MAILBOXES = 21;

// ---------- XML text ----------

// One implementation for every request that carries text: see ewsMeeting.ts.
export { xmlText };

// ---------- Time zone ----------

export interface TimeZoneTime {
  /** Minutes added to the zone's base bias while this period lasts. */
  bias: number;
  /** Local wall-clock time of the switch, HH:MM:SS. */
  time: string;
  /** 1-4: first to fourth, 5: last. */
  dayOrder: number;
  /** 1-12. */
  month: number;
  dayOfWeek: string;
}

/** EWS's SerializableTimeZone: UTC = local + bias (a zone east of Greenwich has a negative bias). */
export interface AvailabilityTimeZone {
  bias: number;
  standard: TimeZoneTime;
  daylight: TimeZoneTime;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;
const MINUTE = 60_000;
const p2 = (n: number) => String(n).padStart(2, '0');

/** No daylight saving: both periods carry no extra bias, so the answer is the same whichever the server picks. */
const NO_SWITCH: TimeZoneTime = { bias: 0, time: '00:00:00', dayOrder: 1, month: 1, dayOfWeek: 'Sunday' };

interface Switch {
  at: number;
  before: number;
  after: number;
}

/**
 * The time zone of this computer as EWS wants it: the base bias plus the rule of the two yearly
 * switches, read from the system's own offsets (`offsetAt(ms)` is `Date#getTimezoneOffset`: minutes
 * from local time to UTC). A zone with no switch in the year of `at` (or one with an odd pattern)
 * gets the fixed offset in force at `at`.
 */
export function availabilityTimeZone(at: Date, offsetAt: (ms: number) => number = (ms) => new Date(ms).getTimezoneOffset()): AvailabilityTimeZone {
  const year = at.getFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const daysInYear = Math.round((Date.UTC(year + 1, 0, 1) - jan1) / DAY_MS);
  const switches: Switch[] = [];
  let prev = offsetAt(jan1);
  for (let k = 1; k <= daysInYear && switches.length < 5; k++) {
    const t = jan1 + k * DAY_MS;
    const cur = offsetAt(t);
    if (cur === prev) continue;
    // One switch in this day: find the minute from which the new offset applies.
    let lo = t - DAY_MS;
    let hi = t;
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / MINUTE / 2) * MINUTE;
      if (offsetAt(mid) === prev) lo = mid;
      else hi = mid;
    }
    switches.push({ at: hi, before: prev, after: cur });
    prev = cur;
  }

  const fixed = (): AvailabilityTimeZone => ({ bias: offsetAt(at.getTime()), standard: NO_SWITCH, daylight: NO_SWITCH });
  if (switches.length !== 2) return fixed();
  const toDaylight = switches.find((s) => s.after < s.before); // clocks go forward: the offset to UTC shrinks
  const toStandard = switches.find((s) => s.after > s.before);
  if (!toDaylight || !toStandard) return fixed();

  const describe = (s: Switch, bias: number): TimeZoneTime => {
    // The clock reading at the moment of the switch, before it moves.
    const local = new Date(s.at - s.before * MINUTE);
    const day = local.getUTCDate();
    const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
    return {
      bias,
      time: `${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:${p2(local.getUTCSeconds())}`,
      dayOrder: day + 7 > daysInMonth ? 5 : Math.ceil(day / 7),
      month: local.getUTCMonth() + 1,
      dayOfWeek: WEEKDAYS[local.getUTCDay()],
    };
  };
  const standardBias = toDaylight.before; // the larger offset: standard time
  return { bias: standardBias, standard: describe(toStandard, 0), daylight: describe(toDaylight, toDaylight.after - standardBias) };
}

function timeZoneXml(tz: AvailabilityTimeZone, tag: string): string {
  const part = (name: string, x: TimeZoneTime) =>
    `<t:${name}><t:Bias>${x.bias}</t:Bias><t:Time>${xmlText(x.time)}</t:Time><t:DayOrder>${x.dayOrder}</t:DayOrder><t:Month>${x.month}</t:Month><t:DayOfWeek>${xmlText(x.dayOfWeek)}</t:DayOfWeek></t:${name}>`;
  return `<t:${tag}><t:Bias>${tz.bias}</t:Bias>${part('StandardTime', tz.standard)}${part('DaylightTime', tz.daylight)}</t:${tag}>`;
}

// ---------- The request ----------

/**
 * GetUserAvailability for `emails`, merged free/busy in `intervalMinutes` steps over [start, end).
 * The window is written as local wall-clock time, which the request's TimeZone element (the same
 * zone the dates were made in) turns back into the right instants. `DetailedMerged` returns the
 * character string for every mailbox, plus subjects where the server lets this user see them.
 */
export function userAvailabilitySoap(emails: readonly string[], start: Date, end: Date, tz: AvailabilityTimeZone, intervalMinutes = SLOT_MINUTES): string {
  if (emails.length > MAX_MAILBOXES) throw new Error('Слишком много адресов');
  if (!(end.getTime() > start.getTime()) || !Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) throw new Error('Недопустимый интервал');
  const mailboxes = emails
    .map((e) => {
      // The caller validates too; an address that is not a plain address never reaches the XML.
      if (!isEmail(e)) throw new Error('Недопустимый адрес');
      return `<t:MailboxData><t:Email><t:Address>${xmlText(e)}</t:Address></t:Email><t:AttendeeType>Required</t:AttendeeType><t:ExcludeConflicts>false</t:ExcludeConflicts></t:MailboxData>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>
  </soap:Header>
  <soap:Body>
    <m:GetUserAvailabilityRequest>
      ${timeZoneXml(tz, 'TimeZone')}
      <m:MailboxDataArray>${mailboxes}</m:MailboxDataArray>
      <t:FreeBusyViewOptions>
        <t:TimeWindow><t:StartTime>${owaLocalDate(start)}</t:StartTime><t:EndTime>${owaLocalDate(end)}</t:EndTime></t:TimeWindow>
        <t:MergedFreeBusyIntervalInMinutes>${intervalMinutes}</t:MergedFreeBusyIntervalInMinutes>
        <t:RequestedView>DetailedMerged</t:RequestedView>
      </t:FreeBusyViewOptions>
    </m:GetUserAvailabilityRequest>
  </soap:Body>
</soap:Envelope>`;
}

// ---------- The answer ----------

/** A real answer is a few KB per person; what is read of a bigger one stops here. */
const MAX_XML = 6 * 1024 * 1024;
const MAX_TAG = 4000;
const MAX_DEPTH = 64;
const MAX_TOKENS = 600_000;
/** A subject is shown at MAX_SUBJECT characters; what is read of it before cleaning is bounded too. */
const MAX_SUBJECT_SOURCE = 2000;

type Token = { kind: 'open'; name: string; attrs: string; selfClosing: boolean } | { kind: 'close'; name: string } | { kind: 'text'; text: string };

const ENTITY = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g;

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(ENTITY, (m, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
  });
}

/** The part of a tag name after the namespace prefix. */
const localName = (name: string) => name.slice(name.lastIndexOf(':') + 1);

/**
 * A forward-only tokenizer. Every step moves `pos` past what it looked at, and a missing closing
 * character ends the scan instead of being searched for again from the next "<".
 */
function* tokens(xml: string): Generator<Token> {
  const text = xml.length > MAX_XML ? xml.slice(0, MAX_XML) : xml;
  let pos = 0;
  let count = 0;
  while (pos < text.length && count++ < MAX_TOKENS) {
    const lt = text.indexOf('<', pos);
    if (lt < 0) return;
    if (lt > pos) yield { kind: 'text', text: decodeEntities(text.slice(pos, lt)) };
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) return;
      pos = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) return;
      yield { kind: 'text', text: text.slice(lt + 9, end) };
      pos = end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) return;
      pos = end + 2;
    } else if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) return;
      pos = end + 1;
    } else {
      const gt = text.indexOf('>', lt + 1);
      if (gt < 0) return;
      pos = gt + 1;
      if (gt - lt > MAX_TAG) continue; // not a tag of any protocol: skipped whole, never rescanned
      const inner = text.slice(lt + 1, gt);
      if (inner.startsWith('/')) {
        yield { kind: 'close', name: localName(inner.slice(1).trim()) };
        continue;
      }
      const selfClosing = inner.endsWith('/');
      const body = selfClosing ? inner.slice(0, -1) : inner;
      let n = 0;
      while (n < body.length && !/\s/.test(body[n])) n++;
      yield { kind: 'open', name: localName(body.slice(0, n)), attrs: body.slice(n), selfClosing };
    }
  }
}

const BUSY_TYPES: Record<string, AvailabilityStatus> = { Free: 'free', Tentative: 'tentative', Busy: 'busy', OOF: 'oof', NoData: 'nodata' };

/** Only plain characters of an error code survive: it is shown, and the server wrote it. */
const plainCode = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80);

/** The value of an attribute in a tag's text, found with indexOf (the tag is already cut to one tag). */
function attribute(attrs: string, name: string): string | undefined {
  const at = attrs.indexOf(`${name}=`);
  if (at < 0) return undefined;
  const q = attrs[at + name.length + 1];
  if (q !== '"' && q !== "'") return undefined;
  const end = attrs.indexOf(q, at + name.length + 2);
  return end < 0 ? undefined : attrs.slice(at + name.length + 2, end);
}

interface Response {
  responseClass?: string;
  code?: string;
  merged: string;
  events: AvailabilityEvent[];
}

interface Draft {
  start?: string;
  end?: string;
  busy?: string;
  subject?: string;
  isPrivate?: boolean;
}

export interface ParsedAvailability {
  /** One entry per requested address, in order. */
  people: PersonAvailability[];
  /** Set when the answer held no per-mailbox answers at all and named an error (a SOAP fault). */
  fault?: string;
  /** How many mailboxes the server answered for. */
  answered: number;
}

/**
 * Reads a GetUserAvailabilityResponse. The server answers in the order of the request, so entry
 * `i` is for `emails[i]`. A mailbox without an answer, with an error (no permission, not found) or
 * without a usable string becomes "no data" for that person only; nothing here fails the call.
 */
export function parseAvailabilityResponse(xml: string, emails: readonly string[], windowStart: number, windowEnd: number): ParsedAvailability {
  const expected = slotCount(windowStart, windowEnd);
  const responses: Response[] = [];
  const stack: string[] = [];
  let cur: Response | undefined;
  let ev: Draft | undefined;
  let topCode: string | undefined;

  for (const tok of tokens(xml)) {
    if (tok.kind === 'open') {
      if (stack.length >= MAX_DEPTH) break;
      if (!tok.selfClosing) stack.push(tok.name);
      if (tok.name === 'FreeBusyResponse') {
        cur = { merged: '', events: [] };
        if (responses.length < MAX_MAILBOXES) responses.push(cur);
      } else if (tok.name === 'ResponseMessage' && cur) {
        cur.responseClass = attribute(tok.attrs, 'ResponseClass');
      } else if (tok.name === 'CalendarEvent' && cur) {
        ev = {};
      }
    } else if (tok.kind === 'close') {
      const at = stack.lastIndexOf(tok.name);
      if (at >= 0) stack.length = at;
      if (tok.name === 'CalendarEvent' && cur && ev) {
        // hasOwn: a type called "constructor" or "__proto__" must not find anything on the prototype.
        const status = ev.busy !== undefined && Object.hasOwn(BUSY_TYPES, ev.busy) ? BUSY_TYPES[ev.busy] : undefined;
        const s = parseOwaDate(ev.start);
        const f = parseOwaDate(ev.end);
        if (status && s && f && f > s && cur.events.length < MAX_EVENTS_PER_PERSON) {
          const subject = ev.isPrivate ? undefined : oneLine(ev.subject ?? '', MAX_SUBJECT) || undefined;
          cur.events.push({ start: s.toISOString(), end: f.toISOString(), status, subject });
        }
        ev = undefined;
      } else if (tok.name === 'FreeBusyResponse') {
        cur = undefined;
      }
    } else {
      const parent = stack[stack.length - 1];
      const grand = stack[stack.length - 2];
      const value = tok.text.trim();
      if (!value) continue;
      if (parent === 'ResponseCode') {
        if (cur) cur.code = plainCode(value);
        else topCode ??= plainCode(value);
      } else if (cur && parent === 'MergedFreeBusy') {
        // Only the first MAX_DIGITS characters are kept; the rest is not even appended.
        if (cur.merged.length < MAX_DIGITS) cur.merged = (cur.merged + value).slice(0, MAX_DIGITS);
      } else if (ev && grand === 'CalendarEvent') {
        if (parent === 'StartTime') ev.start = value;
        else if (parent === 'EndTime') ev.end = value;
        else if (parent === 'BusyType') ev.busy = value;
      } else if (ev && grand === 'CalendarEventDetails') {
        if (parent === 'Subject' && (ev.subject?.length ?? 0) < MAX_SUBJECT_SOURCE) ev.subject = ((ev.subject ?? '') + tok.text).slice(0, MAX_SUBJECT_SOURCE);
        else if (parent === 'IsPrivate') ev.isPrivate = value.toLowerCase() === 'true';
      }
    }
  }

  const noData = '4'.repeat(expected);
  const people = emails.map((email, i): PersonAvailability => {
    const r = responses[i];
    const code = r?.code && r.code !== 'NoError' ? r.code : undefined;
    const usable = r && r.responseClass !== 'Error' && r.merged.length > 0;
    if (!usable) return { email, digits: noData, failed: true, error: code ?? (r ? 'NoData' : 'NoResponse') };
    // Unknown characters are "no data"; the string is never longer than the window needs.
    const digits = r.merged.replace(/[^0-4]/g, '4').slice(0, expected || MAX_DIGITS);
    return { email, digits, events: r.events.length ? r.events : undefined };
  });
  return { people, fault: responses.length === 0 ? topCode : undefined, answered: Math.min(responses.length, emails.length) };
}

// ---------- A refusal of the whole call ----------

/**
 * The error code of an EWS SOAP fault (an HTTP 500 whose body names the reason), e.g.
 * "ErrorInvalidTimeInterval": the ResponseCode element in the fault's detail, or else the fault
 * code. Plain characters only; the part of the body that is read is bounded by the caller.
 */
export function soapFaultCode(body: string): string | undefined {
  const text = body.length > 8000 ? body.slice(0, 8000) : body;
  // The element carries a namespace declaration before its ">", so a bounded gap is allowed.
  const code = /ResponseCode[^<>]{0,200}>\s{0,20}(Error[A-Za-z]{2,70})</.exec(text)?.[1] ?? /faultcode[^<>]{0,200}>[^<>]{0,40}?(Error[A-Za-z]{2,70})</.exec(text)?.[1];
  return code;
}

// ---------- The user's own address ----------

const OWN_ADDRESS_KEYS = ['UserEmailAddress', 'PrimarySmtpAddress', 'SmtpAddress'];
const MAX_WALK = 5000;

/**
 * The signed-in user's SMTP address from OWA's own session configuration (the same JSON the OWA
 * page loads at start-up). Searched in a bounded walk; only a plain address is accepted.
 */
export function parseOwnAddress(json: unknown): string | undefined {
  const found: Record<string, string> = {};
  let visited = 0;
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || visited++ > MAX_WALK || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 50)) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
      if (typeof x === 'string' && OWN_ADDRESS_KEYS.includes(k) && !found[k] && isEmail(x.trim())) found[k] = normalizeEmail(x);
      else walk(x, depth + 1);
    }
  };
  walk(json, 0);
  for (const k of OWN_ADDRESS_KEYS) if (found[k]) return found[k];
  return undefined;
}
