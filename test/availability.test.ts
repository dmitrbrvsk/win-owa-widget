import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isEmail, parseEmailList } from '../src/shared/email';
import {
  availabilityFromEvents,
  bestOptions,
  buildGrid,
  LUNCH,
  MAX_DIGITS,
  slotCount,
  statusOfDigit,
  weekStart,
  weekWindow,
  type GridOptions,
  type GridPersonInput,
} from '../src/shared/availability';
import { parseAvailabilityRequest } from '../src/shared/validate';
import { availabilityTimeZone, MAX_MAILBOXES, parseAvailabilityResponse, parseOwnAddress, soapFaultCode, userAvailabilitySoap, xmlText } from '../src/main/owa/availability';
import { escapeXml } from '../src/main/owa/payloads';
import { RequestGate } from '../src/main/limits';
import { demoAvailability } from '../src/main/demo';
import type { CalendarEvent } from '../src/shared/types';

// Local times are made with the Date constructor, so the tests run in a fixed zone: the same
// answers on a developer machine and on CI. (Moscow has no daylight saving; Berlin is used where it matters.)
const realTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Moscow';
});
afterAll(() => {
  if (realTZ === undefined) delete process.env.TZ;
  else process.env.TZ = realTZ;
});

const time = (fn: () => unknown) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

// ---------- e-mail addresses ----------

describe('e-mail addresses', () => {
  it('accepts plain addresses and refuses everything else', () => {
    for (const ok of ['ivan.ivanov@example.com', 'i@x.ru', 'a+b_c-d@mail.corp.example.ru', "o'brien@example.org", 'USER@EXAMPLE.COM']) expect(isEmail(ok), ok).toBe(true);
    const bad = ['', 'a', '@x.ru', 'a@', 'a@b', 'a@@b.ru', 'a b@c.ru', 'a@b..ru', '.a@b.ru', 'a.@b.ru', 'a..b@c.ru', 'a@-b.ru', 'a@b-.ru', 'a@b.ru>', '<a@b.ru', 'a@b.ru\n', 'a@b.ru</t:Address>', 'иван@компания.рф', `${'a'.repeat(65)}@b.ru`, `a@${'b'.repeat(64)}.ru`, `${'a'.repeat(250)}@b.ru`, 'a@b.c'.repeat(60)];
    for (const x of bad) expect(isEmail(x), x.slice(0, 30)).toBe(false);
    expect(isEmail(42)).toBe(false);
    expect(isEmail(null)).toBe(false);
    expect(isEmail({ toString: () => 'a@b.ru' })).toBe(false);
  });

  it('reads a pasted list: commas, semicolons, new lines, spaces and "Name <address>"', () => {
    const r = parseEmailList('Иван Иванов <Ivan@Corp.ru>; "Petrov, Petr" <petr@corp.ru>,\nmaria@corp.ru anna@corp.ru\r\n\r\nmailto:boris@corp.ru', 20);
    expect(r.valid).toEqual(['ivan@corp.ru', 'petr@corp.ru', 'maria@corp.ru', 'anna@corp.ru', 'boris@corp.ru']);
    expect(r.invalid).toEqual([]);
  });

  it('drops duplicates (any case), reports broken addresses, ignores bare words, counts the overflow', () => {
    const r = parseEmailList('a@x.ru, A@X.RU, nobody, b@@x.ru, c@x.ru, d@x.ru', 2, ['c@x.ru']);
    expect(r.valid).toEqual(['a@x.ru', 'd@x.ru']);
    expect(r.invalid).toEqual(['b@@x.ru']);
    expect(r.overflow).toBe(0);
    const many = parseEmailList(Array.from({ length: 30 }, (_, i) => `u${i}@x.ru`).join(';'), 20);
    expect(many.valid).toHaveLength(20);
    expect(many.overflow).toBe(10);
  });

  it('is linear on hostile text', () => {
    expect(time(() => parseEmailList('"'.repeat(20_000), 20))).toBeLessThan(500);
    expect(time(() => parseEmailList("'a".repeat(10_000) + '@', 20))).toBeLessThan(500);
    expect(time(() => parseEmailList('<'.repeat(20_000), 20))).toBeLessThan(500);
    expect(time(() => parseEmailList('@'.repeat(20_000), 20))).toBeLessThan(500);
    expect(time(() => parseEmailList('a@b.'.repeat(5_000), 20))).toBeLessThan(500);
    expect(time(() => parseEmailList('a'.repeat(250) + '@' + 'b.'.repeat(120), 20))).toBeLessThan(300);
    expect(time(() => parseEmailList(`${'a@b.ru,'.repeat(100_000)}`, 20))).toBeLessThan(1000);
    expect(time(() => isEmail('a@' + ('b'.repeat(61) + '.').repeat(3) + '!'))).toBeLessThan(300);
  });
});

// ---------- the request ----------

describe('GetUserAvailability request', () => {
  const start = new Date(2026, 9, 5);
  const end = new Date(2026, 9, 12);
  const moscow = availabilityTimeZone(start);

  /** Every opened element is closed, in order: the text is well-formed. */
  function balanced(xml: string): boolean {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
      if (m[4]) continue;
      if (m[1]) {
        if (stack.pop() !== m[2]) return false;
      } else stack.push(m[2]);
    }
    return stack.length === 0 && !/<(?!\/?[A-Za-z?])/.test(xml);
  }

  it('asks for merged free/busy with details, in 30-minute steps over the week, as local wall-clock time', () => {
    const xml = userAvailabilitySoap(['ivan@corp.ru', 'maria@corp.ru'], start, end, moscow);
    expect(balanced(xml)).toBe(true);
    expect(xml).toContain('<m:GetUserAvailabilityRequest>');
    expect(xml).toContain('<t:StartTime>2026-10-05T00:00:00</t:StartTime>');
    expect(xml).toContain('<t:EndTime>2026-10-12T00:00:00</t:EndTime>');
    expect(xml).toContain('<t:MergedFreeBusyIntervalInMinutes>30</t:MergedFreeBusyIntervalInMinutes>');
    expect(xml).toContain('<t:RequestedView>DetailedMerged</t:RequestedView>');
    expect(xml.match(/<t:MailboxData>/g)).toHaveLength(2);
    expect(xml).toContain('<t:Address>ivan@corp.ru</t:Address>');
    expect(xml.indexOf('ivan@corp.ru')).toBeLessThan(xml.indexOf('maria@corp.ru')); // the answer comes in this order
    // The zone is explicit: Moscow is UTC+3 all year, so both periods add nothing.
    expect(xml).toContain('<t:TimeZone><t:Bias>-180</t:Bias>');
    expect(xml).toContain('<t:StandardTime><t:Bias>0</t:Bias>');
    expect(xml).toContain('<t:DaylightTime><t:Bias>0</t:Bias>');
  });

  it('never lets an address near the markup: anything but a plain address is refused', () => {
    for (const evil of ['a@b.ru</t:Address><t:Evil/>', 'a@b.ru"><x', '<![CDATA[x]]>@b.ru', 'a&amp;b@c.ru', 'a@b.ru\n<t:X/>', "a'b@c.ru\u0000", 'x@y.ru]]>']) {
      expect(() => userAvailabilitySoap([evil], start, end, moscow), evil).toThrow();
    }
    // The apostrophe is legal in an address and is escaped, not trusted.
    expect(userAvailabilitySoap(["o'brien@corp.ru"], start, end, moscow)).toContain('<t:Address>o&apos;brien@corp.ru</t:Address>');
  });

  it('caps the mailboxes and checks the window and the step', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@corp.ru`);
    expect(() => userAvailabilitySoap(list(MAX_MAILBOXES), start, end, moscow)).not.toThrow();
    expect(() => userAvailabilitySoap(list(MAX_MAILBOXES + 1), start, end, moscow)).toThrow();
    expect(() => userAvailabilitySoap(['a@b.ru'], end, start, moscow)).toThrow();
    expect(() => userAvailabilitySoap(['a@b.ru'], start, end, moscow, 0)).toThrow();
    expect(() => userAvailabilitySoap(['a@b.ru'], start, end, moscow, 30.5)).toThrow();
    expect(() => userAvailabilitySoap(['a@b.ru'], start, end, moscow, 60)).not.toThrow();
  });

  it('escapes the five markup characters and removes what XML 1.0 cannot carry', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
    expect(xmlText('a<b>&"\'c')).toBe('a&lt;b&gt;&amp;&quot;&apos;c');
    expect(xmlText('a\u0000b\u0001c\u001fd￾e￿')).toBe('abcde');
    expect(xmlText('tab\there\nnewline\r')).toBe('tab\there\nnewline\r');
    expect(xmlText('lone \ud800 high, lone \udc00 low, pair 😀 ok')).toBe('lone  high, lone  low, pair 😀 ok');
    expect(xmlText('Иван & «Пётр»')).toBe('Иван &amp; «Пётр»');
  });
});

describe('the time zone sent with the request', () => {
  /** The system's offsets for a zone, in `Date#getTimezoneOffset`'s sense: minutes from local time to UTC. */
  function offsets(zone: string) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    return (ms: number) => {
      const part = fmt.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')!.value;
      const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
      if (!m) return 0;
      const minutes = Number(m[2]) * 60 + Number(m[3]);
      // `0 - minutes`, not `-minutes`: some ICU versions write UTC as "GMT+00:00", and -0 is not 0 for `toBe`.
      return m[1] === '-' ? minutes : 0 - minutes;
    };
  }
  const at = new Date(2026, 9, 7);

  it('Pacific time: UTC = local + 480, daylight time from the second Sunday of March, standard from the first of November', () => {
    const tz = availabilityTimeZone(at, offsets('America/Los_Angeles'));
    expect(tz.bias).toBe(480);
    expect(tz.standard).toEqual({ bias: 0, time: '02:00:00', dayOrder: 1, month: 11, dayOfWeek: 'Sunday' });
    expect(tz.daylight).toEqual({ bias: -60, time: '02:00:00', dayOrder: 2, month: 3, dayOfWeek: 'Sunday' });
  });

  it('Central Europe: the last Sundays of October (03:00) and March (02:00)', () => {
    const tz = availabilityTimeZone(at, offsets('Europe/Berlin'));
    expect(tz.bias).toBe(-60);
    expect(tz.standard).toEqual({ bias: 0, time: '03:00:00', dayOrder: 5, month: 10, dayOfWeek: 'Sunday' });
    expect(tz.daylight).toEqual({ bias: -60, time: '02:00:00', dayOrder: 5, month: 3, dayOfWeek: 'Sunday' });
  });

  it('the southern hemisphere runs the other way round', () => {
    const tz = availabilityTimeZone(at, offsets('Australia/Sydney'));
    expect(tz.bias).toBe(-600);
    expect(tz.daylight).toMatchObject({ bias: -60, month: 10, dayOrder: 1, dayOfWeek: 'Sunday', time: '02:00:00' });
    expect(tz.standard).toMatchObject({ bias: 0, month: 4, dayOrder: 1, dayOfWeek: 'Sunday', time: '03:00:00' });
  });

  it('zones without daylight saving get the fixed offset and two periods that add nothing', () => {
    for (const [zone, bias] of [['Europe/Moscow', -180], ['Asia/Kolkata', -330], ['UTC', 0], ['Asia/Kathmandu', -345]] as const) {
      const tz = availabilityTimeZone(at, offsets(zone));
      expect(tz.bias, zone).toBe(bias);
      expect(tz.standard.bias).toBe(0);
      expect(tz.daylight.bias).toBe(0);
    }
  });

  it('an odd pattern (four switches a year) falls back to the offset in force on that day', () => {
    const odd = (ms: number) => {
      const d = new Date(ms);
      const m = d.getUTCMonth();
      return m === 2 || m === 4 || m === 8 || m === 10 ? -240 : -180;
    };
    const tz = availabilityTimeZone(new Date(2026, 4, 10), odd);
    expect(tz.bias).toBe(-240);
    expect(tz.daylight.bias).toBe(0);
  });

  it('reads this computer by default', () => {
    const tz = availabilityTimeZone(new Date(2026, 9, 5));
    expect(tz.bias).toBe(new Date(2026, 9, 5).getTimezoneOffset());
  });
});

// ---------- the answer ----------

const NS = 'xmlns="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"';
const response = (merged: string | null, o: { cls?: string; code?: string; events?: string } = {}) =>
  `<FreeBusyResponse><ResponseMessage ResponseClass="${o.cls ?? 'Success'}"><ResponseCode>${o.code ?? 'NoError'}</ResponseCode></ResponseMessage>` +
  (merged === null ? '' : `<FreeBusyView><t:FreeBusyViewType>DetailedMerged</t:FreeBusyViewType><t:MergedFreeBusy>${merged}</t:MergedFreeBusy>${o.events ? `<t:CalendarEventArray>${o.events}</t:CalendarEventArray>` : ''}</FreeBusyView>`) +
  `</FreeBusyResponse>`;
const envelope = (inner: string) => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetUserAvailabilityResponse ${NS}><FreeBusyResponseArray>${inner}</FreeBusyResponseArray></GetUserAvailabilityResponse></s:Body></s:Envelope>`;
const calEvent = (start: string, end: string, busy: string, subject?: string, extra = '') =>
  `<t:CalendarEvent><t:StartTime>${start}</t:StartTime><t:EndTime>${end}</t:EndTime><t:BusyType>${busy}</t:BusyType>${subject === undefined ? '' : `<t:CalendarEventDetails><t:ID>X</t:ID><t:Subject>${subject}</t:Subject><t:Location /><t:IsMeeting>true</t:IsMeeting>${extra}</t:CalendarEventDetails>`}</t:CalendarEvent>`;

describe('GetUserAvailability response', () => {
  const ws = new Date(2026, 9, 5).getTime();
  const we = new Date(2026, 9, 12).getTime();
  const n = slotCount(ws, we);
  const free = '0'.repeat(n);

  it('reads one string per mailbox, in the order of the request', () => {
    const merged = '0012' + '0'.repeat(n - 4);
    const r = parseAvailabilityResponse(envelope(response(free) + response(merged)), ['a@corp.ru', 'b@corp.ru'], ws, we);
    expect(r.answered).toBe(2);
    expect(r.people.map((p) => p.email)).toEqual(['a@corp.ru', 'b@corp.ru']);
    expect(r.people[0].digits).toBe(free);
    expect(r.people[1].digits.slice(0, 4)).toBe('0012');
    expect(r.people.every((p) => !p.failed)).toBe(true);
    expect(n).toBe(336);
  });

  it('a mailbox with an error (not found, no permission) is "no data" for that person only', () => {
    const xml = envelope(
      response(free) +
        response(null, { cls: 'Error', code: 'ErrorMailRecipientNotFound' }) +
        response(null) + // success, but no view at all: no access
        response('', { cls: 'Warning', code: 'NoError' }),
    );
    const r = parseAvailabilityResponse(xml, ['a@corp.ru', 'b@corp.ru', 'c@corp.ru', 'd@corp.ru'], ws, we);
    expect(r.people[0].failed).toBeUndefined();
    expect(r.people[1]).toMatchObject({ failed: true, error: 'ErrorMailRecipientNotFound' });
    expect(r.people[1].digits).toBe('4'.repeat(n));
    expect(r.people[2]).toMatchObject({ failed: true, error: 'NoData' });
    expect(r.people[3].failed).toBe(true);
    expect(r.answered).toBe(4);
  });

  it('a mailbox that got no answer at all is "no data"; extra answers are ignored', () => {
    const one = parseAvailabilityResponse(envelope(response(free)), ['a@corp.ru', 'b@corp.ru'], ws, we);
    expect(one.people[1]).toMatchObject({ failed: true, error: 'NoResponse' });
    const extra = parseAvailabilityResponse(envelope(response(free) + response(free) + response(free)), ['a@corp.ru'], ws, we);
    expect(extra.people).toHaveLength(1);
  });

  it('reads any namespace prefix, CDATA, entities and comments', () => {
    const xml = `<?xml version="1.0"?><!-- hi --><soap:Envelope xmlns:soap="x"><soap:Body><m:GetUserAvailabilityResponse xmlns:m="m"><m:FreeBusyResponseArray><m:FreeBusyResponse><m:ResponseMessage ResponseClass='Success'><m:ResponseCode>NoError</m:ResponseCode></m:ResponseMessage><m:FreeBusyView><t:MergedFreeBusy><![CDATA[0 2 2\n1]]></t:MergedFreeBusy><t:CalendarEventArray>${calEvent('2026-10-05T10:00:00', '2026-10-05T11:00:00', 'Busy', 'R&amp;D &lt;sync&gt; &#1055;&#x41F;')}</t:CalendarEventArray></m:FreeBusyView></m:FreeBusyResponse></m:FreeBusyResponseArray></m:GetUserAvailabilityResponse></soap:Body></soap:Envelope>`;
    const r = parseAvailabilityResponse(xml, ['a@corp.ru'], ws, we);
    expect(r.people[0].failed).toBeUndefined();
    // CDATA is taken literally: the spaces are not digits, so they read as "no data".
    expect(r.people[0].digits.slice(0, 5)).toBe('04242');
    expect(r.people[0].events).toEqual([{ start: new Date(2026, 9, 5, 10).toISOString(), end: new Date(2026, 9, 5, 11).toISOString(), status: 'busy', subject: 'R&D <sync> ПП' }]);
  });

  it('digits that are not 0-4 are "no data"; the string is cut to the window', () => {
    const r = parseAvailabilityResponse(envelope(response('0123456x9' + '0'.repeat(n))), ['a@corp.ru'], ws, we);
    expect(r.people[0].digits.slice(0, 9)).toBe('012344444');
    expect(r.people[0].digits).toHaveLength(n);
    expect(statusOfDigit('5')).toBe('nodata');
    expect(statusOfDigit('12')).toBe('nodata');
    expect(statusOfDigit(undefined)).toBe('nodata');
    expect(statusOfDigit('3')).toBe('oof');
  });

  it('keeps subjects only as clean, clipped text and never for private meetings', () => {
    const long = 'Я'.repeat(500);
    const events =
      calEvent('2026-10-05T10:00:00', '2026-10-05T11:00:00', 'Busy', `Plan‮\u0007\u0000 ${long}`) +
      calEvent('2026-10-05T12:00:00', '2026-10-05T13:00:00', 'Tentative', 'Secret', '<t:IsPrivate>true</t:IsPrivate>') +
      calEvent('2026-10-05T14:00:00', '2026-10-05T15:00:00', 'OOF') + // no details at all
      calEvent('2026-10-05T16:00:00', '2026-10-05T15:00:00', 'Busy', 'backwards') + // ends before it starts
      calEvent('garbage', '2026-10-05T15:00:00', 'Busy', 'no start') +
      calEvent('2026-10-05T17:00:00', '2026-10-05T18:00:00', 'constructor', 'bad type') +
      calEvent('2026-10-05T17:00:00', '2026-10-05T18:00:00', '__proto__', 'bad type') +
      calEvent('2026-10-05T19:00:00+03:00', '2026-10-05T20:00:00+03:00', 'Free', 'with offset');
    const r = parseAvailabilityResponse(envelope(response(free, { events })), ['a@corp.ru'], ws, we);
    const ev = r.people[0].events!;
    expect(ev.map((e) => e.status)).toEqual(['busy', 'tentative', 'oof', 'free']);
    expect(ev[0].subject!.length).toBeLessThanOrEqual(120);
    expect(ev[0].subject).toMatch(/^Plan /);
    expect(ev[0].subject).not.toMatch(/[‮\u0007\u0000]/);
    expect(ev[1].subject).toBeUndefined();
    expect(ev[2].subject).toBeUndefined();
    expect(ev[3].subject).toBe('with offset');
  });

  it('a server error code is shown only as plain characters', () => {
    const r = parseAvailabilityResponse(envelope(response(null, { cls: 'Error', code: 'Error<script>alert(1)</script>‮X' })), ['a@corp.ru'], ws, we);
    expect(r.people[0].error).toMatch(/^[A-Za-z0-9_.-]*$/);
    expect(r.people[0].failed).toBe(true);
  });

  it('a SOAP fault (nothing answered) names its code', () => {
    const fault = '<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultstring>bad</faultstring><detail><e:ResponseCode xmlns:e="e">ErrorInvalidTimeInterval</e:ResponseCode></detail></s:Fault></s:Body></s:Envelope>';
    const r = parseAvailabilityResponse(fault, ['a@corp.ru'], ws, we);
    expect(r.answered).toBe(0);
    expect(r.fault).toBe('ErrorInvalidTimeInterval');
    expect(r.people[0].failed).toBe(true);
  });

  it('the code of a SOAP fault (HTTP 500) is read from the detail, then from the fault code', () => {
    const ns = 'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"';
    const real = `<s:Envelope ${ns}><s:Body><s:Fault><faultcode xmlns:a="http://schemas.microsoft.com/exchange/services/2006/types">a:ErrorInvalidTimeInterval</faultcode><faultstring xml:lang="en-US">bad</faultstring><detail><e:ResponseCode xmlns:e="http://schemas.microsoft.com/exchange/services/2006/errors">ErrorInvalidTimeInterval</e:ResponseCode><e:Message>x</e:Message></detail></s:Fault></s:Body></s:Envelope>`;
    expect(soapFaultCode(real)).toBe('ErrorInvalidTimeInterval');
    expect(soapFaultCode('<m:ResponseCode>ErrorServerBusy</m:ResponseCode>')).toBe('ErrorServerBusy');
    expect(soapFaultCode('<s:Fault><faultcode xmlns:a="t">a:ErrorAccessDenied</faultcode></s:Fault>')).toBe('ErrorAccessDenied');
    for (const none of ['', 'HTTP 500', '<html>Internal Server Error</html>', '<ResponseCode>NoError</ResponseCode>', '<ResponseCode>Error<script></ResponseCode>']) expect(soapFaultCode(none)).toBeUndefined();
    // Hostile bodies: long runs of the pieces the pattern looks for stay fast.
    for (const evil of ['ResponseCode'.repeat(50_000), '<ResponseCode' + ' '.repeat(100_000), '<ResponseCode xmlns:e="' + 'a'.repeat(100_000), 'faultcode>'.repeat(50_000), '<ResponseCode>' + ' '.repeat(100_000) + 'Error']) {
      expect(time(() => soapFaultCode(evil))).toBeLessThan(100);
    }
  });

  it('garbage in, "no data" out: it never throws', () => {
    for (const junk of ['', 'plain text', '<', '<>', '<<<<', '</a></b>', '<a', '<!--', '<![CDATA[', '<?xml', '{"json": true}', '\u0000\u0001', '<FreeBusyResponse>', '<FreeBusyResponse><MergedFreeBusy>', envelope(response(free)).slice(0, 200)]) {
      const r = parseAvailabilityResponse(junk, ['a@corp.ru', 'b@corp.ru'], ws, we);
      expect(r.people).toHaveLength(2);
      expect(r.people.every((p) => p.digits.length > 0)).toBe(true);
    }
    expect(parseAvailabilityResponse('<FreeBusyResponse><MergedFreeBusy>0012</MergedFreeBusy>', ['a@corp.ru'], ws, we).people[0].digits).toBe('0012');
  });

  it('caps a very long string, the number of mailboxes and the number of events', () => {
    const wide = parseAvailabilityResponse(envelope(response('2'.repeat(500_000))), ['a@corp.ru'], ws, new Date(2026, 9, 19).getTime());
    expect(wide.people[0].digits.length).toBeLessThanOrEqual(MAX_DIGITS);
    const crowd = parseAvailabilityResponse(envelope(response(free).repeat(100)), Array.from({ length: 100 }, (_, i) => `u${i}@corp.ru`), ws, we);
    expect(crowd.answered).toBeLessThanOrEqual(MAX_MAILBOXES);
    const events = Array.from({ length: 2_000 }, (_, i) => calEvent(`2026-10-05T10:00:00`, `2026-10-05T11:00:00`, 'Busy', `m${i}`)).join('');
    const many = parseAvailabilityResponse(envelope(response(free, { events })), ['a@corp.ru'], ws, we);
    expect(many.people[0].events!.length).toBe(500);
  });

  it('is linear on hostile answers', () => {
    const big = (s: string, times: number) => envelope(s.repeat(times));
    expect(time(() => parseAvailabilityResponse('<'.repeat(6_000_000), ['a@corp.ru'], ws, we))).toBeLessThan(500);
    expect(time(() => parseAvailabilityResponse('<a '.repeat(2_000_000), ['a@corp.ru'], ws, we))).toBeLessThan(500);
    expect(time(() => parseAvailabilityResponse('<!--'.repeat(1_000_000), ['a@corp.ru'], ws, we))).toBeLessThan(500);
    expect(time(() => parseAvailabilityResponse('<a>'.repeat(2_000_000), ['a@corp.ru'], ws, we))).toBeLessThan(800);
    expect(time(() => parseAvailabilityResponse('<' + 'a'.repeat(5_000_000), ['a@corp.ru'], ws, we))).toBeLessThan(500);
    expect(time(() => parseAvailabilityResponse('&amp;'.repeat(1_000_000), ['a@corp.ru'], ws, we))).toBeLessThan(500);
    expect(time(() => parseAvailabilityResponse(big('<FreeBusyResponse><MergedFreeBusy>', 100_000), ['a@corp.ru'], ws, we))).toBeLessThan(800);
    expect(time(() => parseAvailabilityResponse(big(response('2'.repeat(300)), 12_000), ['a@corp.ru'], ws, we))).toBeLessThan(800);
    expect(time(() => parseAvailabilityResponse(envelope(response(free, { events: calEvent('x', 'y', 'Busy', 'z').repeat(30_000) })), ['a@corp.ru'], ws, we))).toBeLessThan(800);
    expect(time(() => parseAvailabilityResponse('<a>'.repeat(100_000) + '</a>'.repeat(100_000), ['a@corp.ru'], ws, we))).toBeLessThan(500);
    const subject = envelope(response(free, { events: `<t:CalendarEvent><t:StartTime>2026-10-05T10:00:00</t:StartTime><t:EndTime>2026-10-05T11:00:00</t:EndTime><t:BusyType>Busy</t:BusyType><t:CalendarEventDetails>${'<t:Subject>x</t:Subject>'.repeat(100_000)}</t:CalendarEventDetails></t:CalendarEvent>` }));
    expect(time(() => parseAvailabilityResponse(subject, ['a@corp.ru'], ws, we))).toBeLessThan(800);
  });
});

describe("the user's own address", () => {
  it('is read from the session configuration, preferring the e-mail field', () => {
    expect(parseOwnAddress({ SessionSettings: { UserEmailAddress: 'Ivan.Ivanov@Corp.ru', UserDisplayName: 'Иван' } })).toBe('ivan.ivanov@corp.ru');
    expect(parseOwnAddress({ a: [{ b: { PrimarySmtpAddress: 'p@corp.ru' } }] })).toBe('p@corp.ru');
    expect(parseOwnAddress({ SessionSettings: { PrimarySmtpAddress: 'p@corp.ru', UserEmailAddress: 'u@corp.ru' } })).toBe('u@corp.ru');
  });

  it('refuses anything that is not a plain address', () => {
    expect(parseOwnAddress({ UserEmailAddress: 'x@y.ru</t:Address>' })).toBeUndefined();
    expect(parseOwnAddress({ UserEmailAddress: 'DOMAIN\\user' })).toBeUndefined();
    expect(parseOwnAddress({ UserEmailAddress: 5 })).toBeUndefined();
    expect(parseOwnAddress(null)).toBeUndefined();
    expect(parseOwnAddress('text')).toBeUndefined();
  });

  it('survives absurd nesting and size', () => {
    let deep: unknown = { UserEmailAddress: 'deep@corp.ru' };
    for (let i = 0; i < 10_000; i++) deep = { x: deep };
    expect(time(() => parseOwnAddress(deep))).toBeLessThan(500);
    expect(parseOwnAddress(deep)).toBeUndefined();
    const wide = Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [`k${i}`, { v: i }]));
    expect(time(() => parseOwnAddress(wide))).toBeLessThan(500);
  });
});

// ---------- the grid ----------

const WEEK = weekWindow(new Date(2026, 9, 7)); // Mon 5 - Sun 11 October 2026
const DAY = (d: number, h = 0, m = 0) => new Date(2026, 9, d, h, m).getTime();
const OPTS: GridOptions = { workdayStartHour: 8, workdayEndHour: 20, showWeekends: false };

/** A person whose status in each slot comes from `at(slotStartMs)`. */
function person(email: string, at: (start: number) => string = () => '0', extra: Partial<GridPersonInput> = {}): GridPersonInput {
  const w = WEEK.start.getTime();
  const n = slotCount(w, WEEK.end.getTime());
  return { email, digits: Array.from({ length: n }, (_, i) => at(w + i * 30 * 60_000)).join(''), ...extra };
}
const grid = (people: GridPersonInput[], opts: Partial<GridOptions> = {}) => buildGrid(WEEK.start.getTime(), WEEK.end.getTime(), people, { ...OPTS, ...opts });
const hhmm = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;
const dayOf = (ms: number) => new Date(ms).getDate();
/** Busy in [from, to) local hours of a day. */
const busyAt = (day: number, from: number, to: number, digit = '2') => (s: number) => (s >= DAY(day, from) && s < DAY(day, to) ? digit : '0');
const combine = (...fs: Array<(s: number) => string>) => (s: number) => fs.map((f) => f(s)).reduce((a, b) => (b > a ? b : a), '0');

describe('weeks', () => {
  it('start on Monday, whatever day is asked', () => {
    for (const d of [5, 6, 7, 8, 9, 10, 11]) expect(weekStart(new Date(2026, 9, d)).getTime()).toBe(DAY(5));
    expect(weekStart(new Date(2026, 9, 12)).getTime()).toBe(DAY(12));
    expect(weekWindow(new Date(2026, 9, 7))).toEqual({ start: new Date(2026, 9, 5), end: new Date(2026, 9, 12) });
  });

  it('a week across a daylight saving switch is an hour longer or shorter, and still ends on Monday midnight', () => {
    process.env.TZ = 'Europe/Berlin';
    try {
      const fall = weekWindow(new Date(2026, 9, 21)); // 25 October: the clocks go back
      expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(169);
      expect(slotCount(fall.start.getTime(), fall.end.getTime())).toBe(338);
      const spring = weekWindow(new Date(2026, 2, 25)); // 29 March: forward
      expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(167);
      expect(spring.end.getDay()).toBe(1);
      // The grid keeps real time: a 25-hour Sunday has the repeated hour twice.
      const g = buildGrid(fall.start.getTime(), fall.end.getTime(), [{ email: 'a@x.ru', digits: '0'.repeat(338) }], { workdayStartHour: 0, workdayEndHour: 24, showWeekends: true });
      expect(g.days).toHaveLength(7);
      expect(g.days[6].count).toBe(50);
      expect(g.days[0].count).toBe(48);
    } finally {
      process.env.TZ = 'Europe/Moscow';
    }
  });
});

describe('the grid', () => {
  it('shows the workday only: 08:00-20:00 is 24 slots a day, five days when weekends are hidden', () => {
    const g = grid([person('a@x.ru')]);
    expect(g.days).toHaveLength(5);
    expect(g.days.every((d) => d.count === 24 && !d.weekend)).toBe(true);
    expect(g.slots).toHaveLength(120);
    expect(hhmm(g.slots[0].start)).toBe('08:00');
    expect(hhmm(g.slots[23].end)).toBe('20:00');
    expect(g.slots[0].digit).toBe(16); // 08:00 is the 17th half hour of Monday
    expect(g.people[0].cells).toHaveLength(120);
  });

  it('can show the weekend, marked, and follows the workday hours of the settings', () => {
    const g = grid([person('a@x.ru')], { showWeekends: true, workdayStartHour: 9, workdayEndHour: 18 });
    expect(g.days.map((d) => d.weekend)).toEqual([false, false, false, false, false, true, true]);
    expect(g.days.every((d) => d.count === 18)).toBe(true);
    expect(hhmm(g.slots[0].start)).toBe('09:00');
    expect(hhmm(g.slots[17].end)).toBe('18:00');
  });

  it('maps the digits to statuses and keeps the slot order', () => {
    const g = grid([person('a@x.ru', (s) => (s === DAY(5, 8) ? '1' : s === DAY(5, 8, 30) ? '2' : s === DAY(5, 9) ? '3' : s === DAY(5, 9, 30) ? '4' : s === DAY(5, 10) ? '7' : '0'))]);
    expect(g.people[0].cells.slice(0, 6)).toEqual(['tentative', 'busy', 'oof', 'nodata', 'nodata', 'free']);
  });

  it('a person the server could not answer for is no data everywhere; missing digits are no data too', () => {
    const g = grid([person('a@x.ru', () => '0', { failed: true }), { email: 'b@x.ru', digits: '00' }]);
    expect(g.people[0].failed).toBe(true);
    expect(g.people[0].cells.every((c) => c === 'nodata')).toBe(true);
    expect(g.people[1].cells.slice(0, 2)).toEqual(['nodata', 'nodata']);
  });

  it('carries the subject of the meeting that decides a busy slot, and none for free time', () => {
    const events = [
      { start: new Date(DAY(5, 10)).toISOString(), end: new Date(DAY(5, 11)).toISOString(), status: 'tentative' as const, subject: 'Maybe' },
      { start: new Date(DAY(5, 10, 30)).toISOString(), end: new Date(DAY(5, 11, 30)).toISOString(), status: 'busy' as const, subject: 'Plan' },
      { start: new Date(DAY(5, 14)).toISOString(), end: new Date(DAY(5, 15)).toISOString(), status: 'busy' as const },
    ];
    const span = (from: number, to: number, digit: string) => (s: number) => (s >= from && s < to ? digit : '0');
    const g = grid([person('a@x.ru', combine(span(DAY(5, 10), DAY(5, 11), '1'), span(DAY(5, 10, 30), DAY(5, 11, 30), '2'), span(DAY(5, 14), DAY(5, 15), '2')), { events })]);
    const at = (h: number, m = 0) => g.slots.findIndex((s) => s.start === DAY(5, h, m));
    expect(g.people[0].notes[at(10)]).toBe('Maybe');
    expect(g.people[0].notes[at(10, 30)]).toBe('Plan'); // busy outranks tentative
    expect(g.people[0].notes[at(11)]).toBe('Plan');
    expect(g.people[0].notes[at(11, 30)]).toBeUndefined();
    expect(g.people[0].notes[at(14)]).toBeUndefined(); // the server sent no subject
  });

  it('survives an empty window, odd hours and hostile events', () => {
    expect(buildGrid(10, 10, [], OPTS).slots).toEqual([]);
    expect(buildGrid(WEEK.start.getTime(), WEEK.end.getTime(), [], { workdayStartHour: 20, workdayEndHour: 8, showWeekends: false }).slots.length).toBeGreaterThan(0);
    const g = grid([person('a@x.ru', () => '0', { events: [{ start: 'x', end: 'y', status: 'busy', subject: 's' }, { start: new Date(0).toISOString(), end: new Date(1e15).toISOString(), status: 'busy', subject: 'all' }] })]);
    expect(g.people[0].notes.every((x) => x === 'all' || x === undefined)).toBe(true);
    expect(time(() => buildGrid(WEEK.start.getTime(), WEEK.start.getTime() + 1e13, [person('a@x.ru')], OPTS))).toBeLessThan(1000); // the window is capped
  });
});

// ---------- the best options ----------

const NOW = new Date(2026, 9, 5, 7, 0); // Monday 07:00, before the workday

describe('best options', () => {
  it('everyone free: the earliest times, spread over the days, never overlapping, at most two a day', () => {
    const g = grid([person('me'), person('a@x.ru'), person('b@x.ru')]);
    const opts = bestOptions(g, 60, NOW);
    expect(opts).toHaveLength(5);
    expect(opts[0].start).toBe(DAY(5, 8));
    expect(opts[0].end).toBe(DAY(5, 9));
    expect(opts.every((o) => o.kind === 'free' && o.tentative.length === 0 && o.unknown.length === 0)).toBe(true);
    const perDay = new Map<number, number>();
    for (const o of opts) perDay.set(dayOf(o.start), (perDay.get(dayOf(o.start)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
    for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) expect(opts[i].start < opts[j].end && opts[j].start < opts[i].end).toBe(false);
  });

  it('one busy person blocks exactly their time', () => {
    const g = grid([person('me'), person('a@x.ru', busyAt(5, 8, 10))]);
    const opts = bestOptions(g, 60, NOW, 20);
    expect(opts.some((o) => o.start === DAY(5, 8) || o.start === DAY(5, 9))).toBe(false);
    expect(opts.some((o) => o.start === DAY(5, 10))).toBe(true);
    expect(bestOptions(g, 60, NOW)[0].start).toBe(DAY(5, 10));
  });

  it('out of office blocks like busy; a whole day away leaves no options that day', () => {
    const g = grid([person('me'), person('a@x.ru', busyAt(6, 0, 24, '3'))]);
    const opts = bestOptions(g, 30, NOW, 50);
    expect(opts.some((o) => dayOf(o.start) === 6)).toBe(false);
    expect(opts.some((o) => dayOf(o.start) === 7)).toBe(true);
  });

  it('tentative meetings do not block but lower the score and name the people', () => {
    const g = grid([person('me'), person('a@x.ru', busyAt(5, 8, 10, '1')), person('b@x.ru', busyAt(5, 9, 11, '1'))]);
    const opts = bestOptions(g, 60, NOW, 500);
    const nine = opts.find((o) => o.start === DAY(5, 9));
    expect(nine).toMatchObject({ kind: 'tentative', tentative: ['a@x.ru', 'b@x.ru'], unknown: [] });
    const eight = opts.find((o) => o.start === DAY(5, 8))!;
    expect(eight.tentative).toEqual(['a@x.ru']);
    const free = opts.find((o) => o.start === DAY(5, 11))!;
    expect(free.kind).toBe('free');
    expect(free.score).toBeGreaterThan(nine!.score);
    // An all-free time on a later day still beats a tentative one today.
    expect(bestOptions(g, 60, NOW, 5)[0].kind).toBe('free');
  });

  it('only tentative times available: they are offered, flagged', () => {
    const g = grid([person('me'), person('a@x.ru', () => '1')]);
    const opts = bestOptions(g, 60, NOW);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.kind === 'tentative' && o.tentative.includes('a@x.ru'))).toBe(true);
  });

  it('people without data never block, but the option says so and scores lower', () => {
    const base = bestOptions(grid([person('me'), person('a@x.ru')]), 60, NOW, 50);
    const withUnknown = bestOptions(grid([person('me'), person('a@x.ru'), person('ghost@x.ru', () => '4', { failed: true })]), 60, NOW, 50);
    expect(withUnknown.length).toBeGreaterThan(0);
    expect(withUnknown.every((o) => o.unknown.includes('ghost@x.ru'))).toBe(true);
    expect(withUnknown[0].score).toBeLessThan(base[0].score);
    expect(withUnknown[0].kind).toBe('free');
  });

  it('partial data: only the slots without data count against that person', () => {
    const g = grid([person('me'), person('a@x.ru', busyAt(5, 8, 9, '4'))]);
    const opts = bestOptions(g, 60, NOW, 50);
    const eight = opts.find((o) => o.start === DAY(5, 8))!;
    expect(eight.unknown).toEqual(['a@x.ru']);
    expect(opts.find((o) => o.start === DAY(5, 9))!.unknown).toEqual([]);
  });

  it('nobody readable at all: nothing to suggest', () => {
    const g = grid([person('a@x.ru', () => '4', { failed: true }), person('b@x.ru', () => '4')]);
    expect(bestOptions(g, 30, NOW)).toEqual([]);
    expect(bestOptions(grid([]), 30, NOW)).toEqual([]);
  });

  it('never offers the past, nor a slot that has begun', () => {
    const now = new Date(2026, 9, 7, 14, 10);
    const opts = bestOptions(grid([person('me')]), 30, now, 50);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.start >= now.getTime())).toBe(true);
    expect(opts.some((o) => o.start === DAY(7, 14))).toBe(false); // that slot began at 14:00
    expect(opts.some((o) => o.start === DAY(7, 14, 30))).toBe(true);
    expect(bestOptions(grid([person('me')]), 30, new Date(2026, 9, 12, 9))).toEqual([]); // the week is over
  });

  it('a meeting longer than the gaps is not offered; a gap that fits is', () => {
    // Free only in 30-minute gaps between busy blocks on every day.
    const gaps = (s: number) => (new Date(s).getMinutes() === 0 ? '2' : '0');
    const g = grid([person('me', gaps)]);
    expect(bestOptions(g, 60, NOW)).toEqual([]);
    expect(bestOptions(g, 90, NOW)).toEqual([]);
    expect(bestOptions(g, 30, NOW).length).toBeGreaterThan(0);
    // One 90-minute window on Tuesday, everything else busy.
    const tue = (s: number) => (s >= DAY(6, 13) && s < DAY(6, 14, 30) ? '0' : '2');
    const only = bestOptions(grid([person('me', tue)]), 90, NOW, 10);
    expect(only).toHaveLength(1);
    expect(only[0]).toMatchObject({ start: DAY(6, 13), end: DAY(6, 14, 30) });
    expect(bestOptions(grid([person('me', tue)]), 60, NOW, 10).map((o) => hhmm(o.start))).toEqual(['13:00']); // 13:30 overlaps and ranks lower
  });

  it('45 minutes takes two slots; the end is the start plus 45 minutes', () => {
    const o = bestOptions(grid([person('me')]), 45, NOW)[0];
    expect(o.end - o.start).toBe(45 * 60_000);
    const g = grid([person('me', busyAt(5, 8, 9))]);
    expect(bestOptions(g, 45, NOW)[0].start).toBe(DAY(5, 9));
  });

  it('stays inside the workday and never joins two days', () => {
    const g = grid([person('me')], { workdayStartHour: 10, workdayEndHour: 12 });
    const all = bestOptions(g, 90, NOW, 50);
    expect(all.length).toBeGreaterThan(0);
    for (const o of all) {
      expect(new Date(o.start).getHours()).toBeGreaterThanOrEqual(10);
      expect(o.end).toBeLessThanOrEqual(DAY(dayOf(o.start), 12));
    }
    expect(bestOptions(grid([person('me')], { workdayStartHour: 10, workdayEndHour: 11 }), 90, NOW)).toEqual([]);
    // A meeting that would run past the evening into the next morning does not exist.
    const late = grid([person('me')], { workdayStartHour: 8, workdayEndHour: 20 });
    expect(bestOptions(late, 90, NOW, 100).every((o) => dayOf(o.start) === dayOf(o.end - 1))).toBe(true);
  });

  it('weekends: not in a grid that hides them; far behind the weekdays when shown', () => {
    const hidden = bestOptions(grid([person('me')]), 60, NOW, 100);
    expect(hidden.every((o) => ![0, 6].includes(new Date(o.start).getDay()))).toBe(true);
    const shown = grid([person('me', (s) => (new Date(s).getDay() === 0 || new Date(s).getDay() === 6 ? '0' : '2'))], { showWeekends: true });
    const opts = bestOptions(shown, 60, NOW, 5);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => [0, 6].includes(new Date(o.start).getDay()))).toBe(true);
    const mixed = bestOptions(grid([person('me', busyAt(5, 8, 20))], { showWeekends: true }), 60, NOW, 12);
    const firstWeekend = mixed.findIndex((o) => [0, 6].includes(new Date(o.start).getDay()));
    expect(firstWeekend === -1 || mixed.slice(0, firstWeekend).every((o) => ![0, 6].includes(new Date(o.start).getDay()))).toBe(true);
  });

  it('prefers a time outside lunch, an earlier one, and the hour over the half hour', () => {
    const only = (from: number, to: number) => (s: number) => (s >= DAY(5, from) && s < DAY(5, to) ? '0' : '2');
    const lunchy = bestOptions(grid([person('me', combine(only(11, 15), (s) => (dayOf(s) === 5 ? '0' : '2')))]), 60, NOW, 10);
    const startsAt = lunchy.map((o) => hhmm(o.start));
    expect(startsAt.indexOf('11:00')).toBeLessThan(startsAt.indexOf('12:00'));
    expect(startsAt.indexOf('13:00')).toBeLessThan(startsAt.indexOf('12:00'));
    expect(LUNCH).toEqual({ startMin: 720, endMin: 780 });
    const half = bestOptions(grid([person('me', only(9, 11))]), 30, NOW, 10).map((o) => hhmm(o.start));
    expect(half.indexOf('09:00')).toBeLessThan(half.indexOf('09:30'));
    // Later days score lower than earlier ones for the same hour.
    const days = bestOptions(grid([person('me')]), 60, NOW, 50);
    const a = days.find((o) => o.start === DAY(5, 10))!;
    const b = days.find((o) => o.start === DAY(8, 10))!;
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('is deterministic, honours the limit and is fast', () => {
    const people = Array.from({ length: 21 }, (_, i) => person(`p${i}@x.ru`, (s) => (((s / 1_800_000) | 0) * (i + 3)) % 7 === 0 ? '2' : '0'));
    const g = grid(people, { showWeekends: true, workdayStartHour: 0, workdayEndHour: 24 });
    const a = bestOptions(g, 30, NOW, 5);
    expect(bestOptions(g, 30, NOW, 5)).toEqual(a);
    expect(bestOptions(g, 30, NOW, 2)).toHaveLength(Math.min(2, a.length));
    expect(bestOptions(g, 30, NOW, 0)).toEqual([]);
    expect(time(() => bestOptions(g, 90, NOW, 5))).toBeLessThan(500);
  });
});

// ---------- "me" from the synced calendar ----------

describe('own availability from the synced calendar', () => {
  const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
    id: Math.random().toString(),
    title: 'Планёрка',
    start: new Date(DAY(5, 10)).toISOString(),
    end: new Date(DAY(5, 11)).toISOString(),
    isAllDay: false,
    platform: 'generic',
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    categories: [],
    isRecurring: false,
    ...over,
  });
  const at = (p: { digits: string }, day: number, h: number, m = 0) => p.digits[Math.round((DAY(day, h, m) - WEEK.start.getTime()) / 1_800_000)];

  it('accepted and own meetings are busy, tentative and unanswered ones tentative', () => {
    const p = availabilityFromEvents(
      [ev({}), ev({ start: new Date(DAY(5, 12)).toISOString(), end: new Date(DAY(5, 12, 30)).toISOString(), responseType: 'tentative' }), ev({ start: new Date(DAY(5, 13)).toISOString(), end: new Date(DAY(5, 14)).toISOString(), responseType: 'notResponded' }), ev({ start: new Date(DAY(5, 15)).toISOString(), end: new Date(DAY(5, 16)).toISOString(), responseType: 'organizer' })],
      WEEK.start.getTime(),
      WEEK.end.getTime(),
      NOW,
      'me',
    );
    expect(at(p, 5, 10)).toBe('2');
    expect(at(p, 5, 10, 30)).toBe('2');
    expect(at(p, 5, 11)).toBe('0');
    expect(at(p, 5, 12)).toBe('1');
    expect(at(p, 5, 12, 30)).toBe('0');
    expect(at(p, 5, 13)).toBe('1');
    expect(at(p, 5, 15)).toBe('2');
    expect(p.events![0]).toMatchObject({ status: 'busy', subject: 'Планёрка' });
  });

  it('declined, cancelled and all-day meetings do not block', () => {
    const p = availabilityFromEvents([ev({ responseType: 'declined' }), ev({ isCancelled: true }), ev({ title: 'Отменено: X' }), ev({ isAllDay: true, start: new Date(DAY(5)).toISOString(), end: new Date(DAY(6)).toISOString() })], WEEK.start.getTime(), WEEK.end.getTime(), NOW, 'me');
    expect(p.digits).toBe('0'.repeat(336));
    expect(p.events).toEqual([]);
  });

  it('a meeting across the edges of the window is clipped, and one outside it is ignored', () => {
    const p = availabilityFromEvents([ev({ start: new Date(DAY(4, 23)).toISOString(), end: new Date(DAY(5, 1)).toISOString() }), ev({ start: new Date(DAY(11, 23)).toISOString(), end: new Date(DAY(12, 2)).toISOString() }), ev({ start: new Date(DAY(20, 10)).toISOString(), end: new Date(DAY(20, 11)).toISOString() })], WEEK.start.getTime(), WEEK.end.getTime(), NOW, 'me');
    expect(p.digits.slice(0, 3)).toBe('220');
    expect(p.digits.slice(-3)).toBe('022');
    expect(p.events).toHaveLength(2);
  });

  it('what lies outside the synced range (a week back, a month ahead) is unknown, not free', () => {
    const far = weekWindow(new Date(2026, 11, 7)); // two months ahead
    const p = availabilityFromEvents([], far.start.getTime(), far.end.getTime(), NOW, 'me');
    expect(/^4+$/.test(p.digits)).toBe(true);
    const near = availabilityFromEvents([], WEEK.start.getTime(), WEEK.end.getTime(), NOW, 'me');
    expect(/^0+$/.test(near.digits)).toBe(true);
    const edge = weekWindow(new Date(2026, 10, 2)); // 5 Nov: the week of the 30-day horizon (4 Nov)
    const e = availabilityFromEvents([], edge.start.getTime(), edge.end.getTime(), NOW, 'me');
    expect(e.digits).toMatch(/^0+4+$/);
  });
});

// ---------- the IPC request ----------

describe('availability request from the renderer', () => {
  const NOWD = new Date(2026, 9, 7, 12);
  const good = { emails: ['Ivan@Corp.ru', 'maria@corp.ru', 'ivan@corp.ru'], start: new Date(2026, 9, 5).toISOString(), end: new Date(2026, 9, 12).toISOString() };

  it('accepts a normal request: lower-cased, de-duplicated, dates normalized', () => {
    const r = parseAvailabilityRequest(good, NOWD);
    expect(r.emails).toEqual(['ivan@corp.ru', 'maria@corp.ru']);
    expect(r.start).toBe(good.start);
    expect(r.end).toBe(good.end);
    expect(parseAvailabilityRequest({ ...good, emails: [] }, NOWD).emails).toEqual([]);
    expect(parseAvailabilityRequest({ ...good, start: '2026-10-05T00:00:00+03:00' }, NOWD).start).toBe('2026-10-04T21:00:00.000Z');
  });

  it('refuses more than 20 addresses, and a list with a single bad one (no silent trimming)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `u${i}@corp.ru`);
    expect(parseAvailabilityRequest({ ...good, emails: twenty }, NOWD).emails).toHaveLength(20);
    expect(() => parseAvailabilityRequest({ ...good, emails: [...twenty, 'u20@corp.ru'] }, NOWD)).toThrow();
    expect(() => parseAvailabilityRequest({ ...good, emails: ['ok@corp.ru', 'not an address'] }, NOWD)).toThrow();
    expect(() => parseAvailabilityRequest({ ...good, emails: Array.from({ length: 1_000_000 }, () => 'a@b.ru') }, NOWD)).toThrow();
  });

  it('refuses evil values of every kind', () => {
    const evil: unknown[] = [null, undefined, 42, 'text', [], true, { emails: 'a@b.ru', start: good.start, end: good.end }, { ...good, emails: [42] }, { ...good, emails: [null] }, { ...good, emails: [{ toString: () => 'a@b.ru' }] }, { ...good, emails: ['a@b.ru</t:Address><t:X/>'] }, { ...good, emails: ['a@b.ru\r\nBcc: x@y.ru'] }, { ...good, emails: ['<script>alert(1)</script>@x.ru'] }, { ...good, emails: ['a'.repeat(300) + '@b.ru'] }, { ...good, emails: ['\u0000@b.ru'] }, { ...good, emails: ['a@b.ru; c@d.ru'] }, { ...good, emails: ['a@b.ru, c@d.ru'] }, { ...good, emails: ['[::1]@x.ru'] }];
    for (const v of evil) expect(() => parseAvailabilityRequest(v, NOWD), JSON.stringify(v)?.slice(0, 40)).toThrow();
  });

  it('refuses dates that are not instants, are reversed, too long or too far away', () => {
    const bad = [
      { start: 'yesterday' },
      { start: '2026-10-05' },
      { start: '2026-10-05T00:00:00' }, // no zone: the main process does not guess
      { start: 20261005 },
      { start: { x: 1 } },
      { start: '2026-10-05T00:00:00Z'.repeat(5) },
      { end: '2026-13-45T00:00:00Z' },
      { end: good.start }, // empty
      { end: new Date(2026, 9, 4).toISOString() }, // reversed
      { end: new Date(2026, 9, 20).toISOString() }, // 15 days
      { start: '0001-01-01T00:00:00Z', end: '0001-01-08T00:00:00Z' },
      { start: '9999-01-01T00:00:00Z', end: '9999-01-08T00:00:00Z' },
      { start: new Date(2031, 0, 1).toISOString(), end: new Date(2031, 0, 8).toISOString() },
    ];
    for (const b of bad) expect(() => parseAvailabilityRequest({ ...good, ...b }, NOWD), JSON.stringify(b)).toThrow();
    expect(() => parseAvailabilityRequest({ emails: good.emails }, NOWD)).toThrow();
    // 14 days exactly is fine.
    expect(() => parseAvailabilityRequest({ ...good, end: new Date(2026, 9, 19).toISOString() }, NOWD)).not.toThrow();
  });

  it('is fast on a huge list', () => {
    expect(time(() => parseAvailabilityRequest({ ...good, emails: Array.from({ length: 20 }, (_, i) => `${'a'.repeat(60)}${i}@${'b'.repeat(60)}.ru`) }, NOWD))).toBeLessThan(300);
  });
});

// ---------- the gate ----------

describe('request gate', () => {
  it('lets one request run at a time and 30 in ten minutes', () => {
    const gate = new RequestGate(1, 30, 600_000);
    const done = gate.enter(0);
    expect(() => gate.enter(1)).toThrow(/ещё выполняется/);
    done();
    done(); // releasing twice does not open a second slot
    expect(() => gate.enter(2)).not.toThrow();
  });

  it('counts the requests of the last ten minutes only', () => {
    const gate = new RequestGate(1, 30, 600_000);
    for (let i = 0; i < 30; i++) gate.enter(i * 1000)();
    expect(() => gate.enter(31_000)).toThrow(/Слишком много/);
    expect(() => gate.enter(599_000)).toThrow(/Слишком много/);
    gate.enter(600_001)(); // the first one has left the window: one place is free again
    expect(() => gate.enter(600_002)).toThrow(/Слишком много/);
    expect(() => gate.enter(1_000_000)).not.toThrow(); // by now everything before has aged out
  });
});

// ---------- demo data ----------

describe('demo availability', () => {
  const req = { emails: ['ivan.ivanov@example.com', 'maria.sokolova@example.com', 'noaccess.guest@example.com'], start: new Date(2026, 9, 5).toISOString(), end: new Date(2026, 9, 12).toISOString() };

  it('is the same every time, covers the week and plays one mailbox without data', () => {
    const a = demoAvailability(req);
    expect(demoAvailability(req)).toEqual(a);
    expect(a.people).toHaveLength(3);
    expect(a.people[0].digits).toHaveLength(336);
    expect(/[12]/.test(a.people[0].digits)).toBe(true);
    expect(a.people[2]).toMatchObject({ failed: true, digits: '4'.repeat(336) });
    expect(a.self).toMatchObject({ email: 'demo.me@example.com' });
    expect(a.self!.digits).toHaveLength(336);
    expect(JSON.stringify(a)).not.toContain('Ирина Ковалёва');
    // Weekends are free.
    const sat = (DAY(10) - WEEK.start.getTime()) / 1_800_000;
    expect(a.people[0].digits.slice(sat)).toMatch(/^0+$/);
  });
});
