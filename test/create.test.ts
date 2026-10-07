// "Create meeting": addresses, validation, the EWS request and answers, the confirmation text and
// the gate that puts the confirmation in front of every send.
import { describe, expect, it } from 'vitest';
import { dedupeEmails, isEmail, parseAddressList } from '../src/shared/email';
import { parseCreateMeeting, parseCreatePrefill, parseIsoInstant, parsePeopleQuery, sanitizeEvents } from '../src/shared/validate';
import { MAX_BODY_SHOWN, MAX_FIELD_SHOWN, MAX_LISTED_RECIPIENTS, formatWhen, meetingConfirmText } from '../src/shared/meetingConfirm';
import {
  defaultSlot,
  endsNextDay,
  localDate,
  localPeople,
  matchPeople,
  mergeSuggestions,
  shiftTime,
  slotFromPrefill,
  slotMinutes,
  slotRange,
  withDuration,
  withEnd,
  withStart,
} from '../src/shared/meetingForm';
import {
  CREATE_ITEM_ACTION,
  createFailureText,
  createMeetingSoap,
  deliveryUncertain,
  isTimeZoneCode,
  parseCreateItemResponse,
  parseResolveNames,
  resolveNamesSoap,
  xmlText,
} from '../src/main/owa/ewsMeeting';
import { decodeXmlText, xmlAttr, xmlTokens } from '../src/main/owa/xml';
import { OwaError } from '../src/main/owa/errors';
import { mapCalendarItem } from '../src/main/owa/parse';
import { MAX_MEETINGS_PER_HOUR, MAX_PROMPTS_PER_10_MIN, MAX_RECIPIENTS_PER_HOUR, MeetingGate, SlidingWindow } from '../src/main/meetingGate';
import type { CreateMeetingInput } from '../src/shared/types';

const NOW = new Date('2026-10-07T08:00:00Z');

const time = (fn: () => unknown) => {
  const t = Date.now();
  fn();
  return Date.now() - t;
};

const valid = (over: Record<string, unknown> = {}) => ({
  title: 'Синк по релизу',
  start: '2026-10-08T07:00:00.000Z',
  end: '2026-10-08T07:30:00.000Z',
  requiredAttendees: ['i.ivanov@example.com'],
  optionalAttendees: [],
  location: '',
  body: '',
  recurrence: { kind: 'none' as const },
  ...over,
});

function meeting(over: Partial<CreateMeetingInput> = {}): CreateMeetingInput {
  return { title: 'Синк', start: '2026-10-08T07:00:00.000Z', end: '2026-10-08T07:30:00.000Z', requiredAttendees: ['a@example.com'], optionalAttendees: [], location: '', body: '', recurrence: { kind: 'none' }, ...over };
}

describe('e-mail addresses', () => {
  it('accepts plain ASCII addresses', () => {
    for (const ok of ['ivan@example.com', 'i.ivanov+tag@sub.example.co.uk', "o'brien@example.ie", 'a_b-c@x-y.example.org', 'Ivan.Ivanov@EXAMPLE.COM']) expect(isEmail(ok), ok).toBe(true);
  });

  it('refuses look-alike addresses written in other alphabets (a Cyrillic "а" passes for a Latin "a" in the confirmation dialog)', () => {
    for (const bad of ['иван@почта.рф', 'ivan@exаmple.com', 'ivаn@example.com', 'ivan@example.cоm']) expect(isEmail(bad), bad).toBe(false);
  });

  it('refuses everything else', () => {
    const bad = [
      '',
      'a',
      'a@b',
      'a@@b.c',
      '@x.ru',
      'a@.ru',
      'a@x..ru',
      'a@x.ru.',
      'a b@x.ru',
      ' a@x.ru',
      'a@x.ru ',
      'a@x.ru\n',
      'a@x.ru\r\nBcc: e@x.ru',
      '"a b"@x.ru',
      'a..b@x.ru',
      '.a@x.ru',
      'a.@x.ru',
      'a@-x.ru',
      'a@x-.ru',
      'a@1.2.3.4',
      'a@[::1]',
      'a<b>@x.ru',
      'a@x.ru>',
      'a,b@x.ru',
      'a;b@x.ru',
      'a\u202e@x.ru', // bidi override
      'a\u0000@x.ru',
      'a\u200b@x.ru', // zero-width space
      'a@x.r\u0443\u202e',
      `${'a'.repeat(65)}@x.ru`,
      `a@${'b'.repeat(64)}.ru`,
      `a@${'b.'.repeat(130)}ru`,
    ];
    for (const b of bad) expect(isEmail(b), JSON.stringify(b)).toBe(false);
    for (const nonString of [null, undefined, 5, {}, ['a@x.ru']]) expect(isEmail(nonString)).toBe(false);
  });

  it('keeps the limit of 254 characters', () => {
    const local = 'a'.repeat(64);
    const label = 'b'.repeat(63);
    const long = `${local}@${label}.${label}.${label}.com`; // 64 + 1 + 63*3 + 3 + 4 = 261
    expect(long.length).toBeGreaterThan(254);
    expect(isEmail(long)).toBe(false);
    expect(isEmail(`${local}@${label}.${label}.com`)).toBe(true); // 64 + 1 + 63 + 1 + 63 + 4 = 196
  });

  it('is fast on hostile input', () => {
    expect(time(() => isEmail('a'.repeat(1_000_000) + '@x.ru'))).toBeLessThan(300);
    expect(time(() => isEmail('a.'.repeat(120) + '@x.ru'))).toBeLessThan(300);
    expect(time(() => isEmail(`${'a'.repeat(60)}@${'-'.repeat(240)}`))).toBeLessThan(300);
    expect(time(() => isEmail(`${'a-'.repeat(30)}!@${'b'.repeat(60)}.${'-'.repeat(100)}`))).toBeLessThan(300);
    expect(time(() => parseAddressList('.'.repeat(20_000) + 'x'))).toBeLessThan(1000);
    expect(time(() => parseAddressList('<'.repeat(20_000)))).toBeLessThan(1000);
    expect(time(() => parseAddressList('a@'.repeat(10_000)))).toBeLessThan(1500);
    expect(time(() => parseAddressList(('a@b.c' + ' ').repeat(100_000)))).toBeLessThan(500);
  });

  it('removes repeats case-insensitively and keeps the first spelling', () => {
    expect(dedupeEmails(['Ivan@X.ru', 'petr@x.ru', 'ivan@x.RU'])).toEqual(['Ivan@X.ru', 'petr@x.ru']);
  });
});

describe('pasted address lists', () => {
  it('reads commas, semicolons, spaces and line breaks', () => {
    const p = parseAddressList('a@x.ru, b@x.ru;c@x.ru\nd@x.ru\r\ne@x.ru   f@x.ru');
    expect(p.addresses).toEqual(['a@x.ru', 'b@x.ru', 'c@x.ru', 'd@x.ru', 'e@x.ru', 'f@x.ru']);
    expect(p.invalid).toEqual([]);
  });

  it('reads the form Outlook copies: names are ignored', () => {
    const p = parseAddressList('Иван Иванов <ivan@example.com>; "Петров, Пётр" <petr@example.com>; (anna@example.com)');
    expect(p.addresses).toEqual(['ivan@example.com', 'petr@example.com', 'anna@example.com']);
    expect(p.hadText).toBe(true);
  });

  it('collects what looks like an address but is not, and tells "nothing" from "no address"', () => {
    const p = parseAddressList('good@x.ru, bad@, @nope.ru, a@b');
    expect(p.addresses).toEqual(['good@x.ru']);
    expect(p.invalid).toEqual(['bad@', '@nope.ru', 'a@b']);
    expect(parseAddressList('   ,; ').hadText).toBe(false);
    expect(parseAddressList('Иван Иванов')).toEqual({ addresses: [], invalid: [], hadText: true });
  });

  it('removes repeats, takes mailto: and trailing dots, and cuts a huge paste', () => {
    expect(parseAddressList('mailto:a@x.ru, A@X.RU, a@x.ru.').addresses).toEqual(['a@x.ru']);
    const many = Array.from({ length: 5000 }, (_, i) => `u${i}@example.com`).join(',');
    expect(parseAddressList(many).addresses.length).toBeLessThanOrEqual(1000);
  });
});

describe('ISO instants', () => {
  it('needs a zone and a real date', () => {
    expect(parseIsoInstant('2026-10-07T07:00:00Z')).toBe(Date.UTC(2026, 9, 7, 7));
    expect(parseIsoInstant('2026-10-07T10:00:00+03:00')).toBe(Date.UTC(2026, 9, 7, 7));
    expect(parseIsoInstant('2026-10-07T10:00:00.5+03:00')).toBe(Date.UTC(2026, 9, 7, 7, 0, 0, 500));
    expect(parseIsoInstant('2026-10-07T06:30-01:00')).toBe(Date.UTC(2026, 9, 7, 7, 30));
    for (const bad of ['2026-10-07T07:00:00', '2026-10-07', 'garbage', '', '2026-02-31T10:00:00Z', '2026-13-01T10:00:00Z', '2026-10-07T24:00:00Z', '2026-10-07T23:60:00Z', '2026-10-07T10:00:00+24:00', '1969-01-01T00:00:00Z', ' 2026-10-07T07:00:00Z', '2026-10-07T07:00:00Z\n']) {
      expect(parseIsoInstant(bad), bad).toBeNull();
    }
    for (const nonString of [20261007, null, undefined, {}, ['2026-10-07T07:00:00Z']]) expect(parseIsoInstant(nonString)).toBeNull();
  });
});

describe('parseCreateMeeting', () => {
  it('accepts a normal meeting and rebuilds it field by field', () => {
    const m = parseCreateMeeting({ ...valid({ start: '2026-10-08T10:00:00+03:00', end: '2026-10-08T10:30:00+03:00', evil: 'x', __proto__: { polluted: 1 } }) }, NOW);
    expect(m).toEqual({
      title: 'Синк по релизу',
      start: '2026-10-08T07:00:00.000Z',
      end: '2026-10-08T07:30:00.000Z',
      requiredAttendees: ['i.ivanov@example.com'],
      optionalAttendees: [],
      location: '',
      body: '',
      recurrence: { kind: 'none' },
    });
    expect(Object.keys(m).sort()).toEqual(['body', 'end', 'location', 'optionalAttendees', 'recurrence', 'requiredAttendees', 'start', 'title']);
  });

  it('trims, removes repeats across both lists and prefers required', () => {
    const m = parseCreateMeeting(valid({ title: '  Ретро  ', requiredAttendees: [' A@x.ru ', 'a@X.ru', 'b@x.ru'], optionalAttendees: ['B@x.ru', 'c@x.ru', 'C@x.ru'] }), NOW);
    expect(m.title).toBe('Ретро');
    expect(m.requiredAttendees).toEqual(['A@x.ru', 'b@x.ru']);
    expect(m.optionalAttendees).toEqual(['c@x.ru']);
  });

  it('allows a meeting with nobody invited', () => {
    expect(parseCreateMeeting(valid({ requiredAttendees: [], optionalAttendees: undefined }), NOW).requiredAttendees).toEqual([]);
    expect(parseCreateMeeting({ title: 'x', start: '2026-10-08T07:00:00Z', end: '2026-10-08T08:00:00Z' }, NOW).location).toBe('');
  });

  it('allows 100 recipients and refuses 101', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@example.com`);
    expect(parseCreateMeeting(valid({ requiredAttendees: list(60), optionalAttendees: list(100).slice(60) }), NOW).requiredAttendees).toHaveLength(60);
    expect(() => parseCreateMeeting(valid({ requiredAttendees: list(101) }), NOW)).toThrow(/получател|адрес/i);
    expect(() => parseCreateMeeting(valid({ requiredAttendees: list(60), optionalAttendees: list(101).slice(60) }), NOW)).toThrow(/получател/i);
    // repeats do not count twice
    expect(parseCreateMeeting(valid({ requiredAttendees: Array(300).fill('a@x.ru') }), NOW).requiredAttendees).toEqual(['a@x.ru']);
    expect(() => parseCreateMeeting(valid({ requiredAttendees: Array(401).fill('a@x.ru') }), NOW)).toThrow();
  });

  it('refuses addresses that are not plain addresses, injected line breaks included', () => {
    const bad = ['not-an-email', 'a@b', 'x@y.ru\r\nBcc: evil@x.ru', 'Ivan <i@x.ru>', 'a@x.ru,b@x.ru', '', 5, null, { email: 'a@x.ru' }];
    for (const b of bad) expect(() => parseCreateMeeting(valid({ requiredAttendees: [b] }), NOW), JSON.stringify(b)).toThrow();
    expect(() => parseCreateMeeting(valid({ requiredAttendees: 'a@x.ru' }), NOW)).toThrow();
    expect(() => parseCreateMeeting(valid({ optionalAttendees: ['a@x.ru', 'oops'] }), NOW)).toThrow();
  });

  it('puts the title and the place on one line without hidden characters', () => {
    const m = parseCreateMeeting(valid({ title: 'Hello\r\nBcc: x@y.ru\u0000\u202e\u0007', location: 'Room\n 5\u2066' }), NOW);
    expect(m.title).toBe('Hello Bcc: x@y.ru');
    expect(m.location).toBe('Room 5');
    expect(m.title).not.toMatch(/[\r\n\u0000\u202e]/);
  });

  it('keeps line breaks in the description, as plain LF, without hidden characters', () => {
    expect(parseCreateMeeting(valid({ body: 'a\r\nb\rc\n\u0000d\u202e' }), NOW).body).toBe('a\nb\nc\nd');
  });

  it('enforces the length limits instead of cutting', () => {
    expect(parseCreateMeeting(valid({ title: 'я'.repeat(500) }), NOW).title).toHaveLength(500);
    expect(() => parseCreateMeeting(valid({ title: 'я'.repeat(501) }), NOW)).toThrow(/500/);
    expect(() => parseCreateMeeting(valid({ title: '   ' }), NOW)).toThrow();
    expect(() => parseCreateMeeting(valid({ title: undefined }), NOW)).toThrow();
    expect(() => parseCreateMeeting(valid({ title: 'x'.repeat(100_000) }), NOW)).toThrow();
    expect(() => parseCreateMeeting(valid({ location: 'x'.repeat(501) }), NOW)).toThrow(/500/);
    expect(parseCreateMeeting(valid({ body: 'x'.repeat(20_000) }), NOW).body).toHaveLength(20_000);
    expect(() => parseCreateMeeting(valid({ body: 'x'.repeat(20_001) }), NOW)).toThrow(/20000/);
    expect(() => parseCreateMeeting(valid({ body: 'x'.repeat(1_000_000) }), NOW)).toThrow();
    for (const t of [5, {}, ['a'], true]) expect(() => parseCreateMeeting(valid({ title: t }), NOW)).toThrow();
  });

  it('wants start before end, at most a week, within two years', () => {
    expect(() => parseCreateMeeting(valid({ start: '2026-10-08T08:00:00Z', end: '2026-10-08T07:00:00Z' }), NOW)).toThrow(/позже/);
    expect(() => parseCreateMeeting(valid({ start: '2026-10-08T08:00:00Z', end: '2026-10-08T08:00:00Z' }), NOW)).toThrow(/позже/);
    expect(parseCreateMeeting(valid({ start: '2026-10-08T08:00:00Z', end: '2026-10-15T08:00:00Z' }), NOW).end).toBe('2026-10-15T08:00:00.000Z');
    expect(() => parseCreateMeeting(valid({ start: '2026-10-08T08:00:00Z', end: '2026-10-15T08:00:01Z' }), NOW)).toThrow(/7 суток/);
    expect(() => parseCreateMeeting(valid({ start: '2029-10-08T08:00:00Z', end: '2029-10-08T09:00:00Z' }), NOW)).toThrow(/двух лет/);
    expect(() => parseCreateMeeting(valid({ start: '2022-10-08T08:00:00Z', end: '2022-10-08T09:00:00Z' }), NOW)).toThrow(/двух лет/);
    expect(parseCreateMeeting(valid({ start: '2028-09-01T08:00:00Z', end: '2028-09-01T09:00:00Z' }), NOW).start).toBe('2028-09-01T08:00:00.000Z');
  });

  it('refuses dates that are not ISO instants with a zone', () => {
    const bad = ['2026-10-08T07:00:00', 'tomorrow', '2026-02-31T10:00:00Z', '', 1791360000000, null, undefined, {}, '2026-10-08T07:00:00Z; DROP'];
    for (const b of bad) {
      expect(() => parseCreateMeeting(valid({ start: b }), NOW), String(b)).toThrow();
      expect(() => parseCreateMeeting(valid({ end: b }), NOW), String(b)).toThrow();
    }
  });

  it('refuses a request that is not an object', () => {
    for (const raw of [null, undefined, 'x', 5, [], [valid()]]) expect(() => parseCreateMeeting(raw, NOW)).toThrow();
  });
});

describe('parseCreatePrefill', () => {
  it('takes the contract fields and normalizes them', () => {
    expect(parseCreatePrefill({ start: '2026-10-08T10:00:00+03:00', end: '2026-10-08T10:45:00+03:00', attendees: ['A@x.ru', 'a@x.ru', 'b@x.ru'], title: ' Синк\n' })).toEqual({
      title: 'Синк',
      attendees: ['A@x.ru', 'b@x.ru'],
      start: '2026-10-08T07:00:00.000Z',
      end: '2026-10-08T07:45:00.000Z',
    });
    expect(parseCreatePrefill(undefined)).toEqual({});
    expect(parseCreatePrefill(null)).toEqual({});
    expect(parseCreatePrefill({})).toEqual({});
    expect(parseCreatePrefill({ start: '2026-10-08T07:00:00Z' })).toEqual({ start: '2026-10-08T07:00:00.000Z' });
  });

  it('is strict: a wrong value is an error for the caller', () => {
    const bad: unknown[] = [
      'x',
      5,
      [],
      { start: 'tomorrow' },
      { start: '2026-10-08T07:00:00' },
      { end: 5 },
      { start: '2026-10-08T08:00:00Z', end: '2026-10-08T07:00:00Z' },
      { start: '2026-10-08T08:00:00Z', end: '2026-10-09T08:00:00Z' },
      { attendees: 'a@x.ru' },
      { attendees: ['nope'] },
      { attendees: Array.from({ length: 101 }, (_, i) => `u${i}@example.com`) },
      { attendees: [5] },
      { title: 'x'.repeat(501) },
      { title: 5 },
    ];
    for (const b of bad) expect(() => parseCreatePrefill(b), JSON.stringify(b)).toThrow();
    expect(parseCreatePrefill({ attendees: Array.from({ length: 100 }, (_, i) => `u${i}@example.com`) }).attendees).toHaveLength(100);
  });
});

describe('parsePeopleQuery', () => {
  it('gives one clean line of 2 to 100 characters, or null', () => {
    expect(parsePeopleQuery('  Иван\n Иванов ')).toBe('Иван Иванов');
    expect(parsePeopleQuery('и')).toBeNull();
    expect(parsePeopleQuery('  ')).toBeNull();
    expect(parsePeopleQuery('x'.repeat(500))).toHaveLength(100);
    expect(parsePeopleQuery('ab\u202e\u0000')).toBe('ab');
    expect(() => parsePeopleQuery(5)).toThrow();
    expect(() => parsePeopleQuery('x'.repeat(5000))).toThrow();
  });
});

describe('the XML text of a request', () => {
  it('escapes markup, quotes and CDATA tricks', () => {
    expect(xmlText(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
    expect(xmlText(']]><t:Evil/>')).toBe(']]&gt;&lt;t:Evil/&gt;');
    expect(xmlText('<![CDATA[x]]>')).toBe('&lt;![CDATA[x]]&gt;');
  });

  it('drops what XML cannot carry', () => {
    expect(xmlText('a\u0000b\u0001c\ufffed\uffffe')).toBe('abcde');
    expect(xmlText('a\ud800b')).toBe('ab'); // an unpaired surrogate
    expect(xmlText('😀 \t\n')).toBe('😀 \t\n'); // a proper pair, tab and line feed stay
  });
});

describe('CreateItem request', () => {
  const names = (xml: string) => [...xmlTokens(xml)].filter((t) => t.t === 'open').map((t) => (t as { name: string }).name);
  /** The text directly inside the element with this name (an envelope's own `Body` has only whitespace and is skipped). */
  const textOf = (xml: string, name: string) => {
    const stack: string[] = [];
    let found = '';
    let current = '';
    for (const t of xmlTokens(xml)) {
      if (t.t === 'open') {
        stack.push(t.name);
        if (t.name === name) current = '';
      } else if (t.t === 'text') {
        if (stack[stack.length - 1] === name) current += t.text;
      } else {
        if (t.name === name) {
          if (current.trim()) found = current;
          current = ''; // the envelope's own `Body` must not inherit the item's text
        }
        stack.pop();
      }
    }
    return found;
  };

  it('is a CalendarItem with the invitations sent to everybody and a copy saved', () => {
    const xml = createMeetingSoap(meeting({ requiredAttendees: ['a@example.com', 'b@example.com'], optionalAttendees: ['c@example.com'], location: 'Байкал', body: 'Повестка' }), 'Russian Standard Time');
    expect(xml).toContain('<m:CreateItem SendMeetingInvitations="SendToAllAndSaveCopy">');
    expect(xml).toContain('<t:RequestServerVersion Version="Exchange2013_SP1"/>');
    expect(xml).toContain('<t:Subject>Синк</t:Subject>');
    expect(xml).toContain('<t:Body BodyType="Text">Повестка</t:Body>');
    expect(xml).toContain('<t:Location>Байкал</t:Location>');
    expect(xml).toMatch(/<t:RequiredAttendees><t:Attendee><t:Mailbox><t:EmailAddress>a@example.com<\/t:EmailAddress><\/t:Mailbox><\/t:Attendee><t:Attendee><t:Mailbox><t:EmailAddress>b@example.com<\/t:EmailAddress><\/t:Mailbox><\/t:Attendee><\/t:RequiredAttendees>/);
    expect(xml).toMatch(/<t:OptionalAttendees><t:Attendee><t:Mailbox><t:EmailAddress>c@example.com<\/t:EmailAddress><\/t:Mailbox><\/t:Attendee><\/t:OptionalAttendees>/);
    expect(CREATE_ITEM_ACTION).toBe('"http://schemas.microsoft.com/exchange/services/2006/messages/CreateItem"');
  });

  it('follows the order of the EWS schema', () => {
    const xml = createMeetingSoap(meeting({ optionalAttendees: ['c@example.com'], location: 'L', body: 'B' }), 'UTC');
    const order = ['Subject', 'Body', 'Start', 'End', 'Location', 'RequiredAttendees', 'OptionalAttendees'].map((n) => xml.indexOf(`<t:${n}`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('writes the times as UTC instants with Z, whatever offset the input had', () => {
    expect(createMeetingSoap(meeting({ start: '2026-10-08T07:00:00.000Z', end: '2026-10-08T07:30:00.000Z' }))).toMatch(/<t:Start>2026-10-08T07:00:00Z<\/t:Start>\s*<t:End>2026-10-08T07:30:00Z<\/t:End>/);
    expect(createMeetingSoap(meeting({ start: '2026-10-08T10:00:00+03:00', end: '2026-10-08T23:59:59-05:00' }))).toMatch(/<t:Start>2026-10-08T07:00:00Z<\/t:Start>\s*<t:End>2026-10-09T04:59:59Z<\/t:End>/);
    // a meeting across midnight keeps its real end
    expect(createMeetingSoap(meeting({ start: '2026-10-08T20:30:00Z', end: '2026-10-08T21:30:00Z' }))).toContain('<t:End>2026-10-08T21:30:00Z</t:End>');
    expect(createMeetingSoap(meeting())).not.toMatch(/<t:(Start|End)>[^<]*[+-]\d\d:\d\d</);
  });

  it('puts the Windows time zone into TimeZoneContext, and leaves it out when it is not a plain id', () => {
    expect(createMeetingSoap(meeting(), 'Russian Standard Time')).toContain('<t:TimeZoneContext><t:TimeZoneDefinition Id="Russian Standard Time"/></t:TimeZoneContext>');
    expect(createMeetingSoap(meeting(), 'Russia TZ 2 Standard Time')).toContain('Id="Russia TZ 2 Standard Time"');
    expect(createMeetingSoap(meeting())).not.toContain('TimeZoneContext');
    expect(createMeetingSoap(meeting(), '"/><t:Evil/>')).not.toContain('TimeZoneContext');
    expect(createMeetingSoap(meeting(), 'x'.repeat(500))).not.toContain('TimeZoneContext');
  });

  it('only saves the meeting when nobody is invited', () => {
    const xml = createMeetingSoap(meeting({ requiredAttendees: [], optionalAttendees: [] }));
    expect(xml).toContain('SendMeetingInvitations="SendToNone"');
    expect(xml).not.toContain('Attendees');
    expect(xml).not.toContain('<t:Body');
    expect(xml).not.toContain('<t:Location');
  });

  it('cannot be broken out of by what the person typed', () => {
    const evil = '</t:Subject><t:Evil a="1"/>"\'&<![CDATA[x]]>';
    const xml = createMeetingSoap(meeting({ title: evil, location: evil, body: `${evil}\n${evil}` }), 'UTC');
    expect(xml).not.toContain('<t:Evil');
    expect(xml).not.toContain('<![CDATA[');
    expect(names(xml).filter((n) => n === 'Evil')).toEqual([]);
    expect(names(xml).filter((n) => n === 'Subject')).toHaveLength(1);
    // one Body of the item (the other `Body` is the SOAP envelope's own)
    expect(xml.match(/<t:Body\b/g)).toHaveLength(1);
    expect(names(xml).filter((n) => n === 'Body')).toHaveLength(2);
    expect(names(xml).filter((n) => n === 'Location')).toHaveLength(1);
    // read back through the tokenizer, the text is exactly what was typed
    expect(textOf(xml, 'Subject')).toBe(evil);
    expect(textOf(xml, 'Location')).toBe(evil);
    expect(textOf(xml, 'Body')).toBe(`${evil}\n${evil}`);
  });

  it('refuses an address or a time that is not valid, even from a careless caller', () => {
    for (const a of ['a@x.ru"><t:Evil/>', 'a@x.ru</t:EmailAddress>', 'nope', 'a@x.ru\nb@x.ru']) {
      expect(() => createMeetingSoap(meeting({ requiredAttendees: [a] })), a).toThrow();
      expect(() => createMeetingSoap(meeting({ optionalAttendees: [a] })), a).toThrow();
    }
    for (const t of ['2026-10-08T07:00:00', 'x', '<t:Evil/>', '2026-02-31T10:00:00Z']) {
      expect(() => createMeetingSoap(meeting({ start: t })), t).toThrow();
      expect(() => createMeetingSoap(meeting({ end: t })), t).toThrow();
    }
  });

  it('strips characters XML cannot carry from the text', () => {
    const xml = createMeetingSoap(meeting({ title: 'a\u0001b\uffffc', body: 'x\u0000y' }));
    expect(xml).toContain('<t:Subject>abc</t:Subject>');
    expect(xml).toContain('>xy</t:Body>');
  });
});

describe('CreateItem answer', () => {
  const wrap = (body: string) =>
    `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</s:Body></s:Envelope>`;
  const success = wrap(
    '<m:CreateItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><m:ResponseMessages><m:CreateItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items><t:CalendarItem><t:ItemId Id="AAMkA" ChangeKey="DwAAA"/></t:CalendarItem></m:Items></m:CreateItemResponseMessage></m:ResponseMessages></m:CreateItemResponse>',
  );
  const failure = (code: string, cls = 'Error') =>
    wrap(`<m:CreateItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><m:ResponseMessages><m:CreateItemResponseMessage ResponseClass="${cls}"><m:MessageText>Long text with details</m:MessageText><m:ResponseCode>${code}</m:ResponseCode><m:DescriptiveLinkKey>0</m:DescriptiveLinkKey></m:CreateItemResponseMessage></m:ResponseMessages></m:CreateItemResponse>`);

  it('is a success only for ResponseClass Success', () => {
    expect(parseCreateItemResponse(success)).toEqual({ ok: true });
    // other prefixes, and a default namespace
    expect(parseCreateItemResponse(success.replaceAll('m:', 'ns1:'))).toEqual({ ok: true });
    expect(parseCreateItemResponse(success.replaceAll('m:', '').replace('xmlns:', 'xmlns='))).toEqual({ ok: true });
    expect(parseCreateItemResponse(success.replace('ResponseClass="Success"', "ResponseClass='Success'"))).toEqual({ ok: true });
  });

  it('reads the error code of a refusal', () => {
    expect(parseCreateItemResponse(failure('ErrorAccessDenied'))).toEqual({ ok: false, code: 'ErrorAccessDenied', kind: 'rejected' });
    expect(parseCreateItemResponse(failure('ErrorInvalidRecipients'))).toMatchObject({ ok: false, code: 'ErrorInvalidRecipients' });
    // Success with a failing code, or a failing class with NoError, is not a success
    expect(parseCreateItemResponse(failure('ErrorServerBusy', 'Success'))).toMatchObject({ ok: false, code: 'ErrorServerBusy' });
    expect(parseCreateItemResponse(failure('NoError', 'Error'))).toMatchObject({ ok: false, kind: 'rejected' });
    expect(parseCreateItemResponse(failure('NoError', 'Warning'))).toMatchObject({ ok: false, kind: 'unexpected' });
  });

  it('reads a SOAP fault', () => {
    const fault = wrap('<s:Fault><faultcode xmlns:a="http://schemas.microsoft.com/exchange/services/2006/types">a:ErrorInvalidServerVersion</faultcode><faultstring xml:lang="en-US">The specified server version is invalid.</faultstring><detail><e:ResponseCode xmlns:e="http://schemas.microsoft.com/exchange/services/2006/errors">ErrorInvalidServerVersion</e:ResponseCode></detail></s:Fault>');
    expect(parseCreateItemResponse(fault)).toEqual({ ok: false, code: 'ErrorInvalidServerVersion', kind: 'rejected' });
    expect(parseCreateItemResponse(wrap('<s:Fault><faultcode>s:Client</faultcode></s:Fault>'))).toEqual({ ok: false, kind: 'rejected' });
  });

  it('is never a success for garbage', () => {
    const garbage = ['', ' ', 'OK', '{"ok":true}', '<html><body><form action="/owa/auth.owa"><input name="password"></form></body></html>', '<<<<<', '<m:ResponseMessages></m:ResponseMessages>', wrap(''), '<?xml version="1.0"?>', '<![CDATA[ResponseClass="Success"', '<!-- <m:CreateItemResponseMessage ResponseClass="Success"> -->', '\u0000\u0001', 'ResponseClass="Success"'];
    for (const g of garbage) expect(parseCreateItemResponse(g).ok, g.slice(0, 40)).toBe(false);
    expect(parseCreateItemResponse('<html></html>')).toEqual({ ok: false, kind: 'unexpected' });
    // a success hidden in text or a comment is not an element
    expect(parseCreateItemResponse(wrap('<p>&lt;m:CreateItemResponseMessage ResponseClass="Success"&gt;</p>')).ok).toBe(false);
  });

  it('does not repeat what the server wrote', () => {
    // a ResponseCode that is not a plain identifier is ignored: never shown, never logged
    for (const code of ['Error Access Denied', 'Error&lt;script&gt;alert(1)&lt;/script&gt;', 'E'.repeat(500), 'Ошибка', '../../x']) {
      const out = parseCreateItemResponse(failure(code));
      expect(out).toMatchObject({ ok: false });
      expect((out as { code?: string }).code).toBeUndefined();
    }
    const text = createFailureText({ ok: false, kind: 'rejected' });
    expect(text).not.toContain('Long text');
    expect(createFailureText({ ok: false, code: 'ErrorSomethingNew', kind: 'rejected' })).toBe('Exchange не создал встречу (ErrorSomethingNew)');
    expect(createFailureText({ ok: false, code: 'ErrorAccessDenied', kind: 'rejected' })).toMatch(/прав/);
    expect(createFailureText({ ok: false, kind: 'unexpected' })).toMatch(/Проверьте календарь/);
  });

  it('knows a time zone refusal and an uncertain delivery', () => {
    expect(isTimeZoneCode('ErrorTimeZone')).toBe(true);
    expect(isTimeZoneCode('ErrorInvalidTimeZone')).toBe(true);
    expect(isTimeZoneCode('ErrorAccessDenied')).toBe(false);
    expect(isTimeZoneCode(undefined)).toBe(false);
    // not reached the server: certain; a timeout or a cut connection: uncertain
    expect(deliveryUncertain(new OwaError('network', 'x', undefined, 'net::ERR_NAME_NOT_RESOLVED'))).toBe(false);
    expect(deliveryUncertain(new OwaError('network', 'x', undefined, 'net::ERR_CONNECTION_REFUSED'))).toBe(false);
    expect(deliveryUncertain(new OwaError('network', 'Сервер не ответил вовремя'))).toBe(true);
    expect(deliveryUncertain(new OwaError('network', 'Соединение прервано'))).toBe(true);
    expect(deliveryUncertain(new OwaError('network', 'x', undefined, 'net::ERR_CONNECTION_RESET'))).toBe(true);
    expect(deliveryUncertain(new OwaError('auth', 'x'))).toBe(false);
    expect(deliveryUncertain(new Error('x'))).toBe(false);
  });
});

describe('ResolveNames', () => {
  const entry = (name: string, email: string, routing = 'SMTP') =>
    `<t:Resolution><t:Mailbox><t:Name>${name}</t:Name><t:EmailAddress>${email}</t:EmailAddress><t:RoutingType>${routing}</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox><t:Contact><t:DisplayName>${name}</t:DisplayName><t:EmailAddresses><t:Entry Key="EmailAddress1">SMTP:${email}</t:Entry></t:EmailAddresses><t:ContactSource>ActiveDirectory</t:ContactSource></t:Contact></t:Resolution>`;
  const answer = (entries: string, cls = 'Success', code = 'NoError') =>
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ResolveNamesResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages"><m:ResponseMessages><m:ResolveNamesResponseMessage ResponseClass="${cls}"><m:ResponseCode>${code}</m:ResponseCode><m:ResolutionSet TotalItemsInView="2" IncludesLastItemInRange="true">${entries}</m:ResolutionSet></m:ResolveNamesResponseMessage></m:ResponseMessages></ResolveNamesResponse></soap:Body></soap:Envelope>`;

  it('asks the directory with the typed text escaped', () => {
    const xml = resolveNamesSoap('Иван <&"> ]]>');
    expect(xml).toContain('<m:ResolveNames ReturnFullContactData="false" SearchScope="ActiveDirectory">');
    expect(xml).toContain('<m:UnresolvedEntry>Иван &lt;&amp;&quot;&gt; ]]&gt;</m:UnresolvedEntry>');
    expect(xml).not.toContain('<![CDATA[');
  });

  it('reads name and address of each mailbox', () => {
    const r = parseResolveNames(answer(entry('Иван Иванов', 'i.ivanov@example.com') + entry('Иван Петров', 'ivan.petrov@example.com')));
    expect(r.people).toEqual([
      { name: 'Иван Иванов', email: 'i.ivanov@example.com' },
      { name: 'Иван Петров', email: 'ivan.petrov@example.com' },
    ]);
    expect(r.code).toBe('NoError');
  });

  it('treats "several matches" as a normal answer and keeps at most 8', () => {
    const many = Array.from({ length: 100 }, (_, i) => entry(`Человек ${i}`, `p${i}@example.com`)).join('');
    const r = parseResolveNames(answer(many, 'Warning', 'ErrorNameResolutionMultipleResults'));
    expect(r.people).toHaveLength(8);
    expect(r.people[0].email).toBe('p0@example.com');
    expect(r.code).toBe('ErrorNameResolutionMultipleResults');
    expect(parseResolveNames(answer(many), 3).people).toHaveLength(3);
  });

  it('answers "nothing found" with no people and the code', () => {
    const none = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><m:ResolveNamesResponse xmlns:m="x"><m:ResponseMessages><m:ResolveNamesResponseMessage ResponseClass="Error"><m:MessageText>No results were found.</m:MessageText><m:ResponseCode>ErrorNameResolutionNoResults</m:ResponseCode></m:ResolveNamesResponseMessage></m:ResponseMessages></m:ResolveNamesResponse></s:Body></s:Envelope>`;
    expect(parseResolveNames(none)).toEqual({ people: [], code: 'ErrorNameResolutionNoResults' });
    expect(parseResolveNames('')).toEqual({ people: [], code: undefined });
    expect(parseResolveNames('<html>nope</html>').people).toEqual([]);
  });

  it('cleans names, and drops anything that cannot go into an invitation', () => {
    const r = parseResolveNames(
      answer(
        entry('Evil\u202e Name\u0000\nLine two', 'good@example.com') +
          entry('X.500 user', '/o=Corp/ou=Exchange/cn=Recipients/cn=user', 'EX') +
          entry('Legacy', 'legacy@example.com', 'EX') +
          entry('Broken', 'not-an-email') +
          entry('Header injection', 'a@x.ru\r\nBcc: e@x.ru') +
          entry('Duplicate', 'GOOD@example.com') +
          entry('', 'noname@example.com') +
          entry('Tom &amp; Jerry &#1103; &lt;b&gt;', 'tom@example.com') +
          entry('Л'.repeat(500), 'long@example.com'),
      ),
    );
    expect(r.people.map((p) => p.email)).toEqual(['good@example.com', 'noname@example.com', 'tom@example.com', 'long@example.com']);
    expect(r.people[0].name).toBe('Evil Name Line two');
    expect(r.people[1].name).toBe('noname@example.com');
    expect(r.people[2].name).toBe('Tom & Jerry я <b>');
    expect(r.people[3].name).toHaveLength(100);
    for (const p of r.people) expect(p.name).not.toMatch(/[\u0000-\u001f\u202e]/);
  });

  it('reads CDATA and any namespace prefix, and ignores the Contact part', () => {
    const r = parseResolveNames('<x:ResolutionSet xmlns:x="u"><x:Resolution><x:Mailbox><x:Name><![CDATA[Иван <И.>]]></x:Name><x:EmailAddress>i@example.com</x:EmailAddress></x:Mailbox><x:Contact><x:EmailAddress>other@example.com</x:EmailAddress><x:Name>Other</x:Name></x:Contact></x:Resolution></x:ResolutionSet>');
    expect(r.people).toEqual([{ name: 'Иван <И.>', email: 'i@example.com' }]);
  });

  it('survives hostile XML in linear time', () => {
    const hostile: Array<[string, string]> = [
      ['unclosed Mailbox', '<t:Mailbox>'.repeat(200_000)],
      ['open angle brackets', '<'.repeat(1_000_000)],
      ['deep nesting', '<a>'.repeat(300_000)],
      ['one huge text', `<t:Mailbox><t:Name>${'x'.repeat(5_000_000)}</t:Name><t:EmailAddress>a@x.ru</t:EmailAddress></t:Mailbox>`],
      ['many tiny tags', '<t:Name/>'.repeat(300_000)],
      ['entity bomb', `<!DOCTYPE x [${'<!ENTITY a "aaaaaaaaaa">'.repeat(2000)}]><t:Mailbox><t:Name>&a;&a;&a;</t:Name><t:EmailAddress>a@x.ru</t:EmailAddress></t:Mailbox>`],
      ['comments', '<!--'.repeat(300_000)],
      ['cdata', '<![CDATA['.repeat(300_000)],
      ['attribute soup', `<t:Mailbox ${'a="b" '.repeat(500_000)}>`],
      ['prototype names', '<t:Mailbox><constructor>x</constructor><__proto__>y</__proto__><toString>z</toString></t:Mailbox>'],
    ];
    for (const [name, xml] of hostile) {
      let r: ReturnType<typeof parseResolveNames> | undefined;
      const ms = time(() => (r = parseResolveNames(xml)));
      expect(ms, name).toBeLessThan(1500);
      expect(r!.people.length, name).toBeLessThanOrEqual(8);
      expect(parseCreateItemResponse(xml).ok, name).toBe(false);
    }
    // the bomb is not expanded: the entity stays text, the name is whatever literal text is there
    const bomb = parseResolveNames(`<!DOCTYPE x [<!ENTITY a "${'a'.repeat(1000)}">]><t:Mailbox><t:Name>&a;</t:Name><t:EmailAddress>a@x.ru</t:EmailAddress></t:Mailbox>`);
    expect(bomb.people[0].name.length).toBeLessThan(300);
  });
});

describe('XML tokenizer', () => {
  it('yields tags, text, CDATA and skips comments, declarations and DOCTYPE', () => {
    const toks = [...xmlTokens('<?xml version="1.0"?><!DOCTYPE a><!-- c --><a:b x="1">t&amp;u<c/><![CDATA[<raw>]]></a:b>')];
    expect(toks).toEqual([
      { t: 'open', name: 'b', attrs: 'x="1"', selfClosing: false },
      { t: 'text', text: 't&u' },
      { t: 'open', name: 'c', attrs: '', selfClosing: true },
      { t: 'text', text: '<raw>' },
      { t: 'close', name: 'b' },
    ]);
  });

  it('stops at a tag that never closes', () => {
    expect([...xmlTokens('<a>text<b')]).toEqual([{ t: 'open', name: 'a', attrs: '', selfClosing: false }, { t: 'text', text: 'text' }]);
  });

  it('reads attributes in either quote style and decodes entities', () => {
    expect(xmlAttr('ResponseClass="Success" x="1"', 'ResponseClass')).toBe('Success');
    expect(xmlAttr("a:ResponseClass='Er&amp;ror'", 'ResponseClass')).toBe('Er&ror');
    expect(xmlAttr('xResponseClass="no"', 'ResponseClass')).toBeUndefined();
    expect(decodeXmlText('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#0;&#xD800;&bogus;')).toBe('<>&"\'AB&#0;&#xD800;&bogus;');
  });
});

describe('confirmation text', () => {
  it('says how many people get an invitation, in the right case', () => {
    const msg = (n: number) => meetingConfirmText(meeting({ requiredAttendees: Array.from({ length: n }, (_, i) => `u${i}@example.com`) }), 'ru').message;
    expect(msg(1)).toBe('Отправить приглашение 1 участнику?');
    expect(msg(2)).toBe('Отправить приглашение 2 участникам?');
    expect(msg(5)).toBe('Отправить приглашение 5 участникам?');
    expect(msg(11)).toBe('Отправить приглашение 11 участникам?');
    expect(msg(21)).toBe('Отправить приглашение 21 участнику?');
    expect(meetingConfirmText(meeting(), 'en').message).toBe('Send an invitation to 1 attendee?');
  });

  it('shows the subject, the time, the place and every recipient, optional ones marked', () => {
    const t = meetingConfirmText(meeting({ title: 'Ретро', location: 'Байкал', requiredAttendees: ['a@example.com'], optionalAttendees: ['b@example.com'] }), 'ru', 'UTC');
    expect(t.detail).toContain('Тема: Ретро');
    expect(t.detail).toMatch(/Когда: .*2026.*07:00–07:30/);
    expect(t.detail).toContain('Место: Байкал');
    expect(t.detail).toContain('• a@example.com\n');
    expect(t.detail).toContain('• b@example.com (необязательный)');
    expect(t.buttons).toEqual(['Отмена', 'Отправить']);
    expect(meetingConfirmText(meeting(), 'en').buttons).toEqual(['Cancel', 'Send']);
  });

  it('shows the beginning of the description as one clipped line, and nothing when there is none', () => {
    const none = meetingConfirmText(meeting({ body: '' }), 'ru');
    expect(none.detail).not.toContain('Описание');
    expect(meetingConfirmText(meeting({ body: '   \n ' }), 'ru').detail).not.toContain('Описание');
    const long = meetingConfirmText(meeting({ body: 'Повестка:\n1. Итоги\u202e\u0000\n' + 'я'.repeat(5000) }), 'ru');
    const line = long.detail.split('\n').find((l) => l.startsWith('Описание: '))!;
    expect(line).toContain('Повестка: 1. Итоги');
    expect(long.detail).not.toMatch(/[\u0000\u202e]/);
    // Clipped, and it says so: the reader must not take the first 200 characters for the whole text.
    expect(line).toContain('…');
    expect(line).toMatch(/всего 5\d{3} символов/);
    expect(line.length).toBeLessThanOrEqual('Описание: '.length + MAX_BODY_SHOWN + 40);
    expect(meetingConfirmText(meeting({ body: 'Agenda' }), 'en').detail).toContain('Description: Agenda');
  });

  it('cannot be made to look empty or short with invisible characters', () => {
    // A title padded with zero-width spaces used to leave "Тема:" looking blank while the real
    // subject went out in full; the marks that reorder digits were kept as well.
    const padded = '\u200b'.repeat(130) + 'Перевод 500 000 ₽ подрядчику';
    const t = meetingConfirmText(meeting({ title: padded, body: '\u200e\u200f\u00ad' + 'x'.repeat(400) }), 'ru');
    expect(t.detail).not.toMatch(/[\u200b-\u200f\u00ad\u2060\ufeff]/);
    expect(t.detail).toContain('Тема: Перевод 500 000 ₽ подрядчику');
    expect(t.detail).toMatch(/Описание: x+… \(всего 40\d символов\)/);
  });

  it('lists the first 15 recipients and says how many more', () => {
    const list = Array.from({ length: 40 }, (_, i) => `u${i}@example.com`);
    const t = meetingConfirmText(meeting({ requiredAttendees: list.slice(0, 30), optionalAttendees: list.slice(30) }), 'ru');
    expect(t.detail.match(/^• /gm)).toHaveLength(MAX_LISTED_RECIPIENTS);
    expect(t.detail).toContain('… и ещё 25');
    expect(t.detail).toContain('Получат приглашение (40):');
    expect(t.detail).not.toContain('u15@example.com');
    expect(meetingConfirmText(meeting({ requiredAttendees: list.slice(0, 15) }), 'ru').detail).not.toContain('и ещё');
    expect(meetingConfirmText(meeting({ requiredAttendees: list.slice(0, 16) }), 'en').detail).toContain('… and 1 more');
  });

  it('keeps a hostile title to one clean line', () => {
    const t = meetingConfirmText(meeting({ title: 'A\n\nОтправить приглашение 1 участнику?\u202e\u0000' + 'x'.repeat(1000) }), 'ru');
    const titleLine = t.detail.split('\n')[0];
    expect(titleLine.length).toBeLessThanOrEqual(MAX_FIELD_SHOWN + 60);
    expect(t.detail.split('\n')[1]).toMatch(/^Когда: /);
    expect(t.detail).not.toMatch(/[\u0000\u202e]/);
  });

  it('writes a meeting across midnight with both days', () => {
    expect(formatWhen('2026-10-08T20:30:00Z', '2026-10-08T22:00:00Z', 'ru', 'UTC')).toMatch(/20:30–22:00/);
    // 22:30 UTC is already the next morning in Tokyo, but 23:30 → 00:30 still crosses midnight in UTC
    expect(formatWhen('2026-10-08T22:30:00Z', '2026-10-08T23:30:00Z', 'ru', 'Asia/Tokyo')).toMatch(/07:30–08:30/);
    const across = formatWhen('2026-10-08T22:30:00Z', '2026-10-09T00:30:00Z', 'ru', 'UTC');
    expect(across).toMatch(/8 октября.*22:30 – .*9 октября.*00:30/);
  });
});

describe('MeetingGate: nothing is sent without the person', () => {
  function setup(opts: { answer?: boolean | 'pending' } = {}) {
    const calls = { confirm: [] as CreateMeetingInput[], deliver: [] as CreateMeetingInput[] };
    let release: (v: boolean) => void = () => {};
    let clock = Date.parse('2026-10-07T08:00:00Z');
    const gate = new MeetingGate({
      now: () => clock,
      confirm: (m) => {
        calls.confirm.push(m);
        if (opts.answer === 'pending') return new Promise<boolean>((r) => (release = r));
        return Promise.resolve(opts.answer ?? true);
      },
      deliver: async (m) => void calls.deliver.push(m),
    });
    return { gate, calls, release: (v: boolean) => release(v), advance: (ms: number) => (clock += ms) };
  }
  const input = (over: Record<string, unknown> = {}) => valid({ start: '2026-10-08T07:00:00.000Z', end: '2026-10-08T07:30:00.000Z', ...over });

  it('asks first, with the validated meeting, then delivers', async () => {
    const { gate, calls } = setup();
    expect(await gate.submit(input({ title: '  Синк  ' }))).toEqual({ status: 'created', invited: 1 });
    expect(calls.confirm).toHaveLength(1);
    expect(calls.confirm[0].title).toBe('Синк'); // what is asked is what is validated, not what was sent
    expect(calls.deliver).toEqual(calls.confirm);
  });

  it('does not deliver when the person says no', async () => {
    const { gate, calls } = setup({ answer: false });
    expect(await gate.submit(input())).toEqual({ status: 'cancelled' });
    expect(calls.confirm).toHaveLength(1);
    expect(calls.deliver).toHaveLength(0);
  });

  it('does not deliver while the question is open, and refuses a second request meanwhile', async () => {
    const { gate, calls, release } = setup({ answer: 'pending' });
    // The gate validates before it asks, so the question appears a few microtasks in; "busy" holds from the first one.
    const asked = async (n: number) => {
      for (let i = 0; i < 50 && calls.confirm.length < n; i++) await Promise.resolve();
    };
    const first = gate.submit(input());
    await asked(1);
    await expect(gate.submit(input({ title: 'Другая' }))).rejects.toThrow(/ещё выполняется/);
    await expect(gate.submit(input({ requiredAttendees: [] }))).rejects.toThrow(/ещё выполняется/);
    expect(calls.confirm).toHaveLength(1);
    expect(calls.deliver).toHaveLength(0);
    release(true);
    expect(await first).toEqual({ status: 'created', invited: 1 });
    expect(calls.deliver).toHaveLength(1);
    // and afterwards a new one is accepted again (it asks again, and this time the person agrees at once)
    const next = gate.submit(input());
    await asked(2);
    release(true);
    expect(await next).toEqual({ status: 'created', invited: 1 });
    expect(calls.confirm).toHaveLength(2);
  });

  it('checks the input before asking anything', async () => {
    const { gate, calls } = setup();
    for (const bad of [null, 'x', input({ title: '' }), input({ requiredAttendees: ['nope'] }), input({ end: '2026-10-08T06:00:00Z' }), input({ start: 'tomorrow' })]) {
      await expect(gate.submit(bad)).rejects.toThrow();
    }
    expect(calls.confirm).toHaveLength(0);
    expect(calls.deliver).toHaveLength(0);
  });

  it('saves a meeting nobody is invited to without asking', async () => {
    const { gate, calls } = setup();
    expect(await gate.submit(input({ requiredAttendees: [], optionalAttendees: [] }))).toEqual({ status: 'created', invited: 0 });
    expect(calls.confirm).toHaveLength(0);
    expect(calls.deliver).toHaveLength(1);
  });

  it('lets a failed delivery through as an error and is usable afterwards', async () => {
    let fail = true;
    const gate = new MeetingGate({
      confirm: async () => true,
      deliver: async () => {
        if (fail) throw new Error('Exchange не создал встречу');
      },
      now: () => Date.parse('2026-10-07T08:00:00Z'),
    });
    await expect(gate.submit(input())).rejects.toThrow('Exchange не создал встречу');
    fail = false;
    expect((await gate.submit(input())).status).toBe('created');
  });

  it('sends at most 10 meetings an hour, and starts again after the hour', async () => {
    const { gate, calls, advance } = setup();
    for (let i = 0; i < MAX_MEETINGS_PER_HOUR; i++) expect((await gate.submit(input())).status).toBe('created');
    await expect(gate.submit(input())).rejects.toThrow(/Слишком много встреч/);
    expect(calls.deliver).toHaveLength(MAX_MEETINGS_PER_HOUR);
    advance(3_600_001);
    expect((await gate.submit(input())).status).toBe('created');
  });

  it('counts recipients too: a few big meetings cannot spam', async () => {
    const { gate, calls } = setup();
    const crowd = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}@example.com`);
    for (let i = 0; i < MAX_RECIPIENTS_PER_HOUR / 100; i++) await gate.submit(input({ requiredAttendees: crowd(100, `g${i}-`) }));
    await expect(gate.submit(input({ requiredAttendees: crowd(1, 'one') }))).rejects.toThrow(/Слишком много приглашений/);
    expect(calls.deliver).toHaveLength(3);
    expect(calls.confirm).toHaveLength(3); // the refusal came before a question the person would have had to answer
  });

  it('does not let a page keep opening the question', async () => {
    const { gate, calls } = setup({ answer: false });
    for (let i = 0; i < MAX_PROMPTS_PER_10_MIN; i++) expect((await gate.submit(input())).status).toBe('cancelled');
    await expect(gate.submit(input())).rejects.toThrow(/Слишком много запросов/);
    expect(calls.confirm).toHaveLength(MAX_PROMPTS_PER_10_MIN);
  });

  it('does not count a cancelled or refused meeting as sent', async () => {
    const { gate } = setup({ answer: false });
    for (let i = 0; i < 5; i++) await gate.submit(input());
    const ok = setup();
    for (let i = 0; i < MAX_MEETINGS_PER_HOUR; i++) expect((await ok.gate.submit(input())).status).toBe('created');
  });
});

describe('SlidingWindow', () => {
  it('counts what is inside the window and weighs entries', () => {
    const w = new SlidingWindow(5, 1000);
    expect(w.allows(0, 5)).toBe(true);
    expect(w.allows(0, 6)).toBe(false);
    w.take(0, 3);
    w.take(500, 2);
    expect(w.allows(600)).toBe(false);
    expect(w.used(600)).toBe(5);
    expect(w.used(1000)).toBe(2); // the first entry is a full window old
    expect(w.allows(1000, 3)).toBe(true);
    expect(w.used(1500)).toBe(0);
  });
});

describe('form dates and times', () => {
  const at = (h: number, m: number, d = 7) => new Date(2026, 9, d, h, m);

  it('reads local dates and refuses ones that do not exist', () => {
    expect(localDate('2026-10-07', '10:30')).toEqual(at(10, 30));
    expect(localDate('2026-10-07', '23:30', 1)).toEqual(at(23, 30, 8));
    for (const [d, t] of [['2026-02-31', '10:00'], ['2026-13-01', '10:00'], ['2026-10-07', '24:00'], ['2026-10-07', '10:60'], ['2026-10-07', ''], ['', '10:00'], ['2026-10-7', '10:00'], ['2026-10-07', '9:00']]) expect(localDate(d, t), `${d} ${t}`).toBeNull();
  });

  it('puts an end earlier than the start on the next day, and refuses an equal one', () => {
    const r = slotRange({ date: '2026-10-07', start: '23:30', end: '00:30' })!;
    expect(r.start).toEqual(at(23, 30));
    expect(r.end).toEqual(at(0, 30, 8));
    expect(slotMinutes({ date: '2026-10-07', start: '23:30', end: '00:30' })).toBe(60);
    expect(endsNextDay({ date: '2026-10-07', start: '23:30', end: '00:30' })).toBe(true);
    expect(endsNextDay({ date: '2026-10-07', start: '10:00', end: '11:00' })).toBe(false);
    expect(slotRange({ date: '2026-10-07', start: '10:00', end: '10:00' })).toBeNull();
    expect(slotRange({ date: '2026-10-07', start: '', end: '10:00' })).toBeNull();
    expect(slotMinutes({ date: '2026-10-07', start: '10:00', end: '11:45' })).toBe(105);
  });

  it('wraps times around midnight', () => {
    expect(shiftTime('23:30', 60)).toBe('00:30');
    expect(shiftTime('00:10', -20)).toBe('23:50');
    expect(shiftTime('10:00', 45)).toBe('10:45');
    expect(shiftTime('', 45)).toBe('');
  });

  it('offers the next half hour, and tomorrow morning late in the evening', () => {
    expect(defaultSlot(at(10, 12))).toEqual({ date: '2026-10-07', start: '10:30', end: '11:00', duration: 30 });
    expect(defaultSlot(at(10, 30))).toEqual({ date: '2026-10-07', start: '11:00', end: '11:30', duration: 30 });
    expect(defaultSlot(at(0, 0)).start).toBe('00:30');
    expect(defaultSlot(at(23, 29))).toEqual({ date: '2026-10-07', start: '23:30', end: '00:00', duration: 30 });
    expect(defaultSlot(at(23, 40))).toEqual({ date: '2026-10-08', start: '09:00', end: '09:30', duration: 30 });
  });

  it('makes the end follow the start, and the quick buttons set the length', () => {
    const s = { date: '2026-10-07', start: '10:00', end: '10:30', duration: 30 };
    expect(withStart(s, '14:00')).toMatchObject({ start: '14:00', end: '14:30' });
    expect(withDuration(s, 45)).toMatchObject({ end: '10:45', duration: 45 });
    // the length chosen by hand is kept when the start moves
    const longer = withEnd(s, '11:15');
    expect(longer.duration).toBe(75);
    expect(withStart(longer, '16:00')).toMatchObject({ start: '16:00', end: '17:15' });
    // late start: the end crosses midnight
    expect(withStart(withDuration(s, 60), '23:30')).toMatchObject({ start: '23:30', end: '00:30' });
    // an emptied start field does not lose the length
    const blank = withStart(s, '');
    expect(withStart(blank, '09:00')).toMatchObject({ start: '09:00', end: '09:30' });
  });

  it('starts from a prefill', () => {
    const p = slotFromPrefill({ start: at(14, 0, 9).toISOString(), end: at(14, 45, 9).toISOString() }, at(10, 0));
    expect(p).toEqual({ date: '2026-10-09', start: '14:00', end: '14:45', duration: 45 });
    expect(slotFromPrefill({ start: at(14, 0, 9).toISOString() }, at(10, 0)).duration).toBe(30);
    expect(slotFromPrefill({}, at(10, 12)).start).toBe('10:30');
    expect(slotFromPrefill({ start: 'garbage' }, at(10, 12)).start).toBe('10:30');
    // a day or more is shortened to what the form can show; a reversed range gets the default
    expect(slotFromPrefill({ start: at(9, 0).toISOString(), end: at(9, 0, 9).toISOString() }, at(8, 0)).duration).toBe(1439);
    expect(slotFromPrefill({ start: at(9, 0).toISOString(), end: at(8, 0).toISOString() }, at(8, 0)).duration).toBe(30);
  });
});

describe('suggestions', () => {
  const ev = (organizer: string, organizerEmail?: string) => ({ organizer, organizerEmail }) as never;
  const people = [
    { name: 'Иван Иванов', email: 'i.ivanov@example.com' },
    { name: 'Мария Соколова', email: 'm.sokolova@example.com' },
    { name: 'Алексей Петров', email: 'a.petrov@example.com' },
  ];

  it('collects organizers with an address, most frequent first', () => {
    const list = localPeople([ev('Мария Соколова', 'm.sokolova@example.com'), ev('Иван Иванов', 'i.ivanov@example.com'), ev('Мария Соколова', 'M.Sokolova@example.com'), ev('Без адреса'), ev('Аноним', undefined)]);
    expect(list).toEqual([
      { name: 'Мария Соколова', email: 'm.sokolova@example.com' },
      { name: 'Иван Иванов', email: 'i.ivanov@example.com' },
    ]);
  });

  it('matches name or address, needs two characters and skips people already added', () => {
    expect(matchPeople(people, 'ив', new Set(), 8).map((p) => p.name)).toEqual(['Иван Иванов']);
    expect(matchPeople(people, 'petrov', new Set(), 8).map((p) => p.name)).toEqual(['Алексей Петров']);
    expect(matchPeople(people, 'и', new Set(), 8)).toEqual([]);
    expect(matchPeople(people, 'ив', new Set(['i.ivanov@example.com']), 8)).toEqual([]);
    expect(matchPeople(people, 'example', new Set(), 2)).toHaveLength(2);
  });

  it('merges meetings first, then the directory, without repeats, at most 8', () => {
    const remote = [{ name: 'Иван И.', email: 'I.IVANOV@example.com' }, ...Array.from({ length: 20 }, (_, i) => ({ name: `Р${i}`, email: `r${i}@example.com` }))];
    const merged = mergeSuggestions([people[0]], remote, new Set(['r0@example.com']));
    expect(merged).toHaveLength(8);
    expect(merged[0]).toEqual(people[0]);
    expect(merged.map((p) => p.email.toLowerCase()).filter((e) => e === 'i.ivanov@example.com')).toHaveLength(1);
    expect(merged.some((p) => p.email === 'r0@example.com')).toBe(false);
  });
});

describe('organizer address from the calendar', () => {
  const base = { ItemId: { Id: 'A', ChangeKey: 'K' }, Subject: 'Синк', Start: '2026-10-07T10:00:00+03:00', End: '2026-10-07T10:30:00+03:00' };

  it('keeps an SMTP address and drops anything else', () => {
    const mailbox = (box: object) => mapCalendarItem({ ...base, Organizer: { Mailbox: { Name: 'Иван Иванов', ...box } } })!;
    expect(mailbox({ EmailAddress: 'i.ivanov@example.com', RoutingType: 'SMTP' }).organizerEmail).toBe('i.ivanov@example.com');
    expect(mailbox({ EmailAddress: 'i.ivanov@example.com' }).organizerEmail).toBe('i.ivanov@example.com');
    expect(mailbox({ EmailAddress: '/o=Corp/cn=ivanov', RoutingType: 'EX' }).organizerEmail).toBeUndefined();
    expect(mailbox({ EmailAddress: 'a@x.ru\nBcc: b@x.ru', RoutingType: 'SMTP' }).organizerEmail).toBeUndefined();
    expect(mailbox({}).organizerEmail).toBeUndefined();
    expect(mapCalendarItem(base)!.organizerEmail).toBeUndefined();
  });

  it('survives the cache round trip, validated again', () => {
    const e = mapCalendarItem({ ...base, Organizer: { Mailbox: { Name: 'Иван Иванов', EmailAddress: 'i.ivanov@example.com' } } })!;
    expect(sanitizeEvents([e])[0].organizerEmail).toBe('i.ivanov@example.com');
    expect(sanitizeEvents([{ ...e, organizerEmail: 'x@y.ru\nBcc: z@y.ru' }])[0].organizerEmail).toBeUndefined();
    expect(sanitizeEvents([{ ...e, organizerEmail: 5 }])[0].organizerEmail).toBeUndefined();
  });
});
