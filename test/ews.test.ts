// The two EWS calls that change something on the server (CreateItem of a meeting, the RSVP) and the
// response limits around them. A server's answer is not trusted here: these tests feed the client
// what a compromised or broken Exchange can answer and check that nothing is sent twice and that
// nothing is reported as done unless the server said so.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'electron';

interface FakeCall {
  method: string;
  url: string;
  body: string;
}

interface FakeReply {
  status?: number;
  body?: string;
  /** A body of this many bytes instead of `body`: for the response size limit. */
  bytes?: number;
}

/** The fake Exchange the mocked Chromium stack answers from: one scripted reply per request. */
const srv = vi.hoisted(() => ({
  calls: [] as FakeCall[],
  reply: (() => ({})) as (call: FakeCall) => FakeReply,
  canary: 'canary-1' as string | undefined,
}));

vi.mock('electron', () => {
  type Listener = (...args: unknown[]) => void;
  class Emitter {
    private readonly listeners = new Map<string, Listener[]>();
    on(event: string, fn: Listener): this {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }
  }

  class FakeRequest extends Emitter {
    private sent = '';
    constructor(private readonly opts: { method?: string; url: string }) {
      super();
    }
    setHeader(): void {}
    write(chunk: string): void {
      this.sent += chunk;
    }
    abort(): void {}
    followRedirect(): void {}
    end(): void {
      setTimeout(() => {
        const call = { method: this.opts.method ?? 'GET', url: this.opts.url, body: this.sent };
        srv.calls.push(call);
        const reply = srv.reply(call);
        const res = new Emitter() as Emitter & { statusCode: number; headers: Record<string, string> };
        res.statusCode = reply.status ?? 200;
        res.headers = {};
        this.emit('response', res);
        setTimeout(() => {
          if (reply.bytes) res.emit('data', Buffer.alloc(reply.bytes, 0x61));
          else if (reply.body) res.emit('data', Buffer.from(reply.body, 'utf8'));
          res.emit('end');
        }, 0);
      }, 0);
    }
  }

  const ses = {
    clearStorageData: () => Promise.resolve(),
    setUserAgent: () => {},
    allowNTLMCredentialsForDomains: () => {},
    setCertificateVerifyProc: () => {},
    cookies: { get: () => Promise.resolve(srv.canary ? [{ name: 'X-OWA-CANARY', value: srv.canary, domain: 'mail.example.com' }] : []) },
  };

  return {
    net: { request: (opts: { method?: string; url: string }) => new FakeRequest(opts) },
    session: { fromPartition: () => ses },
    // The log must not touch the file system or the console from a test; every write is guarded.
    app: { isPackaged: true, getPath: () => { throw new Error('no log in tests'); } },
  };
});

const { OwaClient } = await import('../src/main/owa/client');
const { sendRequest } = await import('../src/main/owa/http');
const { OwaError } = await import('../src/main/owa/errors');
const { parseRsvpResponse, rsvpFailureText } = await import('../src/main/owa/payloads');

const BASE = 'https://mail.example.com';
const ORIGIN = 'mail.example.com';

/** An EWS answer, as the server writes it: the namespace prefix is its choice, not ours. */
function ewsAnswer(responseClass: string, code?: string, prefix = 'm'): string {
  const p = prefix ? `${prefix}:` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <${p}CreateItemResponse>
      <${p}ResponseMessages>
        <${p}CreateItemResponseMessage ResponseClass="${responseClass}">
          ${code ? `<${p}ResponseCode>${code}</${p}ResponseCode>` : ''}
          <${p}Items/>
        </${p}CreateItemResponseMessage>
      </${p}ResponseMessages>
    </${p}CreateItemResponse>
  </s:Body>
</s:Envelope>`;
}

const ewsCalls = () => srv.calls.filter((c) => c.url.includes('/EWS/Exchange.asmx'));

function client() {
  return new OwaClient({ serverUrl: BASE, partition: 'test-owa', useWindowsAuth: true });
}

const MEETING = {
  title: 'Синк',
  start: '2026-10-08T07:00:00.000Z',
  end: '2026-10-08T07:30:00.000Z',
  requiredAttendees: [] as string[],
  optionalAttendees: [] as string[],
  location: '',
  body: '',
  recurrence: { kind: 'none' as const },
};

beforeEach(() => {
  srv.calls.length = 0;
  srv.canary = 'canary-1';
  srv.reply = () => ({ status: 200, body: '' });
});

describe('createMeeting: a time zone Exchange refuses', () => {
  it('repeats the request without the zone when the meeting mails nobody', async () => {
    const answers = [ewsAnswer('Error', 'ErrorTimeZone'), ewsAnswer('Success', 'NoError')];
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: answers.shift() ?? '' } : { status: 200, body: '' });

    await client().createMeeting({ ...MEETING });

    const ews = ewsCalls();
    expect(ews).toHaveLength(2);
    expect(ews[0].body).toContain('SendMeetingInvitations="SendToNone"');
    expect(ews[0].body).toContain('TimeZoneContext');
    expect(ews[1].body).not.toContain('TimeZoneContext');
  });

  it('never repeats the request when the meeting has attendees: the invitations may be out', async () => {
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: ewsAnswer('Error', 'ErrorTimeZone') } : { status: 200, body: '' });

    const e = await client()
      .createMeeting({ ...MEETING, requiredAttendees: ['a@example.com'] })
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    expect(e).toBeInstanceOf(OwaError);
    expect((e as InstanceType<typeof OwaError>).kind).toBe('server');
    expect((e as Error).message).toMatch(/часовой пояс/);
    expect((e as Error).message).toMatch(/проверьте календарь/i);
    expect(ewsCalls()).toHaveLength(1);
  });

  it('does not repeat for an optional attendee either, whatever the code looks like', async () => {
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: ewsAnswer('Error', 'ErrorInvalidTimeZoneValue') } : { status: 200, body: '' });

    await expect(client().createMeeting({ ...MEETING, optionalAttendees: ['b@example.com'] })).rejects.toThrow(/часовой пояс/);
    expect(ewsCalls()).toHaveLength(1);
  });
});

describe('parseRsvpResponse', () => {
  it('needs an explicit success, whatever prefix the server uses', () => {
    expect(parseRsvpResponse(ewsAnswer('Success', 'NoError'))).toEqual({ ok: true });
    expect(parseRsvpResponse(ewsAnswer('Success', 'NoError', 'messages'))).toEqual({ ok: true });
    expect(parseRsvpResponse(ewsAnswer('Success', undefined, ''))).toEqual({ ok: true });
  });

  it('reads an error answer written with another prefix or none', () => {
    expect(parseRsvpResponse(ewsAnswer('Error', 'ErrorAccessDenied', 'messages'))).toEqual({ ok: false, code: 'ErrorAccessDenied' });
    expect(parseRsvpResponse(ewsAnswer('Error', 'ErrorAccessDenied', ''))).toEqual({ ok: false, code: 'ErrorAccessDenied' });
    expect(parseRsvpResponse(ewsAnswer('Warning', 'ErrorStaleObject'))).toEqual({ ok: false, code: 'ErrorStaleObject' });
  });

  it('refuses a success class that carries an error code, and an answer with no class at all', () => {
    expect(parseRsvpResponse(ewsAnswer('Success', 'ErrorAccessDenied'))).toEqual({ ok: false, code: 'ErrorAccessDenied' });
    expect(parseRsvpResponse('<m:ResponseCode>NoError</m:ResponseCode>')).toEqual({ ok: false, code: 'NoError' });
  });

  it('refuses anything that is not an EWS answer', () => {
    expect(parseRsvpResponse('<html><body><h1>403 Forbidden</h1></body></html>')).toEqual({ ok: false, code: undefined });
    expect(parseRsvpResponse('')).toEqual({ ok: false, code: undefined });
    expect(parseRsvpResponse('<s:Envelope><s:Body><s:Fault><faultstring>oops</faultstring></s:Fault></s:Body></s:Envelope>')).toEqual({ ok: false, code: undefined });
    // A code that is not a plain identifier is the server's text, never shown and never a success.
    expect(parseRsvpResponse(ewsAnswer('Success', 'не удалось'))).toEqual({ ok: false, code: undefined });
  });

  it('names the code when there is one and warns about the calendar when there is not', () => {
    expect(rsvpFailureText('ErrorAccessDenied')).toBe('Exchange: ErrorAccessDenied');
    expect(rsvpFailureText(undefined)).toMatch(/календар/i);
  });
});

describe('respond', () => {
  it('reports an error answer written with another namespace prefix', async () => {
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: ewsAnswer('Error', 'ErrorAccessDenied', 'messages') } : { status: 200, body: '' });
    await expect(client().respond('AAMk1', undefined, 'accept')).rejects.toThrow('Exchange: ErrorAccessDenied');
  });

  it('reports an HTML error page instead of calling the invitation answered', async () => {
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: '<html><body>Access blocked by policy</body></html>' } : { status: 200, body: '' });
    await expect(client().respond('AAMk1', undefined, 'decline')).rejects.toThrow(/не подтвердил ответ/);
  });

  it('accepts an answer whose success is explicit, with any prefix', async () => {
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: ewsAnswer('Success', 'NoError', 'messages') } : { status: 200, body: '' });
    await expect(client().respond('AAMk1', 'CK1', 'tentative')).resolves.toBeUndefined();
    expect(ewsCalls()).toHaveLength(1);
  });

  it('still repeats a stale change key once, without the change key', async () => {
    const answers = [ewsAnswer('Error', 'ErrorStaleObject'), ewsAnswer('Success', 'NoError')];
    srv.reply = (c) => (c.url.includes('/EWS/') ? { status: 200, body: answers.shift() ?? '' } : { status: 200, body: '' });

    await client().respond('AAMk1', 'CK1', 'accept');

    const ews = ewsCalls();
    expect(ews).toHaveLength(2);
    expect(ews[0].body).toContain('ChangeKey="CK1"');
    expect(ews[1].body).not.toContain('ChangeKey');
  });
});

describe('response body', () => {
  const creds = { host: ORIGIN, port: 443, origin: ORIGIN };
  const fakeSession = {} as unknown as Session;

  it('decodes the body once, however often text() is read', async () => {
    srv.reply = () => ({ status: 200, body: 'привет' });
    const res = await sendRequest(fakeSession, { url: `${BASE}/owa/` }, creds, {});

    const spy = vi.spyOn(Buffer.prototype, 'toString');
    const first = res.text();
    const second = res.text();
    const decodes = spy.mock.calls.filter(([encoding]) => encoding === 'utf8').length;
    spy.mockRestore();

    expect(first).toBe('привет');
    expect(second).toBe(first);
    expect(decodes).toBe(1);
  });

  it('refuses a body over the 8 MB limit', async () => {
    srv.reply = () => ({ status: 200, bytes: 9 * 1024 * 1024 });
    await expect(sendRequest(fakeSession, { url: `${BASE}/owa/` }, creds, {})).rejects.toThrow('Сервер прислал слишком большой ответ');
  });
});
