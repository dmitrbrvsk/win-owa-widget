import { describe, expect, it } from 'vitest';
import { detectMeetingUrl, detectPlatform, safeUrl } from '../src/shared/meetingUrl';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { parseRsvpAction, parseTrayStatus, sanitizeSettings, sanitizeUpdate, isFingerprint } from '../src/shared/validate';
import { htmlToText } from '../src/main/owa/parse';
import { redirectRefusal } from '../src/main/owa/redirect';

const FP = 'sha256/' + 'A'.repeat(43) + '=';

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
    expect(parseTrayStatus({ iconDataUrl: 'data:image/png;base64,AAAA', tooltip: 'x' })).not.toBeNull();
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
