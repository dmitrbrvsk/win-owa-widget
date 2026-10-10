// OWA client: the same requests the Outlook Web App makes (service.svc JSON + EWS SOAP).
// Port of OWAClient.swift on top of Chromium's network stack.
import { session as electronSession, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AvailabilityResult, CalendarEvent, CertInfo, CreateMeetingInput, EditMeetingInput, EventDetails, MeetingBefore, PersonSuggestion, RsvpAction } from '../../shared/types';
import { configureSession, OwaError, sendRequest, type CertState, type HttpRequest, type HttpResponse } from './http';
import { parseBaseUrl } from './serverUrl';
import { safeUrlForLog } from '../log';
import { oneLine } from '../../shared/text';
import { normalizeEmail } from '../../shared/email';
import { SLOT_MINUTES } from '../../shared/availability';
import type { LoginForm } from './parse';
import { validCanary } from './parse';
export { parseBaseUrl } from './serverUrl';
import {
  calendarEventPayload,
  calendarViewPayload,
  formEncode,
  isStaleChangeKeyCode,
  parseRsvpResponse,
  rsvpElementName,
  rsvpFailureText,
  rsvpSoap,
  type FolderIdentifier,
} from './payloads';
import { log } from '../log';
import {
  defaultCalendarFolder,
  extractCanaryFromHtml,
  isSessionStaleStatus,
  formActionOf,
  loginFormBody,
  looksLikeOwaLogon,
  owaLoginForm,
  parseCalendarView,
  parseEventDetails,
} from './parse';
import { windowsTimezoneId } from './timezone';
import {
  cancelMeetingSoap,
  CREATE_ITEM_ACTION,
  RESOLVE_NAMES_ACTION,
  RESOLVE_QUIET_CODES,
  createFailureText,
  createMeetingSoap,
  deliveryUncertain,
  isTimeZoneCode,
  parseCreateItemResponse,
  parseResolveNames,
  resolveNamesSoap,
  updateFailureText,
  updateMeetingSoap,
  UPDATE_ITEM_ACTION,
  type MeetingField,
} from './ewsMeeting';
import { availabilityTimeZone, parseAvailabilityResponse, parseOwnAddress, soapFaultCode, userAvailabilitySoap } from './availability';

export interface OwaClientOptions {
  serverUrl: string;
  /** In-memory session partition; reused between clients so that rebuilding one does not grow memory. */
  partition?: string;
  useWindowsAuth: boolean;
  username?: string;
  password?: string;
  trustedFingerprint?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const OWA_BUILD = '15.2.1748.10';


export class OwaClient {
  readonly base: string;
  readonly host: string;
  /** `host[:port]`, the one origin this client talks to. */
  private readonly origin: string;
  private readonly port: number;
  private readonly ses: Session;
  private readonly cert: CertState = {};
  private canary?: string;
  private folder?: FolderIdentifier;
  private forceDistinguishedFolder = false;
  private authInFlight?: Promise<void>;
  /** The signed-in user's address: undefined = not asked yet, null = could not be read. */
  private ownEmail?: string | null;

  constructor(private readonly opts: OwaClientOptions) {
    this.base = parseBaseUrl(opts.serverUrl);
    const baseUrl = new URL(this.base);
    this.host = baseUrl.hostname;
    this.origin = baseUrl.host;
    this.port = Number(baseUrl.port || 443);
    // In-memory partition (no "persist:" prefix): cookies live only as long as the app runs. The
    // partition is reused, so a new client starts by clearing whatever the previous one left.
    this.ses = electronSession.fromPartition(opts.partition ?? 'owa', { cache: false });
    void this.ses.clearStorageData();
    this.ses.setUserAgent(USER_AGENT, 'ru-RU,ru,en-US,en');
    configureSession(this.ses, this.host, { useWindowsAuth: opts.useWindowsAuth, trustedFingerprint: opts.trustedFingerprint }, this.cert);
  }

  /** The certificate this server last presented and Windows rejected, if any. */
  get untrustedCert(): CertInfo | undefined {
    return this.cert.lastUntrusted;
  }

  private send(req: HttpRequest): Promise<HttpResponse> {
    return sendRequest(this.ses, req, { host: this.host, port: this.port, origin: this.origin, username: this.opts.username, password: this.opts.password }, this.cert);
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
    return validCanary(cookies.find((c) => !c.domain || this.host.endsWith(c.domain.replace(/^\./, '')))?.value ?? cookies[0]?.value);
  }

  private async doAuthenticate(): Promise<void> {
    this.canary = undefined;
    await this.ses.clearStorageData({ storages: ['cookies'] });

    // Path A — Integrated Windows Auth. With SSO the server answers 401 Negotiate/NTLM and
    // Chromium completes the handshake (signed-in user, or the stored login/password via the
    // `login` event). A plain GET /owa/ then returns the page and the CANARY cookie.
    const page = await this.send({ url: this.url('/owa/'), headers: { Accept: 'text/html,*/*;q=0.9' } });
    this.canary = (await this.cookieCanary()) ?? validCanary(extractCanaryFromHtml(page.text()));
    if (this.canary) {
      log.info(`auth: session established via GET /owa/ (HTTP ${page.status})`);
      return;
    }

    const logonPage = looksLikeOwaLogon(page.url, page.text());
    log.info(`auth: GET /owa/ → HTTP ${page.status}, no canary, ${logonPage ? 'OWA logon page' : 'not a logon page'}`);

    // Path B — classic OWA forms login.
    if (!this.opts.username || !this.opts.password) {
      if (page.status === 401 || logonPage) {
        throw new OwaError('auth', this.opts.useWindowsAuth ? 'Вход Windows не подошёл — укажите логин и пароль' : 'Укажите логин и пароль', page.status);
      }
      throw this.notOwa(page);
    }

    // The password goes only to OWA's own logon form (…/auth.owa on this host), never to whatever form a page happens to have.
    const form = (logonPage ? owaLoginForm(page.text(), page.url, this.base) : null) ?? (await this.fetchLoginForm(page));

    const action = new URL(form.action);
    if (action.protocol !== 'https:' || action.host.toLowerCase() !== this.origin.toLowerCase()) {
      throw new OwaError('loginHost', `Форма входа отправляет пароль не на ${this.origin} по https: ${oneLine(action.protocol + '//' + action.host, 120)}`);
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

    this.canary = (await this.cookieCanary()) ?? validCanary(extractCanaryFromHtml(auth.text()));
    if (!this.canary) {
      const again = await this.send({ url: this.url('/owa/'), headers: { Accept: 'text/html,*/*;q=0.9' } });
      this.canary = (await this.cookieCanary()) ?? validCanary(extractCanaryFromHtml(again.text()));
      log.info(`auth: form POST → HTTP ${auth.status}; GET /owa/ again → HTTP ${again.status}, canary ${this.canary ? 'found' : 'missing'}`);
    } else {
      log.info(`auth: form POST → HTTP ${auth.status}, canary found`);
    }
    if (this.canary) return;

    if (looksLikeOwaLogon(auth.url, auth.text())) throw new OwaError('auth', 'Exchange не принял логин или пароль', auth.status);
    if (auth.status === 401 || auth.status === 440) throw new OwaError('auth', `Сервер отклонил вход (HTTP ${auth.status})`, auth.status);
    throw new OwaError('server', `Сервер принял форму входа (HTTP ${auth.status}), но сессия OWA не появилась`, auth.status);
  }

  /** The logon page is fetched from the server and must carry OWA's own form before any password is posted. */
  private async fetchLoginForm(owaPage: HttpResponse): Promise<LoginForm> {
    const res = await this.send({ url: this.url('/owa/auth/logon.aspx?replaceCurrent=1&url=' + encodeURIComponent(this.url('/owa/'))) });
    const form = res.status >= 200 && res.status < 300 ? owaLoginForm(res.text(), res.url, this.base) : null;
    if (form) return form;
    const action = formActionOf(res.text());
    let target = action ?? '';
    try {
      if (action) target = safeUrlForLog(new URL(action.replaceAll('&amp;', '&'), res.url).toString());
    } catch {
      /* the raw (already cleaned) text is shown instead */
    }
    log.warn(`auth: /owa/auth/logon.aspx → HTTP ${res.status}, ${action ? `form posts to ${target}` : 'no login form'}; password not sent`);
    if (res.status >= 200 && res.status < 300 && action) {
      throw new OwaError('server', `Страница входа на ${this.host} не похожа на форму OWA (отправляет данные на ${target}). Пароль не отправлен`, res.status);
    }
    throw this.notOwa(owaPage);
  }

  /** A clear message for a server that answers but is not Outlook Web App. */
  private notOwa(page: HttpResponse): OwaError {
    const where = `${this.base}/owa/`;
    if (page.status === 404 || page.status === 410) return new OwaError('server', `По адресу ${where} нет OWA (HTTP ${page.status}). Проверьте адрес сервера`, page.status);
    if (page.status >= 500) return new OwaError('server', `Сервер ${this.host} отвечает ошибкой (HTTP ${page.status})`, page.status);
    if (page.status === 403) return new OwaError('server', `Сервер ${this.host} запретил доступ (HTTP 403)`, page.status);
    return new OwaError('server', `Страница ${where} не похожа на Outlook Web App (HTTP ${page.status}). Проверьте адрес сервера`, page.status);
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
  private async withSession(call: () => Promise<HttpResponse>, what: string, snippetChars = 300): Promise<HttpResponse> {
    let res = await call();
    if (isSessionStaleStatus(res.status)) {
      this.canary = undefined;
      await this.authenticate();
      res = await call();
    }
    if (res.status < 200 || res.status >= 300) {
      const snippet = res.text().slice(0, snippetChars);
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
    } catch (e) {
      // Only a server-side failure of this optional call falls back to the distinguished "calendar"
      // folder. Login, network and certificate problems are reported, not retried with a second login.
      if (e instanceof OwaError && e.kind !== 'server') throw e;
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

  // ---------- EWS: create a meeting, look up people ----------

  /**
   * One EWS call over the same session as `respond()`: a GET first on a fresh session (some servers
   * drop a POST on a new NTLM connection), one re-login when the session went stale, the same
   * headers. Only the configured server is ever addressed (`send` refuses any other origin).
   * Answers 200 and 500 (a SOAP fault) are handed back to be read; any other status is an error.
   * With `changes`, a network failure after the request may have reached the server is reported as
   * "unclear whether it was done", so that nobody sends the same invitation twice.
   */
  private async ews(soap: string, action: string, what: string, timeoutMs: number, changes = false): Promise<HttpResponse> {
    if (!this.canary) await this.authenticate();
    let mayHaveReached = false;
    const call = async () => {
      mayHaveReached = true;
      const res = await this.send({
        method: 'POST',
        url: this.url('/EWS/Exchange.asmx'),
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
        body: soap,
        timeoutMs,
      });
      // 401 / 440 / 449: the server turned the request down before doing anything, so repeating it cannot double it.
      if (isSessionStaleStatus(res.status)) mayHaveReached = false;
      return res;
    };
    try {
      let res = await call();
      if (isSessionStaleStatus(res.status)) {
        this.canary = undefined;
        await this.authenticate();
        res = await call();
      }
      if (isSessionStaleStatus(res.status)) throw new OwaError('auth', `Сессия OWA отклонена (HTTP ${res.status})`, res.status);
      if (res.status !== 200 && res.status !== 500) throw new OwaError('server', `${what}: HTTP ${res.status}`, res.status);
      return res;
    } catch (e) {
      if (changes && mayHaveReached && deliveryUncertain(e)) {
        throw new OwaError('network', 'Нет ответа от сервера: встреча могла быть создана. Проверьте календарь, прежде чем отправлять ещё раз', undefined, (e as OwaError).detail);
      }
      throw e;
    }
  }

  /**
   * Creates the meeting (and sends the invitations when it has attendees). Not repeated on a failure:
   * a repeat after an unclear answer could send everyone a second invitation. Only "Exchange does
   * not know this time zone" is retried, and only for a meeting without attendees — that one goes
   * out with SendToNone, so the refused request cannot have mailed anyone. The response code is the
   * server's to write: with attendees it is no promise that nothing was sent, so nothing is repeated.
   */
  async createMeeting(meeting: CreateMeetingInput): Promise<void> {
    const zone = await windowsTimezoneId();
    const attempt = async (timeZoneId: string | undefined) => parseCreateItemResponse((await this.ews(createMeetingSoap(meeting, timeZoneId), CREATE_ITEM_ACTION, 'CreateItem', 45_000, true)).text());
    const mailsNobody = meeting.requiredAttendees.length + meeting.optionalAttendees.length === 0;
    let outcome = await attempt(zone);
    if (!outcome.ok && isTimeZoneCode(outcome.code)) {
      if (!mailsNobody) {
        log.warn(`createMeeting: Exchange refused the time zone (${outcome.code}); not repeated, the invitations may already be out`);
        throw new OwaError(
          'server',
          'Exchange не принял часовой пояс этого компьютера. Приглашения могли уже уйти — проверьте календарь, прежде чем отправлять ещё раз',
          undefined,
          outcome.code,
        );
      }
      log.warn(`createMeeting: Exchange refused the time zone (${outcome.code}); repeating without it`);
      outcome = await attempt(undefined);
    }
    if (!outcome.ok) {
      log.warn(`createMeeting: not created (${outcome.kind}${outcome.code ? `, ${outcome.code}` : ''})`);
      throw new OwaError('server', createFailureText(outcome), undefined, outcome.code);
    }
    log.info('createMeeting: created');
  }

  /**
   * Changes a meeting that already exists, telling whoever is invited. Never repeated on a failure:
   * a second UpdateItem after an unclear answer would mail everyone a second "updated" notice.
   */
  async updateMeeting(before: MeetingBefore, after: EditMeetingInput, fields: readonly MeetingField[]): Promise<void> {
    const zone = await windowsTimezoneId();
    const outcome = parseCreateItemResponse(
      (await this.ews(updateMeetingSoap(before, after, fields, zone), UPDATE_ITEM_ACTION, 'UpdateItem', 45_000, true)).text(),
    );
    if (!outcome.ok) {
      log.warn(`updateMeeting: not changed (${outcome.kind}${outcome.code ? `, ${outcome.code}` : ''})`);
      throw new OwaError('server', updateFailureText(outcome), undefined, outcome.code);
    }
    log.info(`updateMeeting: changed (${fields.length} field(s))`);
  }

  /** Calls the meeting off and tells everyone invited. Never repeated, for the same reason. */
  async cancelMeeting(id: string, changeKey: string | undefined): Promise<void> {
    const outcome = parseCreateItemResponse((await this.ews(cancelMeetingSoap(id, changeKey), CREATE_ITEM_ACTION, 'CancelCalendarItem', 45_000, true)).text());
    if (!outcome.ok) {
      log.warn(`cancelMeeting: not cancelled (${outcome.kind}${outcome.code ? `, ${outcome.code}` : ''})`);
      throw new OwaError('server', updateFailureText(outcome), undefined, outcome.code);
    }
    log.info('cancelMeeting: cancelled');
  }

  /** Directory lookup for the recipients field: at most 8 people with a valid SMTP address. */
  async resolveNames(query: string): Promise<PersonSuggestion[]> {
    const res = await this.ews(resolveNamesSoap(query), RESOLVE_NAMES_ACTION, 'ResolveNames', 15_000);
    const { people, code } = parseResolveNames(res.text(), 8);
    if (!people.length && code && !RESOLVE_QUIET_CODES.includes(code)) throw new OwaError('server', `Exchange: ${code}`);
    return people;
  }

  // ---------- EWS ----------

  async respond(itemId: string, changeKey: string | undefined, action: RsvpAction, message?: string): Promise<void> {
    if (!this.canary) await this.authenticate(); // a GET first: some servers drop a POST on a fresh NTLM connection
    const call = (ck: string | undefined) =>
      this.send({
        method: 'POST',
        url: this.url('/EWS/Exchange.asmx'),
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://schemas.microsoft.com/exchange/services/2006/messages/CreateItem"',
        },
        body: rsvpSoap(itemId, ck, action, message),
        timeoutMs: 20_000,
      });

    const res = await this.withSession(() => call(changeKey), rsvpElementName(action));
    let outcome = parseRsvpResponse(res.text());
    if (!outcome.ok && changeKey && outcome.code && isStaleChangeKeyCode(outcome.code)) {
      outcome = parseRsvpResponse((await this.withSession(() => call(undefined), rsvpElementName(action))).text());
    }
    if (outcome.ok) return;
    // The log says an answer failed, never what it said: the message is the person's own words.
    log.warn(`respond: ${rsvpElementName(action)} not confirmed (${outcome.code ?? 'answer not readable'})`);
    throw new OwaError('server', rsvpFailureText(outcome.code));
  }

  /**
   * The signed-in user's SMTP address, from the session configuration OWA's own page loads at
   * start-up. A server that does not answer this (or answers in another shape) just leaves it
   * unknown: the caller then reads the user's own availability from the synced calendar.
   */
  async ownAddress(): Promise<string | undefined> {
    if (this.ownEmail !== undefined) return this.ownEmail ?? undefined;
    try {
      const res = await this.withSession(() => this.service('GetOwaUserConfiguration', {}, 'header'), 'GetOwaUserConfiguration');
      this.ownEmail = parseOwnAddress(JSON.parse(res.text())) ?? null;
    } catch (e) {
      // A server-side refusal of this optional call only means "unknown"; login, network and certificate problems are reported.
      if (e instanceof OwaError && e.kind !== 'server') throw e;
      this.ownEmail = null;
    }
    log.info(`own address: ${this.ownEmail ? 'known' : 'not available'}`);
    return this.ownEmail ?? undefined;
  }

  /**
   * Free/busy of `emails` (already validated) over [start, end) in 30-minute steps, through EWS
   * GetUserAvailability. The user's own mailbox is asked for in the same call when its address is
   * known. A mailbox the server cannot answer for (no permission, not found) is "no data" for that
   * person; only a failure of the whole call is an error.
   */
  async getAvailability(emails: string[], start: Date, end: Date): Promise<AvailabilityResult> {
    const typed = emails.map(normalizeEmail);
    if (!this.canary) await this.authenticate(); // a GET first, as for the other EWS call
    const own = await this.ownAddress();
    const asked = own ? [own, ...typed.filter((e) => e !== own)] : typed;
    const base = { start: start.toISOString(), end: end.toISOString(), slotMinutes: SLOT_MINUTES };
    if (!asked.length) return { ...base, people: [] };

    const body = userAvailabilitySoap(asked, start, end, availabilityTimeZone(start), SLOT_MINUTES);
    let res: HttpResponse;
    try {
      res = await this.withSession(
        () =>
          this.send({
            method: 'POST',
            url: this.url('/EWS/Exchange.asmx'),
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              SOAPAction: '"http://schemas.microsoft.com/exchange/services/2006/messages/GetUserAvailability"',
            },
            body,
            timeoutMs: 30_000,
          }),
        'GetUserAvailability',
        3000, // a SOAP fault names its ResponseCode after a long namespace preamble
      );
    } catch (e) {
      // A SOAP fault is an HTTP 500 whose body names the reason.
      const code = e instanceof OwaError && e.kind === 'server' ? soapFaultCode(e.detail ?? '') : undefined;
      if (code) throw new OwaError('server', `Exchange: ${code}`, (e as OwaError).status);
      throw e;
    }
    const parsed = parseAvailabilityResponse(res.text(), asked, start.getTime(), end.getTime());
    log.info(`availability: ${asked.length} mailboxes asked, ${parsed.answered} answered, ${parsed.people.filter((p) => p.failed).length} without data`);
    if (!parsed.answered) throw new OwaError('server', parsed.fault ? `Exchange: ${parsed.fault}` : 'Exchange не вернул данных о занятости');

    const byEmail = new Map(parsed.people.map((p) => [p.email, p]));
    const self = own ? byEmail.get(own) : undefined;
    return { ...base, self: self && !self.failed ? self : undefined, people: typed.map((e) => byEmail.get(e)!) };
  }

  dispose() {
    void this.ses.clearStorageData();
  }
}
