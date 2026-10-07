// OWA client: the same requests the Outlook Web App makes (service.svc JSON + EWS SOAP).
// Port of OWAClient.swift on top of Chromium's network stack.
import { session as electronSession, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CalendarEvent, EventDetails, RsvpAction } from '../../shared/types';
import { configureSession, OwaError, sendRequest, type CertState, type HttpRequest, type HttpResponse } from './http';
import {
  calendarEventPayload,
  calendarViewPayload,
  extractEwsResponseCode,
  formEncode,
  isStaleChangeKeyCode,
  rsvpElementName,
  rsvpSoap,
  type FolderIdentifier,
} from './payloads';
import {
  defaultCalendarFolder,
  extractCanaryFromHtml,
  fallbackLoginForm,
  isSessionStaleStatus,
  loginFormBody,
  looksLikeOwaLogon,
  parseCalendarView,
  parseEventDetails,
  parseLoginForm,
} from './parse';
import { windowsTimezoneId } from './timezone';

export interface OwaClientOptions {
  serverUrl: string;
  useWindowsAuth: boolean;
  username?: string;
  password?: string;
  trustedFingerprint?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const OWA_BUILD = '15.2.1748.10';

export function parseBaseUrl(input: string): string {
  let cleaned = input.trim();
  if (!/^https?:\/\//i.test(cleaned)) cleaned = `https://${cleaned}`;
  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    throw new OwaError('other', 'Некорректный адрес сервера');
  }
  // Credentials never travel over cleartext HTTP.
  if (u.protocol !== 'https:') throw new OwaError('other', 'Нужен адрес с https://');
  return `https://${u.host}`;
}

export class OwaClient {
  readonly base: string;
  readonly host: string;
  private readonly ses: Session;
  private readonly cert: CertState = {};
  private canary?: string;
  private folder?: FolderIdentifier;
  private forceDistinguishedFolder = false;
  private authInFlight?: Promise<void>;

  constructor(private readonly opts: OwaClientOptions) {
    this.base = parseBaseUrl(opts.serverUrl);
    this.host = new URL(this.base).hostname;
    // In-memory partition (no "persist:" prefix): cookies live only as long as the app runs.
    this.ses = electronSession.fromPartition(`owa-${randomUUID()}`, { cache: false });
    this.ses.setUserAgent(USER_AGENT, 'ru-RU,ru,en-US,en');
    configureSession(this.ses, this.host, { useWindowsAuth: opts.useWindowsAuth, trustedFingerprint: opts.trustedFingerprint }, this.cert);
  }

  private send(req: HttpRequest): Promise<HttpResponse> {
    return sendRequest(this.ses, req, { host: this.host, username: this.opts.username, password: this.opts.password }, this.cert);
  }

  private url(path: string) {
    return `${this.base}${path}`;
  }

  // ---------- Auth ----------

  async authenticate(): Promise<void> {
    if (!this.authInFlight) {
      this.authInFlight = this.doAuthenticate().finally(() => (this.authInFlight = undefined));
    }
    return this.authInFlight;
  }

  private async cookieCanary(): Promise<string | undefined> {
    const cookies = await this.ses.cookies.get({ name: 'X-OWA-CANARY' });
    return cookies.find((c) => !c.domain || this.host.endsWith(c.domain.replace(/^\./, '')))?.value ?? cookies[0]?.value;
  }

  private async doAuthenticate(): Promise<void> {
    this.canary = undefined;
    await this.ses.clearStorageData({ storages: ['cookies'] });

    // Path A — Integrated Windows Auth. With SSO the server answers 401 Negotiate/NTLM and
    // Chromium completes the handshake (signed-in user, or the stored login/password via the
    // `login` event). A plain GET /owa/ then returns the page and the CANARY cookie.
    const page = await this.send({ url: this.url('/owa/'), headers: { Accept: 'text/html,*/*;q=0.9' } });
    this.canary = (await this.cookieCanary()) ?? extractCanaryFromHtml(page.text());
    if (this.canary) return;

    // Path B — classic OWA forms login.
    if (!this.opts.username || !this.opts.password) {
      if (page.status === 401 || looksLikeOwaLogon(page.url, page.text())) {
        throw new OwaError('auth', this.opts.useWindowsAuth ? 'Вход Windows не подошёл — укажите логин и пароль' : 'Укажите логин и пароль', page.status);
      }
      throw new OwaError('server', `Не удалось войти в OWA (HTTP ${page.status})`, page.status);
    }

    const form = looksLikeOwaLogon(page.url, page.text())
      ? parseLoginForm(page.text(), page.url, this.base)
      : await this.fetchLoginForm();

    const actionHost = new URL(form.action).hostname.toLowerCase();
    if (actionHost !== this.host.toLowerCase()) {
      throw new OwaError('loginHost', `Форма входа отправляет пароль на другой хост: ${actionHost}`);
    }

    const auth = await this.send({
      method: 'POST',
      url: form.action,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: form.referer,
        Origin: this.base,
        Accept: 'text/html,*/*;q=0.9',
      },
      body: loginFormBody(form, this.opts.username, this.opts.password),
    });

    this.canary = (await this.cookieCanary()) ?? extractCanaryFromHtml(auth.text());
    if (!this.canary) {
      const again = await this.send({ url: this.url('/owa/'), headers: { Accept: 'text/html,*/*;q=0.9' } });
      this.canary = (await this.cookieCanary()) ?? extractCanaryFromHtml(again.text());
    }
    if (this.canary) return;

    if (looksLikeOwaLogon(auth.url, auth.text())) throw new OwaError('auth', 'Exchange не принял логин или пароль', auth.status);
    if (auth.status === 401 || auth.status === 440) throw new OwaError('auth', `Сервер отклонил вход (HTTP ${auth.status})`, auth.status);
    throw new OwaError('network', 'OWA недоступен — возможно, выключен VPN', auth.status);
  }

  private async fetchLoginForm() {
    try {
      const res = await this.send({ url: this.url('/owa/auth/logon.aspx?replaceCurrent=1&url=' + encodeURIComponent(this.url('/owa/'))) });
      return parseLoginForm(res.text(), res.url, this.base);
    } catch (e) {
      if (e instanceof OwaError && e.kind !== 'server') throw e;
      return fallbackLoginForm(this.base);
    }
  }

  private async ensureCanary(): Promise<string> {
    if (!this.canary) await this.authenticate();
    const fresh = await this.cookieCanary();
    if (fresh) this.canary = fresh;
    if (!this.canary) throw new OwaError('auth', 'Нет сессии OWA');
    return this.canary;
  }

  // ---------- service.svc ----------

  private async service(
    action: string,
    payload: unknown,
    mode: 'header' | 'body',
    extra?: { query?: Record<string, string>; headers?: Record<string, string> },
  ): Promise<HttpResponse> {
    const canary = await this.ensureCanary();
    const qs = new URLSearchParams({ action, EP: '1', ...(extra?.query ?? {}) });
    const json = JSON.stringify(payload);
    const correlation = `${randomUUID()}_${Date.now()}`;
    const headers: Record<string, string> = {
      'Content-Type': mode === 'body' ? 'application/json; charset=UTF-8' : 'application/json',
      Accept: '*/*',
      'X-OWA-CANARY': canary,
      Action: action,
      'X-Requested-With': 'XMLHttpRequest',
      'X-OWA-CorrelationId': correlation,
      'client-request-id': correlation,
      'X-OWA-ClientBuildVersion': OWA_BUILD,
      Origin: this.base,
      ...(extra?.headers ?? {}),
    };
    if (mode === 'header') headers['X-OWA-UrlPostData'] = formEncode(json);
    return this.send({
      method: 'POST',
      url: this.url(`/owa/service.svc?${qs}`),
      headers,
      body: mode === 'body' ? json : '',
      timeoutMs: 30_000,
    });
  }

  /** Runs `call`, re-authenticating once when the session went stale. */
  private async withSession(call: () => Promise<HttpResponse>, what: string): Promise<HttpResponse> {
    let res = await call();
    if (isSessionStaleStatus(res.status)) {
      this.canary = undefined;
      await this.authenticate();
      res = await call();
    }
    if (res.status < 200 || res.status >= 300) {
      const snippet = res.text().slice(0, 300);
      if (isSessionStaleStatus(res.status)) throw new OwaError('auth', `Сессия OWA отклонена (HTTP ${res.status})`, res.status);
      throw new OwaError('server', `${what}: HTTP ${res.status}`, res.status, snippet);
    }
    return res;
  }

  private async resolveFolder(): Promise<FolderIdentifier | undefined> {
    if (this.forceDistinguishedFolder) return undefined;
    if (this.folder) return this.folder;
    try {
      const res = await this.service('GetCalendarFolders', {}, 'header');
      if (res.status >= 200 && res.status < 300) this.folder = defaultCalendarFolder(JSON.parse(res.text()));
    } catch {
      /* fall back to the distinguished "calendar" folder */
    }
    return this.folder;
  }

  async fetchCalendarView(start: Date, end: Date): Promise<CalendarEvent[]> {
    const tz = await windowsTimezoneId();
    const run = async () => {
      const folder = await this.resolveFolder();
      return this.service('GetCalendarView', calendarViewPayload(start, end, tz, folder), 'header');
    };

    // Exchange sometimes answers a fresh session with a transient 500 "Cannot create an
    // abstract class"; with a FolderId it is permanent on some builds → use the distinguished id.
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.withSession(run, 'GetCalendarView');
        return parseCalendarView(JSON.parse(res.text()));
      } catch (e) {
        const abstractFault = e instanceof OwaError && e.status === 500 && /abstract class/i.test(e.detail ?? '');
        if (!abstractFault || attempt >= 3) throw e;
        if (this.folder && !this.forceDistinguishedFolder) {
          this.forceDistinguishedFolder = true;
          this.folder = undefined;
        } else {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
    }
  }

  async fetchDetails(itemId: string, changeKey?: string): Promise<EventDetails> {
    const tz = await windowsTimezoneId();
    const res = await this.withSession(
      () =>
        this.service('GetCalendarEvent', calendarEventPayload(itemId, changeKey, tz), 'body', {
          query: { ID: '-1725', AC: '1' },
          headers: { 'X-OWA-ActionId': '-1725', 'X-OWA-ActionName': 'GetCalendarEventAction', 'X-OWA-Attempt': '1' },
        }),
      'GetCalendarEvent',
    );
    return parseEventDetails(JSON.parse(res.text()));
  }

  // ---------- EWS ----------

  async respond(itemId: string, changeKey: string | undefined, action: RsvpAction): Promise<void> {
    if (!this.canary) await this.authenticate(); // a GET first: some servers drop a POST on a fresh NTLM connection
    const call = (ck: string | undefined) =>
      this.send({
        method: 'POST',
        url: this.url('/EWS/Exchange.asmx'),
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://schemas.microsoft.com/exchange/services/2006/messages/CreateItem"',
        },
        body: rsvpSoap(itemId, ck, action),
        timeoutMs: 20_000,
      });

    const res = await this.withSession(() => call(changeKey), rsvpElementName(action));
    const code = extractEwsResponseCode(res.text());
    if (!code || code === 'NoError') return;
    if (changeKey && isStaleChangeKeyCode(code)) {
      const retry = await this.withSession(() => call(undefined), rsvpElementName(action));
      const retryCode = extractEwsResponseCode(retry.text());
      if (!retryCode || retryCode === 'NoError') return;
      throw new OwaError('server', `Exchange: ${retryCode}`);
    }
    throw new OwaError('server', `Exchange: ${code}`);
  }

  dispose() {
    void this.ses.clearStorageData();
  }
}
