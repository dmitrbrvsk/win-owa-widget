// EWS (/EWS/Exchange.asmx) requests and answers for "Create meeting": CreateItem of a CalendarItem
// and ResolveNames for the recipients' directory lookup. Pure functions, unit-tested; the transport,
// the session and the headers are the OwaClient's (the same path as the RSVP in `respond()`).
import type { CreateMeetingInput, EditMeetingInput, MeetingBefore, PersonSuggestion, Recurrence } from '../../shared/types';
import { emailKey, isEmail } from '../../shared/email';
import { oneLine } from '../../shared/text';
import { parseIsoInstant } from '../../shared/validate';
import { OwaError } from './errors';
import { escapeXml } from './payloads';
import { xmlAttr, xmlTokens } from './xml';

const SOAP_NS =
  'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"';

export const CREATE_ITEM_ACTION = '"http://schemas.microsoft.com/exchange/services/2006/messages/CreateItem"';
export const RESOLVE_NAMES_ACTION = '"http://schemas.microsoft.com/exchange/services/2006/messages/ResolveNames"';
export const UPDATE_ITEM_ACTION = '"http://schemas.microsoft.com/exchange/services/2006/messages/UpdateItem"';

// ---------- XML text ----------

/** Characters XML 1.0 cannot carry (controls other than tab, CR, LF; U+FFFE/U+FFFF) and unpaired surrogates, which would break the request. */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Text for an element or attribute: characters XML cannot carry are dropped, then `& < > " '` are escaped. */
export function xmlText(s: string): string {
  return escapeXml(s.replace(NOT_XML, ''));
}

// ---------- CreateItem ----------

/** A Windows time zone id ("Russian Standard Time", "Russia TZ 2 Standard Time"): letters, digits, spaces and a few marks. */
const TIME_ZONE_ID = /^[A-Za-z0-9 .,()'+_/-]{1,100}$/;

/** `2026-10-07T07:00:00Z`: the instant in UTC to the second, from a value that is checked here again. */
function soapInstant(iso: string): string {
  const ms = parseIsoInstant(iso);
  if (ms === null) throw new Error('Недопустимое время встречи');
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function attendees(tag: 'RequiredAttendees' | 'OptionalAttendees', list: readonly string[]): string {
  if (!list.length) return '';
  const items = list
    .map((a) => {
      // The builder does not rely on its caller having validated: only a plain address is ever put into the request.
      if (!isEmail(a)) throw new Error('Недопустимый адрес получателя');
      return `<t:Attendee><t:Mailbox><t:EmailAddress>${xmlText(a)}</t:EmailAddress></t:Mailbox></t:Attendee>`;
    })
    .join('');
  return `<t:${tag}>${items}</t:${tag}>`;
}

/**
 * EWS `CreateItem` of one `CalendarItem`. With recipients, `SendToAllAndSaveCopy` sends the
 * invitations and keeps the meeting in the organizer's calendar; without, `SendToNone` only saves it.
 *
 * Time: Start and End are written as UTC instants with a trailing "Z". EWS documents that a value
 * with "Z" or an offset is always read as that exact instant, whatever else the request says, so a
 * daylight-saving gap or the server's own zone cannot shift the meeting. The Windows zone id the
 * machine uses goes into the `TimeZoneContext` header (the same zone the calendar view is requested
 * in), which on Exchange 2010 SP1 and later becomes the meeting's own time zone: Outlook shows it in
 * the organizer's zone instead of UTC. Without a zone id the header is left out and the item is UTC.
 *
 * Elements follow the order of the EWS schema (xs:sequence): Subject, Body, Start, End, Location,
 * RequiredAttendees, OptionalAttendees. The body is plain text. Every interpolated value passes
 * `xmlText`, so no text can open an element or an attribute of its own.
 */
/** The local calendar day of an instant, as EWS wants a recurrence to start: the day the first occurrence falls on here. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * `<t:Recurrence>`: one pattern element and one range element, in that order, as the schema wants.
 * "weekdays" is a weekly pattern over Monday-Friday rather than a daily one, because a daily pattern
 * would also put the meeting in people's calendars on Saturday and Sunday.
 */
export function recurrenceXml(r: Recurrence | undefined, startIso: string): string {
  // Tolerates a missing recurrence: an older caller (or a test) that knows nothing about series
  // means "does not repeat", which is the one answer that cannot surprise anyone's calendar.
  if (!r || r.kind === 'none' || !r.end) return '';
  const pattern =
    r.kind === 'daily'
      ? '<t:DailyRecurrence><t:Interval>1</t:Interval></t:DailyRecurrence>'
      : r.kind === 'weekdays'
        ? '<t:WeeklyRecurrence><t:Interval>1</t:Interval><t:DaysOfWeek>Monday Tuesday Wednesday Thursday Friday</t:DaysOfWeek></t:WeeklyRecurrence>'
        : `<t:WeeklyRecurrence><t:Interval>${r.kind === 'biweekly' ? 2 : 1}</t:Interval><t:DaysOfWeek>${WEEKDAY_NAMES[new Date(startIso).getDay()]}</t:DaysOfWeek></t:WeeklyRecurrence>`;
  const from = localDay(startIso);
  const range =
    r.end.kind === 'count'
      ? `<t:NumberedRecurrence><t:StartDate>${from}</t:StartDate><t:NumberOfOccurrences>${Math.trunc(r.end.count)}</t:NumberOfOccurrences></t:NumberedRecurrence>`
      : `<t:EndDateRecurrence><t:StartDate>${from}</t:StartDate><t:EndDate>${xmlText(r.end.date)}</t:EndDate></t:EndDateRecurrence>`;
  return `<t:Recurrence>${pattern}${range}</t:Recurrence>`;
}

export function createMeetingSoap(m: CreateMeetingInput, timeZoneId?: string): string {
  const withPeople = m.requiredAttendees.length + m.optionalAttendees.length > 0;
  const zone = timeZoneId && TIME_ZONE_ID.test(timeZoneId) ? `\n    <t:TimeZoneContext><t:TimeZoneDefinition Id="${xmlText(timeZoneId)}"/></t:TimeZoneContext>` : '';
  const parts = [
    `<t:Subject>${xmlText(m.title)}</t:Subject>`,
    m.body ? `<t:Body BodyType="Text">${xmlText(m.body)}</t:Body>` : '',
    `<t:Start>${soapInstant(m.start)}</t:Start>`,
    `<t:End>${soapInstant(m.end)}</t:End>`,
    m.location ? `<t:Location>${xmlText(m.location)}</t:Location>` : '',
    attendees('RequiredAttendees', m.requiredAttendees),
    attendees('OptionalAttendees', m.optionalAttendees),
    recurrenceXml(m.recurrence, m.start),
  ].filter(Boolean);
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope ${SOAP_NS}>
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>${zone}
  </soap:Header>
  <soap:Body>
    <m:CreateItem SendMeetingInvitations="${withPeople ? 'SendToAllAndSaveCopy' : 'SendToNone'}">
      <m:Items>
        <t:CalendarItem>
          ${parts.join('\n          ')}
        </t:CalendarItem>
      </m:Items>
    </m:CreateItem>
  </soap:Body>
</soap:Envelope>`;
}

export type CreateOutcome =
  | { ok: true }
  | {
      ok: false;
      /** EWS ResponseCode, only when it is a plain identifier. */
      code?: string;
      /** `rejected`: Exchange said no. `unexpected`: the answer was not an EWS answer. */
      kind: 'rejected' | 'unexpected';
    };

/** A ResponseCode is an identifier such as `ErrorAccessDenied`; anything else from the server is not repeated anywhere. */
const CODE = /^[A-Za-z][A-Za-z0-9]{2,80}$/;

interface EwsHead {
  responseClass?: string;
  code?: string;
  fault: boolean;
}

/** The first `…ResponseMessage` element's ResponseClass and the first ResponseCode, with any namespace prefix. */
function ewsHead(xml: string): EwsHead {
  const head: EwsHead = { fault: false };
  let wantCode = false;
  for (const tok of xmlTokens(xml)) {
    if (tok.t === 'open') {
      if (tok.name === 'Fault') head.fault = true;
      else if (head.responseClass === undefined && tok.name.endsWith('ResponseMessage')) head.responseClass = xmlAttr(tok.attrs, 'ResponseClass');
      else if (tok.name === 'ResponseCode' && head.code === undefined) wantCode = true;
    } else if (tok.t === 'text' && wantCode) {
      const code = tok.text.trim();
      head.code = CODE.test(code) ? code : undefined;
      wantCode = false;
      if (head.code !== undefined && head.responseClass !== undefined) break;
    } else if (tok.t === 'close' && tok.name === 'ResponseCode') wantCode = false;
  }
  return head;
}

/**
 * Reads the CreateItem answer. Success needs an explicit `ResponseClass="Success"` (and `NoError`):
 * an HTML page, an empty body or a half answer never count as "meeting created".
 */
export function parseCreateItemResponse(xml: string): CreateOutcome {
  const h = ewsHead(xml);
  if (h.responseClass === 'Success' && (h.code === undefined || h.code === 'NoError')) return { ok: true };
  if (h.code && h.code !== 'NoError') return { ok: false, code: h.code, kind: 'rejected' };
  return { ok: false, kind: h.fault || h.responseClass === 'Error' ? 'rejected' : 'unexpected' };
}

/** A time zone Exchange does not know: the request is repeated once without the zone (the instants stay right, the meeting is then in UTC). */
export function isTimeZoneCode(code: string | undefined): boolean {
  return !!code && /TimeZone/i.test(code);
}

const FAILURES: Record<string, string> = {
  ErrorAccessDenied: 'Нет прав на создание встреч в этом календаре',
  ErrorInvalidRecipients: 'Exchange не принял адреса получателей. Проверьте их',
  ErrorInvalidSmtpAddress: 'Exchange не принял один из адресов получателей. Проверьте их',
  ErrorQuotaExceeded: 'Превышена квота почтового ящика',
  ErrorMessageSizeExceeded: 'Описание встречи слишком большое для Exchange',
  ErrorCalendarEndDateIsEarlierThanStartDate: 'Exchange: встреча заканчивается раньше, чем начинается',
  ErrorCalendarDurationIsTooLong: 'Встреча слишком длинная для Exchange',
  ErrorCalendarOutOfRange: 'Дата встречи вне диапазона, который принимает Exchange',
  ErrorInvalidServerVersion: 'Эта версия Exchange не поддерживает создание встреч таким способом',
  ErrorNonExistentMailbox: 'Почтовый ящик не найден',
  ErrorServerBusy: 'Сервер Exchange занят — повторите позже',
  ErrorTimeoutExpired: 'Сервер Exchange не успел ответить — проверьте календарь и повторите позже',
  ErrorMailboxStoreUnavailable: 'Почтовый ящик сейчас недоступен — повторите позже',
  ErrorInternalServerTransientError: 'Временная ошибка сервера Exchange — повторите позже',
  ErrorADUnavailable: 'Каталог Exchange недоступен — повторите позже',
  ErrorConnectionFailed: 'Сервер Exchange не смог соединиться с почтовым ящиком — повторите позже',
};

/** A message for the person, built only from what we know: never the server's own text. */
export function createFailureText(o: Extract<CreateOutcome, { ok: false }>): string {
  if (o.code && FAILURES[o.code]) return FAILURES[o.code];
  if (o.code) return `Exchange не создал встречу (${o.code})`;
  if (o.kind === 'unexpected') return 'Сервер вернул неожиданный ответ. Проверьте календарь, прежде чем отправлять ещё раз';
  return 'Exchange не создал встречу';
}

/** Chromium errors that can only happen before a request left the machine: nothing was created. */
const NOT_SENT = /ERR_(?:NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED)/;

/**
 * A network failure after which the meeting may still exist (a timeout, a connection cut while the
 * answer was on its way). The person is told to look at the calendar before sending again.
 */
export function deliveryUncertain(e: unknown): boolean {
  return e instanceof OwaError && e.kind === 'network' && !(e.detail && NOT_SENT.test(e.detail));
}

// ---------- ResolveNames ----------

/**
 * EWS `ResolveNames` for the recipients field: matches the typed text against the directory (name,
 * alias, address). `ReturnFullContactData="false"`: only the mailbox is needed.
 */
export function resolveNamesSoap(query: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope ${SOAP_NS}>
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>
  </soap:Header>
  <soap:Body>
    <m:ResolveNames ReturnFullContactData="false" SearchScope="ActiveDirectory">
      <m:UnresolvedEntry>${xmlText(query)}</m:UnresolvedEntry>
    </m:ResolveNames>
  </soap:Body>
</soap:Envelope>`;
}

export interface ResolveResult {
  people: PersonSuggestion[];
  code?: string;
}

const MAX_NAME = 100;

/**
 * Reads the mailboxes of a ResolveNames answer: `Name`, `EmailAddress`, `RoutingType` of each
 * `Mailbox`. Names are cleaned to one short line; an entry without a valid SMTP address is dropped
 * (a legacy X.500 address cannot be put into an invitation); repeats go; at most `max` are kept.
 * Exchange answers "several matches" with the class Warning and code ErrorNameResolutionMultipleResults:
 * that is a normal answer here.
 */
export function parseResolveNames(xml: string, max = 8): ResolveResult {
  const head = ewsHead(xml);
  const people: PersonSuggestion[] = [];
  const seen = new Set<string>();
  let box: { name?: string; email?: string; routing?: string } | undefined;
  let field: 'name' | 'email' | 'routing' | undefined;
  const FIELDS = { Name: 'name', EmailAddress: 'email', RoutingType: 'routing' } as const;

  for (const tok of xmlTokens(xml)) {
    if (tok.t === 'open') {
      if (tok.name === 'Mailbox') box = {};
      else if (box && Object.hasOwn(FIELDS, tok.name)) field = FIELDS[tok.name as keyof typeof FIELDS];
      else field = undefined;
    } else if (tok.t === 'text') {
      if (box && field && box[field] === undefined) box[field] = tok.text;
    } else if (tok.name === 'Mailbox' && box) {
      const email = box.email?.trim();
      const routing = box.routing?.trim().toUpperCase();
      if (email && isEmail(email) && (!routing || routing === 'SMTP') && !seen.has(emailKey(email))) {
        seen.add(emailKey(email));
        people.push({ name: oneLine(box.name ?? '', MAX_NAME) || email, email });
        if (people.length >= max) break;
      }
      box = undefined;
      field = undefined;
    } else if (box) field = undefined;
  }
  return { people: people.slice(0, max), code: head.code };
}

/** Response codes of a ResolveNames answer that only mean "nothing (more) to suggest". */
export const RESOLVE_QUIET_CODES: readonly string[] = ['NoError', 'ErrorNameResolutionNoResults', 'ErrorNameResolutionMultipleResults'];

// ---------- UpdateItem: changing a meeting that already exists ----------

/** The fields a change can touch, with the EWS path each one is addressed by. */
const FIELD_URI = {
  title: 'item:Subject',
  body: 'item:Body',
  start: 'calendar:Start',
  end: 'calendar:End',
  location: 'calendar:Location',
  requiredAttendees: 'calendar:RequiredAttendees',
  optionalAttendees: 'calendar:OptionalAttendees',
} as const;

export type MeetingField = keyof typeof FIELD_URI;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());

/**
 * What actually differs between the meeting as it is and the meeting as the person just described it.
 * Only these fields are sent: an UpdateItem that re-sets every field would tell Exchange the meeting
 * changed even when nothing did, and everyone would get a pointless "updated" mail.
 *
 * Start and End travel together: moving one past the other would be refused, and Exchange recalculates
 * the series from both.
 */
export function changedFields(before: MeetingBefore, after: EditMeetingInput): MeetingField[] {
  const out: MeetingField[] = [];
  if (before.title !== after.title) out.push('title');
  if (before.body !== after.body) out.push('body');
  const timeMoved = Date.parse(before.start) !== Date.parse(after.start) || Date.parse(before.end) !== Date.parse(after.end);
  if (timeMoved) out.push('start', 'end');
  if (before.location !== after.location) out.push('location');
  if (!sameList(before.requiredAttendees, after.requiredAttendees)) out.push('requiredAttendees');
  if (!sameList(before.optionalAttendees, after.optionalAttendees)) out.push('optionalAttendees');
  return out;
}

/** The value of one field inside a CalendarItem, as `SetItemField` wants it. */
function fieldValue(field: MeetingField, m: EditMeetingInput): string {
  switch (field) {
    case 'title':
      return `<t:Subject>${xmlText(m.title)}</t:Subject>`;
    case 'body':
      return `<t:Body BodyType="Text">${xmlText(m.body)}</t:Body>`;
    case 'start':
      return `<t:Start>${soapInstant(m.start)}</t:Start>`;
    case 'end':
      return `<t:End>${soapInstant(m.end)}</t:End>`;
    case 'location':
      return `<t:Location>${xmlText(m.location)}</t:Location>`;
    case 'requiredAttendees':
      return attendees('RequiredAttendees', m.requiredAttendees) || '<t:RequiredAttendees/>';
    case 'optionalAttendees':
      return attendees('OptionalAttendees', m.optionalAttendees) || '<t:OptionalAttendees/>';
  }
}

/** Text and location that became empty are deleted rather than set to nothing, which EWS refuses. */
const clearable = (field: MeetingField, m: EditMeetingInput) => (field === 'body' && !m.body) || (field === 'location' && !m.location);

/**
 * EWS `UpdateItem` for one CalendarItem. With attendees, `SendToAllAndSaveCopy` tells them what
 * changed; without, `SendToNone` only rewrites the organizer's own copy. The ChangeKey comes from the
 * server's own last answer, so an update that raced with someone else's is refused instead of
 * overwriting it. `ConflictResolution="AutoResolve"` lets Exchange merge fields nobody here touched.
 */
export function updateMeetingSoap(before: MeetingBefore, after: EditMeetingInput, fields: readonly MeetingField[], timeZoneId?: string): string {
  if (!fields.length) throw new Error('Нечего изменять');
  const withPeople = after.requiredAttendees.length + after.optionalAttendees.length > 0 || before.requiredAttendees.length + before.optionalAttendees.length > 0;
  const zone = timeZoneId && TIME_ZONE_ID.test(timeZoneId) ? `\n    <t:TimeZoneContext><t:TimeZoneDefinition Id="${xmlText(timeZoneId)}"/></t:TimeZoneContext>` : '';
  const ck = before.changeKey ? ` ChangeKey="${xmlText(before.changeKey)}"` : '';
  const updates = fields
    .map((f) =>
      clearable(f, after)
        ? `<t:DeleteItemField><t:FieldURI FieldURI="${FIELD_URI[f]}"/></t:DeleteItemField>`
        : `<t:SetItemField><t:FieldURI FieldURI="${FIELD_URI[f]}"/><t:CalendarItem>${fieldValue(f, after)}</t:CalendarItem></t:SetItemField>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope ${SOAP_NS}>
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>${zone}
  </soap:Header>
  <soap:Body>
    <m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve" SendMeetingInvitationsOrCancellations="${withPeople ? 'SendToAllAndSaveCopy' : 'SendToNone'}">
      <m:ItemChanges>
        <t:ItemChange>
          <t:ItemId Id="${xmlText(before.id)}"${ck}/>
          <t:Updates>${updates}</t:Updates>
        </t:ItemChange>
      </m:ItemChanges>
    </m:UpdateItem>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * EWS cancellation: a `CancelCalendarItem` that refers to the meeting. `SendAndSaveCopy` is what puts
 * the "cancelled" notice in every attendee's mailbox — the meeting is not merely deleted from one
 * calendar, which would leave it standing in everybody else's.
 */
export function cancelMeetingSoap(id: string, changeKey: string | undefined): string {
  const ck = changeKey ? ` ChangeKey="${xmlText(changeKey)}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope ${SOAP_NS}>
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>
  </soap:Header>
  <soap:Body>
    <m:CreateItem MessageDisposition="SendAndSaveCopy">
      <m:Items>
        <t:CancelCalendarItem>
          <t:ReferenceItemId Id="${xmlText(id)}"${ck}/>
        </t:CancelCalendarItem>
      </m:Items>
    </m:CreateItem>
  </soap:Body>
</soap:Envelope>`;
}

const UPDATE_FAILURES: Record<string, string> = {
  ErrorIrresolvableConflict: 'Встречу изменил кто-то ещё. Обновите календарь и повторите',
  ErrorStaleObject: 'Встречу изменил кто-то ещё. Обновите календарь и повторите',
  ErrorItemNotFound: 'Встреча больше не найдена на сервере — возможно, её уже удалили',
  ErrorCannotDeleteObject: 'Exchange не дал изменить эту встречу',
  ErrorIncorrectUpdatePropertyCount: 'Exchange не принял это изменение',
};

/** A message for the person about a change that did not go through: never the server's own text. */
export function updateFailureText(o: Extract<CreateOutcome, { ok: false }>): string {
  if (o.code && UPDATE_FAILURES[o.code]) return UPDATE_FAILURES[o.code];
  if (o.code && FAILURES[o.code]) return FAILURES[o.code];
  if (o.code) return `Exchange не изменил встречу (${o.code})`;
  if (o.kind === 'unexpected') return 'Сервер вернул неожиданный ответ. Проверьте календарь, прежде чем менять встречу ещё раз';
  return 'Exchange не изменил встречу';
}
