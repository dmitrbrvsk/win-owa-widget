import { describe, expect, it } from 'vitest';
import { detectMeetingUrl, detectPlatform, safeUrl } from '../src/shared/meetingUrl';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { parseRsvpAction, parseTrayStatus, sanitizeSettings, sanitizeUpdate, isFingerprint } from '../src/shared/validate';
import { htmlToText } from '../src/main/owa/parse';
import { redirectRefusal } from '../src/main/owa/redirect';

const FP = 'sha256/' + 'A'.repeat(43) + '=';

/** A data URL that starts like a PNG of the given size (the rest is irrelevant to the header check). */
function png(w: number, h: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return 'data:image/png;base64,' + b.toString('base64');
}

describe('redirects', () => {
  it('allows the same host over https', () => {
    expect(redirectRefusal('https://mail.corp.ru/owa/auth/logon.aspx', 'mail.corp.ru')).toBeNull();
    expect(redirectRefusal('https://MAIL.corp.ru/owa/', 'mail.corp.ru')).toBeNull();
  });
  it('refuses another host, http and junk', () => {
    expect(redirectRefusal("https://evil.example/owa", "mail.corp.ru")).toMatch(/evil\.example/);
    expect(redirectRefusal('http://mail.corp.ru/owa', 'mail.corp.ru')).toMatch(/http/);
    expect(redirectRefusal('https://mail.corp.ru.evil.example/', 'mail.corp.ru')).not.toBeNull();
    expect(redirectRefusal('not a url', 'mail.corp.ru')).not.toBeNull();
  });
});

describe('settings from the renderer', () => {
  it('clamps numbers that could hammer the server', () => {
    const s = sanitizeSettings({ syncIntervalMinutes: NaN, reminderMinutes: 9999 }, DEFAULT_SETTINGS);
    expect(s.syncIntervalMinutes).toBe(DEFAULT_SETTINGS.syncIntervalMinutes);
    expect(s.reminderMinutes).toBe(60);
    expect(sanitizeSettings({ syncIntervalMinutes: 0 }, DEFAULT_SETTINGS).syncIntervalMinutes).toBe(1);
    expect(sanitizeSettings({ syncIntervalMinutes: -5 }, DEFAULT_SETTINGS).syncIntervalMinutes).toBe(1);
  });
  it('drops unknown keys, wrong types and bad enums', () => {
    const s = sanitizeSettings({ theme: 'neon', language: 5, evil: 1, account: { serverUrl: 42, useWindowsAuth: 'yes' } }, DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.language).toBe(DEFAULT_SETTINGS.language);
    expect('evil' in s).toBe(false);
    expect((s.account as { serverUrl: string }).serverUrl).toBe('');
  });
  it('never lets the renderer decide hasPassword', () => {
    const s = sanitizeSettings({ account: { hasPassword: true } }, DEFAULT_SETTINGS);
    expect(s.account.hasPassword).toBe(false);
  });
  it('accepts only well-formed fingerprints', () => {
    expect(isFingerprint(FP)).toBe(true);
    expect(isFingerprint('sha256/short')).toBe(false);
    expect(isFingerprint('"><script>')).toBe(false);
    expect(sanitizeSettings({ account: { trustedCertFingerprint: 'x' } }, DEFAULT_SETTINGS).account.trustedCertFingerprint).toBeUndefined();
  });
  it('caps the password length', () => {
    expect(sanitizeUpdate({ settings: {}, password: 'x'.repeat(5000) }, DEFAULT_SETTINGS).password).toHaveLength(1024);
  });
});

describe('IPC arguments', () => {
  it('rejects unknown RSVP actions', () => {
    expect(parseRsvpAction('accept')).toBe('accept');
    expect(() => parseRsvpAction('delete')).toThrow();
  });
  it('accepts only PNG data URLs for the tray icon', () => {
    expect(parseTrayStatus({ iconDataUrl: png(32, 32), tooltip: 'x' })).not.toBeNull();
    expect(parseTrayStatus({ iconDataUrl: png(4000, 4000), tooltip: 'x' })).toBeNull(); // a huge picture is not decoded
    expect(parseTrayStatus({ iconDataUrl: 'data:image/png;base64,AAAA', tooltip: 'x' })).toBeNull(); // not a PNG header
    expect(parseTrayStatus({ iconDataUrl: 'file:///etc/passwd', tooltip: 'x' })).toBeNull();
    expect(parseTrayStatus({ iconDataUrl: 'data:text/html;base64,AAAA', tooltip: 'x' })).toBeNull();
  });
});

describe('links', () => {
  it('rejects non-http schemes and look-alike userinfo', () => {
    expect(safeUrl('file:///C:/Windows/System32/calc.exe')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('ms-msdt:/id PCWDiagnostic')).toBeNull();
    expect(safeUrl('https://teams.microsoft.com@evil.example/')).toBeNull();
    expect(safeUrl('https://teams.microsoft.com/l/meetup-join/x')).not.toBeNull();
  });
  it('does not credit a platform to a link that only mentions it', () => {
    expect(detectPlatform('https://evil.example/?next=https://a.zoom.us/j/123')).toBe('generic');
    expect(detectPlatform('https://a.zoom.us/j/123')).toBe('zoom');
    expect(detectPlatform('https://teams.microsoft.com/l/meetup-join/abc')).toBe('teams');
  });
  it('does not take zoom.us as a suffix of another domain', () => {
    expect(detectMeetingUrl('https://a.zoom.us.evil.example/j/1')).toBeNull();
  });
});

describe('hostile input stays fast', () => {
  const time = (fn: () => unknown) => {
    const t = Date.now();
    fn();
    return Date.now() - t;
  };
  it('htmlToText on unclosed tags', () => {
    expect(time(() => htmlToText('<script'.repeat(60_000)))).toBeLessThan(500);
    expect(time(() => htmlToText('<head><a href="https://x.y">'.repeat(15_000)))).toBeLessThan(1000);
    expect(time(() => htmlToText('<'.repeat(400_000)))).toBeLessThan(500);
  });
  it('htmlToText still reads normal mail', () => {
    expect(htmlToText('<style>p{}</style><p>Hi <a href="https://a.b/c">link</a></p><script>x()</script>')).toBe('Hi link (https://a.b/c)');
  });
  it('meeting link scan on a huge blob', () => {
    expect(time(() => detectMeetingUrl('<'.repeat(1_000_000)))).toBeLessThan(300);
    expect(time(() => detectMeetingUrl('https://teams.microsoft.com/l/meetup-join/' + '.'.repeat(500_000) + 'x'))).toBeLessThan(300);
  });
});

describe('server address', () => {
  it('takes a host, a URL with a path, and ignores case', async () => {
    const { parseBaseUrl } = await import('../src/main/owa/serverUrl');
    expect(parseBaseUrl('mail.company.ru')).toBe('https://mail.company.ru');
    expect(parseBaseUrl('https://mail.company.ru/owa/#path')).toBe('https://mail.company.ru');
    expect(parseBaseUrl('  Mail.Company.ru:8443 ')).toBe('https://mail.company.ru:8443');
  });
  it('refuses an e-mail address: the host after @ would be the public web site', async () => {
    const { parseBaseUrl } = await import('../src/main/owa/serverUrl');
    const { checkServerUrl } = await import('../src/shared/serverUrl');
    expect(() => parseBaseUrl('ivanov@company.ru')).toThrow(/адрес почты/);
    expect(() => parseBaseUrl('https://user:pass@mail.company.ru')).toThrow(/адрес почты/);
    expect(checkServerUrl('ivanov@company.ru')).toEqual({ ok: false, problem: 'email' });
  });
  it('refuses http and bare words', async () => {
    const { parseBaseUrl } = await import('../src/main/owa/serverUrl');
    const { checkServerUrl } = await import('../src/shared/serverUrl');
    expect(() => parseBaseUrl('http://mail.company.ru')).toThrow(/https/);
    expect(() => parseBaseUrl('mail')).toThrow(/полное имя/);
    expect(() => parseBaseUrl('')).toThrow();
    expect(checkServerUrl('mail')).toEqual({ ok: false, problem: 'bare', detail: 'mail' });
    expect(checkServerUrl('')).toEqual({ ok: false, problem: 'empty' });
  });
});

describe('canary from the server', () => {
  it('accepts a token and rejects anything that could inject a header', async () => {
    const { validCanary } = await import('../src/main/owa/parse');
    expect(validCanary('abc123-_.~+/=%')).toBe('abc123-_.~+/=%');
    expect(validCanary('abc\r\nX-Injected: 1')).toBeUndefined();
    expect(validCanary('with space')).toBeUndefined();
    expect(validCanary('x'.repeat(600))).toBeUndefined();
    expect(validCanary(undefined)).toBeUndefined();
  });
});

describe('certificate wording', () => {
  it('explains the common Chromium errors', async () => {
    const { certReason } = await import('../src/main/owa/errors');
    expect(certReason('net::ERR_CERT_AUTHORITY_INVALID', -202)).toMatch(/не доверяет/);
    expect(certReason('net::ERR_CERT_COMMON_NAME_INVALID', -200)).toMatch(/другого имени/);
    expect(certReason('net::ERR_CERT_DATE_INVALID', -201)).toMatch(/просрочен/);
    expect(certReason('', -999)).toMatch(/-999/);
  });
});

describe('certificate pin on disk', () => {
  it('is read back only when well-formed and bound to a host', async () => {
    const { readStoredPin } = await import('../src/shared/validate');
    expect(readStoredPin({ account: { trustedCertFingerprint: FP, trustedCertHost: 'Mail.Corp.ru' } })).toEqual({ trustedCertFingerprint: FP, trustedCertHost: 'mail.corp.ru' });
    expect(readStoredPin({ account: { trustedCertFingerprint: FP } })).toEqual({});
    expect(readStoredPin({ account: { trustedCertFingerprint: 'bad', trustedCertHost: 'x' } })).toEqual({});
  });
});

describe('where the password may be posted', () => {
  const BASE = 'https://mail.corp.ru';
  const PAGE = `${BASE}/owa/auth/logon.aspx`;
  it('accepts OWA\'s own form', async () => {
    const { owaLoginForm } = await import('../src/main/owa/parse');
    const html = '<form action="/owa/auth.owa" method="POST"><input type="hidden" name="destination" value="https://mail.corp.ru/owa/"><input name="username"><input type="password" name="password"></form>';
    expect(owaLoginForm(html, PAGE, BASE)?.action).toBe(`${BASE}/owa/auth.owa`);
  });
  it('refuses a 404 page with a search form, a portal form and a form on another host', async () => {
    const { owaLoginForm } = await import('../src/main/owa/parse');
    expect(owaLoginForm('<h1>Not found</h1><form action="/search"><input name="q"></form>', PAGE, BASE)).toBeNull();
    expect(owaLoginForm('<form action="/my.policy" method="POST"><input type="password" name="password"></form>', PAGE, BASE)).toBeNull();
    expect(owaLoginForm('<form action="https://sso.corp.ru/owa/auth.owa"><input type="password" name="password"></form>', PAGE, BASE)).toBeNull();
    expect(owaLoginForm('<h1>Not found</h1>', PAGE, BASE)).toBeNull();
  });
});

describe('working hours setting', () => {
  it('keeps start before end and within the day', async () => {
    const { sanitizeSettings } = await import('../src/shared/validate');
    const ok = sanitizeSettings({ workdayStartHour: 9, workdayEndHour: 18 }, DEFAULT_SETTINGS);
    expect([ok.workdayStartHour, ok.workdayEndHour]).toEqual([9, 18]);
    const bad = sanitizeSettings({ workdayStartHour: 20, workdayEndHour: 8 }, DEFAULT_SETTINGS);
    expect([bad.workdayStartHour, bad.workdayEndHour]).toEqual([DEFAULT_SETTINGS.workdayStartHour, DEFAULT_SETTINGS.workdayEndHour]);
    expect(sanitizeSettings({ workdayStartHour: -3, workdayEndHour: 99 }, DEFAULT_SETTINGS).workdayEndHour).toBe(24);
  });
});

// ---------- Review round 2: what a hostile invitation, page or settings file may do ----------

describe('a hostile invitation cannot stall the app', () => {
  const time = (fn: () => unknown) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  const big = 'a'.repeat(20_000);

  it('link detection is linear on long runs of name characters (was 300 ms per 20 KB, per field, per meeting)', () => {
    expect(time(() => detectMeetingUrl(big))).toBeLessThan(60);
    expect(time(() => detectMeetingUrl('a-'.repeat(10_000)))).toBeLessThan(60);
    expect(time(() => detectMeetingUrl('a.'.repeat(10_000)))).toBeLessThan(60);
    expect(time(() => detectMeetingUrl('.ktalk.ru'.repeat(2_000)))).toBeLessThan(60);
  });

  it('a meeting with a hostile location and five hostile bodies maps in a few ms (was 2 s)', async () => {
    const { mapCalendarItem } = await import('../src/main/owa/parse');
    const body = { Value: big };
    const ms = time(() =>
      mapCalendarItem({ Subject: 's', Start: '2026-10-08T10:00:00', End: '2026-10-08T11:00:00', Location: { DisplayName: big }, TextBody: body, UniqueBody: body, Body: body, NormalizedBody: body, Preview: big }),
    );
    expect(ms).toBeLessThan(150);
  });

  it('htmlToText: unclosed links, long runs of spaces and tabs (was 8 s for 400 KB of anchors)', () => {
    expect(time(() => htmlToText('<a href="https://x.y">'.repeat(18_000)))).toBeLessThan(300);
    expect(time(() => htmlToText('<a href="https://x.y">t'.repeat(17_000)))).toBeLessThan(300);
    expect(time(() => htmlToText(' '.repeat(400_000) + 'x'))).toBeLessThan(300);
    expect(time(() => htmlToText('\t '.repeat(200_000)))).toBeLessThan(300);
    expect(time(() => htmlToText('&a'.repeat(200_000)))).toBeLessThan(300);
  });

  it('htmlToText keeps reading real links', () => {
    expect(htmlToText('<p>See <a href="https://a.b/c">the plan</a> and <A HREF="https://d.e">https://d.e</A>.</p>')).toBe('See the plan (https://a.b/c) and https://d.e.');
    expect(htmlToText('<a name="x">anchor</a> <a href="https://a.b/">ok</a>')).toBe('anchor ok (https://a.b/)');
  });

  it('the server page parsers are linear too (the login form pattern took over 20 s)', async () => {
    const { parseLoginForm, owaLoginForm, extractCanaryFromHtml } = await import('../src/main/owa/parse');
    const page = 'https://o.x.ru/owa/auth/logon.aspx';
    expect(time(() => parseLoginForm('<form action="/owa/auth.owa">' + '<input type="hidden" '.repeat(20_000), page, 'https://o.x.ru'))).toBeLessThan(300);
    expect(time(() => parseLoginForm('<form '.repeat(40_000), page, 'https://o.x.ru'))).toBeLessThan(300);
    expect(time(() => owaLoginForm('<input type="password"><form action="/owa/auth.owa">' + '<input '.repeat(400_000), page, 'https://o.x.ru'))).toBeLessThan(300);
    expect(time(() => extractCanaryFromHtml('X-OWA-CANARY'.repeat(1_000_000)))).toBeLessThan(500); // never finished in 60 s before
  });

  it('a flood of hidden fields is capped', async () => {
    const { parseLoginForm } = await import('../src/main/owa/parse');
    const html = '<form action="/owa/auth.owa">' + '<input type="hidden" name="a" value="b">'.repeat(5_000);
    expect(parseLoginForm(html, 'https://o.x.ru/owa/', 'https://o.x.ru').hiddenFields.length).toBeLessThanOrEqual(64);
  });
});

describe('link detection edge cases', () => {
  it('KTalk: the host must really be ktalk.ru', () => {
    expect(detectMeetingUrl('https://a.ktalk.ru.evil.example/x')).toBeNull();
    expect(detectMeetingUrl('team.ktalk.rus/x')).toBeNull();
    expect(detectMeetingUrl('x.ktalk.ru.')?.url).toBe('https://x.ktalk.ru/');
    expect(detectMeetingUrl('join: https://a.b.ktalk.ru/room/1, please')?.url).toBe('https://a.b.ktalk.ru/room/1');
    expect(detectMeetingUrl('Подключайтесь: team.ktalk.ru/xyz.')?.url).toBe('https://team.ktalk.ru/xyz');
  });
  it('the returned link is the normalized one and never carries hidden characters', () => {
    expect(safeUrl('https://a.zoom.us/j/1‮cod.exe')).toBeNull();
    expect(safeUrl('https://a.zoom.us/j/1\u0007')).toBeNull();
    expect(detectMeetingUrl('https://a.zoom.us/j/1‮txt')).toBeNull();
    expect(detectMeetingUrl('https://a.zoom.us/j/1')?.url).toBe('https://a.zoom.us/j/1');
  });
});

describe('server-supplied fields are clipped and cleaned', () => {
  const base = { ItemId: { Id: 'AAMk1', ChangeKey: 'DwAA' }, Start: '2026-10-07T10:00:00+03:00', End: '2026-10-07T10:30:00+03:00' };
  it('cuts long text and drops bidi overrides and control characters', async () => {
    const { mapCalendarItem } = await import('../src/main/owa/parse');
    const e = mapCalendarItem({ ...base, Subject: 'Отчёт ‮gpj.exe\u0007' + 'я'.repeat(5_000), Location: { DisplayName: 'x'.repeat(5_000) }, Organizer: { Mailbox: { Name: 'n'.repeat(5_000) } }, Preview: 'p'.repeat(50_000) })!;
    expect(e.title.length).toBeLessThanOrEqual(500);
    expect(e.title).not.toMatch(/[‮\u0007]/);
    expect(e.location!.length).toBeLessThanOrEqual(500);
    expect(e.organizer!.length).toBeLessThanOrEqual(200);
    expect(e.bodyPreview!.length).toBeLessThanOrEqual(600);
  });
  it('caps the number of meetings and attendees', async () => {
    const { parseCalendarView, parseEventDetails } = await import('../src/main/owa/parse');
    const items = Array.from({ length: 5_000 }, (_, i) => ({ ...base, Subject: `m${i}`, ItemId: { Id: `id${i}` } }));
    expect(parseCalendarView({ Body: { Items: items } }).length).toBe(3000);
    const many = Array.from({ length: 5_000 }, (_, i) => ({ Mailbox: { Name: `p${i}` } }));
    const d = parseEventDetails({ Body: { RequiredAttendees: many, OptionalAttendees: many } });
    expect(d.attendees.length).toBeLessThanOrEqual(1000);
  });
  it('survives absurd nesting', async () => {
    const { parseEventDetails, defaultCalendarFolder } = await import('../src/main/owa/parse');
    let deep: unknown = { RequiredAttendees: [{ Mailbox: { Name: 'x' } }] };
    for (let i = 0; i < 20_000; i++) deep = { n: deep };
    expect(() => parseEventDetails(deep)).not.toThrow();
    expect(() => defaultCalendarFolder(deep)).not.toThrow();
  });
  it('never sends markup from an invitation to the window', async () => {
    const { parseEventDetails } = await import('../src/main/owa/parse');
    const d = parseEventDetails({ Body: { Body: { Value: '<p onclick="x()">Hi</p><script>alert(1)</script>', BodyType: 'HTML' } } });
    expect(d.bodyText).toBe('Hi');
    expect(JSON.stringify(d)).not.toContain('script');
  });
});

describe('the password goes only where it was meant to', () => {
  it('a login form must be https, on this host and port, and post to auth.owa', async () => {
    const { owaLoginForm } = await import('../src/main/owa/parse');
    const base = 'https://owa.bank.ru';
    const page = `${base}/owa/auth/logon.aspx`;
    const form = (action: string) => `<form action="${action}"><input type="password" name="password"></form>`;
    expect(owaLoginForm(form('/owa/auth.owa'), page, base)?.action).toBe(`${base}/owa/auth.owa`);
    expect(owaLoginForm(form('http://owa.bank.ru/owa/auth.owa'), page, base)).toBeNull(); // cleartext on the same host
    expect(owaLoginForm(form('https://owa.bank.ru:8443/owa/auth.owa'), page, base)).toBeNull(); // another port
    expect(owaLoginForm(form('https://evil.example/owa/auth.owa'), page, base)).toBeNull();
    expect(owaLoginForm(form('/login'), page, base)).toBeNull();
    expect(owaLoginForm(form('//evil.example/owa/auth.owa'), page, base)).toBeNull();
  });

  it('the first request and every redirect stay on the configured https origin', async () => {
    const { requestRefusal, redirectRefusal } = await import('../src/main/owa/redirect');
    expect(requestRefusal('https://owa.bank.ru/owa/', 'owa.bank.ru')).toBeNull();
    expect(requestRefusal('http://owa.bank.ru/owa/auth.owa', 'owa.bank.ru')).not.toBeNull();
    expect(requestRefusal('https://owa.bank.ru:8443/x', 'owa.bank.ru')).not.toBeNull();
    expect(requestRefusal('https://owa.bank.ru:8443/x', 'owa.bank.ru:8443')).toBeNull();
    expect(redirectRefusal('https://owa.bank.ru:8443/x', 'owa.bank.ru')).not.toBeNull(); // another port is another service
    expect(redirectRefusal('https://owa.bank.ru/x', 'owa.bank.ru:8443')).not.toBeNull();
  });

  it('the saved password is released only for the server it was typed for', async () => {
    const { openSecret, sealSecret } = await import('../src/shared/secret');
    const sealed = sealSecret('s3cret', 'OWA.bank.ru');
    expect(openSecret(sealed, 'owa.bank.ru')).toEqual({ kind: 'ok', password: 's3cret' });
    expect(openSecret(sealed, 'evil.example')).toEqual({ kind: 'other-server' });
    expect(openSecret(sealed, '')).toEqual({ kind: 'other-server' });
    expect(openSecret(sealed, 'owa.bank.ru:8443')).toEqual({ kind: 'other-server' });
  });
  it('a password saved by an older version is recognized so it can be bound once', async () => {
    const { openSecret } = await import('../src/shared/secret');
    expect(openSecret('hunter2', 'owa.bank.ru')).toEqual({ kind: 'legacy', password: 'hunter2' });
    expect(openSecret('{"a":1}', 'owa.bank.ru')).toEqual({ kind: 'legacy', password: '{"a":1}' });
  });
  it('server identity is host plus port, lower case', async () => {
    const { serverKey } = await import('../src/shared/serverUrl');
    expect(serverKey('OWA.Bank.ru')).toBe('owa.bank.ru');
    expect(serverKey('https://owa.bank.ru:8443/owa')).toBe('owa.bank.ru:8443');
    expect(serverKey('https://owa.bank.ru:443/owa')).toBe('owa.bank.ru');
    expect(serverKey('user@bank.ru')).toBe('');
    expect(serverKey('')).toBe('');
  });
});

describe('what a hotkey may open', () => {
  it('only meetings the person answered yes to or runs', async () => {
    const { isEngaged } = await import('../src/shared/events');
    const e = (responseType: string) => ({ responseType }) as never;
    expect(isEngaged(e('accepted'))).toBe(true);
    expect(isEngaged(e('tentative'))).toBe(true);
    expect(isEngaged(e('organizer'))).toBe(true);
    expect(isEngaged(e('notResponded'))).toBe(false);
    expect(isEngaged(e('declined'))).toBe(false);
  });
});

describe('the event cache file', () => {
  it('is rebuilt field by field; junk gives an empty list', async () => {
    const { sanitizeEvents } = await import('../src/shared/validate');
    expect(sanitizeEvents(null)).toEqual([]);
    expect(sanitizeEvents({ events: [] })).toEqual([]);
    expect(sanitizeEvents([1, 'x', null, { id: 5 }])).toEqual([]);
    const ok = {
      id: 'a',
      title: 'T‮',
      start: '2026-10-07T07:00:00.000Z',
      end: '2026-10-07T08:00:00.000Z',
      joinUrl: 'javascript:alert(1)',
      platform: 'zoom',
      responseType: 'owner',
      evil: 1,
    };
    const [e] = sanitizeEvents([ok]);
    expect(e.title).toBe('T');
    expect(e.joinUrl).toBeUndefined();
    expect(e.platform).toBe('generic');
    expect(e.responseType).toBe('notResponded');
    expect('evil' in e).toBe(false);
    expect(sanitizeEvents([{ ...ok, start: 'soon' }])).toEqual([]);
  });
});

describe('the log and dialogs cannot be forged by foreign text', () => {
  it('keeps one entry on one line', async () => {
    const { logLine, oneLine } = await import('../src/shared/text');
    expect(logLine('a\nINFO fake entry\r\nb')).not.toMatch(/[\r\n]/);
    expect(oneLine('CN=Evil\n\nОтпечаток: sha256/forged‮', 200)).toBe('CN=Evil Отпечаток: sha256/forged');
    expect(oneLine('x'.repeat(1000), 50)).toHaveLength(50);
  });
});
