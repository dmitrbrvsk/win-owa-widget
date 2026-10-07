import { describe, expect, it } from 'vitest';
import {
  defaultCalendarFolder,
  extractCanaryFromHtml,
  htmlToText,
  looksLikeOwaLogon,
  mapCalendarItem,
  parseCalendarView,
  parseEventDetails,
  parseLoginForm,
  parseOwaDate,
} from '../src/main/owa/parse';
import { calendarViewPayload, formEncode, owaLocalDate, parseRsvpResponse, rsvpSoap } from '../src/main/owa/payloads';
import { windowsTimezoneFromIana } from '../src/main/owa/timezone';

const BASE = 'https://mail.example.com';

describe('CANARY', () => {
  it('finds the token in the usual places', () => {
    expect(extractCanaryFromHtml('<script>var x = {"canary":"abc123"};</script>')).toBe('abc123');
    expect(extractCanaryFromHtml('<input name="canary" value="tok"/>')).toBe('tok');
    expect(extractCanaryFromHtml("canary: 'q-w_e'")).toBe('q-w_e');
    expect(extractCanaryFromHtml('<html>nothing</html>')).toBeUndefined();
  });
});

describe('forms login', () => {
  const html = `<form method="POST" action="/owa/auth.owa" name="logonForm">
    <input type="hidden" name="destination" value="https://mail.example.com/owa/">
    <input type="hidden" name="flags" value="4">
    <input type="password" name="password">`;

  it('resolves a relative action and keeps hidden fields', () => {
    const f = parseLoginForm(html, `${BASE}/owa/auth/logon.aspx`, BASE);
    expect(f.action).toBe(`${BASE}/owa/auth.owa`);
    expect(f.hiddenFields).toEqual([
      ['destination', 'https://mail.example.com/owa/'],
      ['flags', '4'],
    ]);
  });

  it('refuses an absolute action on another host', () => {
    const evil = html.replace('/owa/auth.owa', 'https://evil.example.net/steal');
    expect(parseLoginForm(evil, `${BASE}/owa/auth/logon.aspx`, BASE).action).toBe(`${BASE}/owa/auth.owa`);
  });

  it('tells an OWA logon page from a captive portal', () => {
    expect(looksLikeOwaLogon(`${BASE}/owa/auth/logon.aspx?reason=2`, '')).toBe(true);
    expect(looksLikeOwaLogon(`${BASE}/owa/auth.owa`, '<input name="passwd"><input name="flags">')).toBe(true);
    expect(looksLikeOwaLogon('https://portal.example/', '<input name="passwd">')).toBe(false);
    expect(looksLikeOwaLogon(`${BASE}/owa/auth.owa`, '<h1>404 Not Found</h1>')).toBe(false);
  });
});

describe('dates', () => {
  it('parses offsets, MS JSON dates and local times', () => {
    expect(parseOwaDate('2026-10-07T10:00:00+03:00')?.toISOString()).toBe('2026-10-07T07:00:00.000Z');
    expect(parseOwaDate('2026-10-07T07:00:00Z')?.toISOString()).toBe('2026-10-07T07:00:00.000Z');
    expect(parseOwaDate('/Date(1791363600000)/')?.getTime()).toBe(1791363600000);
    const local = parseOwaDate('2026-10-07T10:30:00')!;
    expect([local.getHours(), local.getMinutes()]).toEqual([10, 30]);
    expect(parseOwaDate('garbage')).toBeNull();
  });

  it('formats request ranges as local wall-clock time', () => {
    expect(owaLocalDate(new Date(2026, 0, 5, 9, 7, 3))).toBe('2026-01-05T09:07:03');
  });
});

describe('calendar items', () => {
  const base = {
    ItemId: { Id: 'AAMk1', ChangeKey: 'DwAA' },
    Subject: 'Синк',
    Start: '2026-10-07T10:00:00+03:00',
    End: '2026-10-07T10:30:00+03:00',
  };

  it('prefers JoinOnlineMeetingUrl, then location, then body', () => {
    const direct = mapCalendarItem({ ...base, JoinOnlineMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/19%3a1', Preview: 'https://x.zoom.us/j/1' })!;
    expect(direct.platform).toBe('teams');

    const loc = mapCalendarItem({ ...base, Location: { DisplayName: 'room / https://acme.zoom.us/j/555?pwd=1' } })!;
    expect(loc.joinUrl).toBe('https://acme.zoom.us/j/555?pwd=1');
    expect(loc.platform).toBe('zoom');

    const body = mapCalendarItem({ ...base, Preview: 'Подключайтесь: team.ktalk.ru/xyz.' })!;
    expect(body.joinUrl).toBe('https://team.ktalk.ru/xyz');
    expect(body.platform).toBe('ktalk');
  });

  it('drops non-http join links', () => {
    const e = mapCalendarItem({ ...base, JoinOnlineMeetingUrl: 'file:///C:/evil.exe' })!;
    expect(e.joinUrl).toBeUndefined();
  });

  it('maps response, organizer, recurrence and categories', () => {
    const e = mapCalendarItem({
      ...base,
      ResponseType: 'Tentative',
      Organizer: { Mailbox: { Name: 'Ирина' } },
      SeriesId: '0400000082',
      Categories: [{ Name: 'Красная' }, 'Синяя'],
      IsAllDayEvent: false,
    })!;
    expect(e.responseType).toBe('tentative');
    expect(e.organizer).toBe('Ирина');
    expect(e.isRecurring).toBe(true);
    expect(e.categories).toEqual(['Красная', 'Синяя']);
    expect(e.changeKey).toBe('DwAA');
    expect(mapCalendarItem({ ...base, IsOrganizer: true, ResponseType: 'NoResponseReceived' })!.responseType).toBe('organizer');
    expect(mapCalendarItem({ ...base, ResponseType: 'NoResponseReceived' })!.responseType).toBe('notResponded');
  });

  it('reads Body.Items and skips broken items', () => {
    const events = parseCalendarView({ Body: { Items: [base, { Subject: 'no dates' }, null] } });
    expect(events).toHaveLength(1);
    expect(parseCalendarView({})).toEqual([]);
  });
});

describe('GetCalendarEvent', () => {
  it('collects attendees in both shapes and the HTML body', () => {
    const json = {
      Body: {
        ResponseMessages: {
          Items: [
            {
              Items: [
                {
                  RequiredAttendees: [{ Mailbox: { Name: 'Анна', EmailAddress: 'a@x' }, ResponseType: 'Accept' }],
                  OptionalAttendees: { Attendee: { Mailbox: { EmailAddress: 'b@x' } } },
                  Body: { BodyType: 'HTML', Value: '<p>Повестка</p><ul><li>Один</li><li>Два</li></ul><a href="https://ex.com">тут</a>' },
                },
              ],
            },
          ],
        },
      },
    };
    const d = parseEventDetails(json);
    expect(d.attendees).toEqual([
      { name: 'Анна', email: 'a@x', kind: 'required', response: 'accepted' },
      { name: 'b@x', email: 'b@x', kind: 'optional', response: 'notResponded' },
    ]);
    expect(d.bodyText).toBe('Повестка\n• Один\n• Два\nтут (https://ex.com)');
    expect('bodyHtml' in d).toBe(false); // markup from a stranger's invite stays in the main process
  });

  it('decodes entities', () => {
    expect(htmlToText('a&nbsp;&amp;&#1103;&#x44F;')).toBe('a &яя');
  });
});

describe('payloads', () => {
  it('puts __type first everywhere (WCF requirement)', () => {
    const p = calendarViewPayload(new Date(2026, 9, 1), new Date(2026, 9, 2), 'Russian Standard Time');
    const check = (o: unknown): void => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return;
      const keys = Object.keys(o);
      if (keys.includes('__type')) expect(keys[0]).toBe('__type');
      Object.values(o).forEach(check);
    };
    check(p);
    expect(p.Body.CalendarId.BaseFolderId).toEqual({ __type: 'DistinguishedFolderId:#Exchange', Id: 'calendar' });
    expect(calendarViewPayload(new Date(), new Date(), 'UTC', { id: 'F1', changeKey: 'C1' }).Body.CalendarId.BaseFolderId).toEqual({
      __type: 'FolderId:#Exchange',
      Id: 'F1',
      ChangeKey: 'C1',
    });
  });

  it('form-encodes like OWA', () => {
    expect(formEncode(`{"a":"b c!'()*~"}`)).toBe('%7B%22a%22%3A%22b%20c%21%27%28%29%2A~%22%7D');
  });

  it('escapes ids in the RSVP envelope', () => {
    const soap = rsvpSoap('id"/><t:Evil', 'ck&1', 'tentative');
    expect(soap).toContain('<t:TentativelyAcceptItem>');
    expect(soap).toContain('Id="id&quot;/&gt;&lt;t:Evil" ChangeKey="ck&amp;1"');
    expect(rsvpSoap('x', undefined, 'decline')).toContain('<t:ReferenceItemId Id="x"/>');
  });

  it('reads the EWS response code of an RSVP answer', () => {
    // Used to be `extractEwsResponseCode`, which only read the code and let a missing one pass as success.
    expect(parseRsvpResponse('<m:CreateItemResponseMessage ResponseClass="Error"><m:ResponseCode>ErrorStaleObject</m:ResponseCode>')).toEqual({
      ok: false,
      code: 'ErrorStaleObject',
    });
  });

  it('finds the default calendar folder', () => {
    const json = {
      Body: {
        Folders: [
          { FolderId: { Id: 'birthdays' }, DisplayName: 'Birthdays' },
          { FolderId: { Id: 'main', ChangeKey: 'k' }, DisplayName: 'Календарь', IsDefaultCalendar: true },
        ],
      },
    };
    expect(defaultCalendarFolder(json)).toEqual({ id: 'main', changeKey: 'k' });
  });

  it('maps IANA zones to Windows ids', () => {
    expect(windowsTimezoneFromIana('Europe/Moscow')).toBe('Russian Standard Time');
    expect(windowsTimezoneFromIana('Asia/Novosibirsk')).toBe('N. Central Asia Standard Time');
  });
});
