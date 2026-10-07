// Owns the account, the sync loop and the current meeting list.
import { EventEmitter } from 'node:events';
import type { AppSettings, AvailabilityRequest, AvailabilityResult, CalendarEvent, CertInfo, ConnectionTestResult, CreateMeetingInput, EditMeetingInput, EventDetails, MeetingBefore, PersonSuggestion, RsvpAction, SaveResult, SettingsUpdate, StatsRequest, SyncState } from '../shared/types';
import { describeError, log } from './log';
import { OwaClient } from './owa/client';
import { OwaError } from './owa/http';
import { checkServerUrl, serverKey, serverUrlError } from '../shared/serverUrl';
import { sanitizeUpdate } from '../shared/validate';
import { diffEvents } from '../shared/changes';
import { isEffectivelyCancelled } from '../shared/events';
import { dedupeEmails, isEmail, normalizeEmail } from '../shared/email';
import type { MeetingField } from './owa/ewsMeeting';
import { demoAvailability, demoDetails, demoEvents, demoPeople, demoStatsEvents } from './demo';
import { RequestGate } from './limits';
import { clearEventCache, loadEventCache, loadPassword, loadSettings, saveEventCache, savePassword, saveSettings } from './store';

const DAYS_BACK = 7;
const DAYS_AHEAD = 30;

function syncRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_BACK);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AHEAD + 1);
  return { start, end };
}

function describe(e: unknown): Pick<SyncState, 'error' | 'errorKind' | 'untrustedCert'> {
  if (e instanceof OwaError) {
    const kind = e.kind === 'loginHost' ? 'auth' : e.kind;
    return { error: e.message, errorKind: kind, untrustedCert: e.kind === 'certificate' ? e.cert : undefined };
  }
  return { error: e instanceof Error ? e.message : String(e), errorKind: 'other' };
}

/** The pinned fingerprint applies to one host only. */
function pinFor(a: AppSettings['account'], host: string): string | undefined {
  return a.trustedCertFingerprint && a.trustedCertHost?.toLowerCase() === host.toLowerCase() ? a.trustedCertFingerprint : undefined;
}

function hostOf(serverUrl: string): string {
  try {
    return new URL(/^https?:\/\//i.test(serverUrl) ? serverUrl : `https://${serverUrl}`).hostname;
  } catch {
    return '';
  }
}

export class CalendarService extends EventEmitter {
  settings: AppSettings;
  events: CalendarEvent[] = [];
  sync: SyncState = { phase: 'idle' };
  readonly demo: boolean;

  private client?: OwaClient;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  /** Wrong password latches automatic sync off, so a domain account is not locked out by retries. */
  private authLatched = false;
  /** The last certificate a server presented that Windows rejected (from sync or from a connection test). */
  private untrusted?: CertInfo;
  /** Demo mode only: meetings "created" in the form live here (no network), and survive the demo's reloads. */
  private demoCreated: CalendarEvent[] = [];
  private demoCreatedDetails = new Map<string, EventDetails>();
  /** Free/busy lookups: one at a time and 30 in ten minutes, whatever the window asks for. */
  private readonly availabilityGate = new RequestGate(1, 30, 10 * 60_000);
  /**
   * The statistics window: one calendar view per period, one at a time. A period costs the server
   * more than a day does, so fewer are allowed than free/busy lookups — switching the period a few
   * times is fine, a page in a loop is not.
   */
  private readonly statsGate = new RequestGate(1, 20, 10 * 60_000);
  /**
   * Everything else a window can make the app ask the server for: opening a meeting card, answering
   * an invitation. Our own pages ask once per click; a page in a loop (or a bug) must not turn into
   * a flood of requests against the signed-in account.
   */
  private readonly requestGate = new RequestGate(3, 120, 10 * 60_000);

  constructor(demo: boolean) {
    super();
    this.demo = demo;
    this.settings = loadSettings();
    if (!demo) this.events = loadEventCache();
    if (!demo && !this.settings.account.serverUrl) this.sync = { phase: 'notConfigured' };
  }

  start() {
    this.rebuildClient();
    void this.syncNow('auto');
    this.reschedule();
  }

  private reschedule() {
    if (this.timer) clearInterval(this.timer);
    const minutes = Math.max(1, this.settings.syncIntervalMinutes);
    this.timer = setInterval(() => void this.syncNow('auto'), minutes * 60_000);
  }

  private rebuildClient() {
    this.client?.dispose();
    this.client = undefined;
    const a = this.settings.account;
    if (this.demo || !a.serverUrl) return;
    try {
      // The saved password is only released for the server it was typed for.
      const password = loadPassword(serverKey(a.serverUrl));
      this.client = new OwaClient({
        serverUrl: a.serverUrl,
        partition: 'owa',
        // No login or no password → the signed-in Windows account; both present → they are used instead.
        useWindowsAuth: !(a.username && password),
        username: a.username || undefined,
        password,
        trustedFingerprint: pinFor(a, hostOf(a.serverUrl)),
      });
    } catch (e) {
      log.warn(`account: ${describeError(e)}`);
      this.setSync({ phase: 'error', ...describe(e) });
    }
  }

  private setSync(s: SyncState) {
    this.sync = s;
    this.emit('changed');
  }

  /**
   * Every sync, including one the person asked for, is skipped while the wrong-password latch is
   * set: a domain account locks out after a handful of failed logins, and "Обновить" (or a page
   * calling syncNow in a loop) must not be able to spend those attempts. The latch is cleared by
   * changing the account settings, resetting the cache or trusting the certificate — that is, by
   * the person doing something about the reason the login failed.
   */
  syncNow(reason: 'auto' | 'manual' | 'popup' = 'manual'): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.authLatched) return Promise.resolve();
    if (reason === 'popup' && this.sync.lastSuccess && Date.now() - Date.parse(this.sync.lastSuccess) < 60_000) {
      return Promise.resolve();
    }
    this.inFlight = this.doSync().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  private async doSync() {
    if (this.demo) {
      this.events = this.demoCreated.length ? [...demoEvents(), ...this.demoCreated].sort((a, b) => a.start.localeCompare(b.start)) : demoEvents();
      this.setSync({ phase: 'ok', lastSuccess: new Date().toISOString() });
      return;
    }
    if (!this.settings.account.serverUrl) {
      this.setSync({ phase: 'notConfigured' });
      return;
    }
    if (!this.client) this.rebuildClient();
    if (!this.client) return;

    this.setSync({ ...this.sync, phase: 'syncing' });
    try {
      const { start, end } = syncRange();
      const events = await this.client.fetchCalendarView(start, end);
      const before = this.events;
      this.events = events.sort((a, b) => a.start.localeCompare(b.start));
      // What moved, was cancelled or newly arrived since the list the widget showed a moment ago.
      const changes = diffEvents(before, this.events, new Date());
      if (changes.length) this.emit('changes', changes);
      this.authLatched = false;
      saveEventCache(this.events);
      log.info(`sync: ok, ${events.length} events`);
      this.setSync({ phase: 'ok', lastSuccess: new Date().toISOString() });
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
      if (e instanceof OwaError && e.cert) this.untrusted = e.cert;
      log.warn(`sync: failed: ${describeError(e)}`);
      this.setSync({ phase: 'error', lastSuccess: this.sync.lastSuccess, ...describe(e) });
    }
  }

  private find(id: string): CalendarEvent {
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new Error('Встреча не найдена — обновите календарь');
    return e;
  }

  async details(id: string): Promise<EventDetails> {
    const e = this.find(id);
    if (this.demo) return this.demoCreatedDetails.get(e.id) ?? demoDetails(e);
    if (!this.client) throw new Error('Аккаунт не настроен');
    const release = this.requestGate.enter();
    try {
      return await this.client.fetchDetails(e.id, e.changeKey);
    } finally {
      release();
    }
  }

  async respond(id: string, action: RsvpAction): Promise<void> {
    const e = this.find(id);
    if (!this.demo) {
      if (!this.client) throw new Error('Аккаунт не настроен');
      const release = this.requestGate.enter();
      try {
        await this.client.respond(e.id, e.changeKey, action);
      } finally {
        release();
      }
    }
    // Optimistic update; the next sync brings the server's truth (and a new ChangeKey).
    e.responseType = action === 'accept' ? 'accepted' : action === 'tentative' ? 'tentative' : 'declined';
    this.emit('changed');
    if (!this.demo) setTimeout(() => void this.syncNow('manual'), 1500);
  }

  // ---------- Create a meeting ----------

  /**
   * Creates a meeting that the caller has already validated and the person has already confirmed
   * (see `MeetingGate`). Demo mode only adds it to the in-memory list: nothing leaves the machine.
   */
  async createMeeting(m: CreateMeetingInput): Promise<void> {
    if (this.demo) {
      this.addDemoMeeting(m);
      return;
    }
    if (!this.client) throw new Error('Аккаунт не настроен: укажите сервер в настройках');
    // After a wrong password the login is not tried again by itself (it could lock the domain account).
    if (this.authLatched) throw new Error('Вход в Exchange не удался. Проверьте логин и пароль в настройках');
    try {
      await this.client.createMeeting(m);
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
      // The answer was lost: the meeting may exist, so the calendar is refreshed to show what is really there.
      if (e instanceof OwaError && e.kind === 'network') void this.refreshAfterChange();
      throw e;
    }
    void this.refreshAfterChange();
  }

  /** The short tour has been seen: remembered on its own, without going through the settings form. */
  markWelcomeDone() {
    if (this.settings.welcomeDone) return;
    this.settings = { ...this.settings, welcomeDone: true };
    saveSettings(this.settings);
    this.emit('changed');
  }

  /**
   * What the meeting is right now, as the main process knows it: the synced list for the fields it
   * holds, the server for the description and the attendee lists. This is the "before" of a change —
   * it is never taken from the window, so a window cannot claim a change that was not made.
   */
  async meetingBefore(id: string): Promise<MeetingBefore> {
    const e = this.find(id);
    if (!e.isOrganizer) throw new Error('Менять и отменять можно только встречи, которые вы организуете');
    if (isEffectivelyCancelled(e)) throw new Error('Эта встреча уже отменена');
    const details = this.demo ? (this.demoCreatedDetails.get(e.id) ?? demoDetails(e)) : await this.details(e.id);
    const of = (kind: 'required' | 'optional') => details.attendees.filter((a) => a.kind === kind && isEmail(a.email ?? '')).map((a) => normalizeEmail(a.email!));
    return {
      id: e.id,
      changeKey: e.changeKey,
      title: e.title,
      start: e.start,
      end: e.end,
      location: e.location ?? '',
      body: details.bodyText ?? '',
      requiredAttendees: dedupeEmails(of('required')),
      optionalAttendees: dedupeEmails(of('optional')),
    };
  }

  /** Sends a change the caller has already validated and the person has already confirmed. */
  async updateMeeting(before: MeetingBefore, after: EditMeetingInput, fields: readonly MeetingField[]): Promise<void> {
    if (this.demo) {
      this.updateDemoMeeting(before, after);
      return;
    }
    if (!this.client) throw new Error('Аккаунт не настроен: укажите сервер в настройках');
    if (this.authLatched) throw new Error('Вход в Exchange не удался. Проверьте логин и пароль в настройках');
    try {
      await this.client.updateMeeting(before, after, fields);
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
      if (e instanceof OwaError && e.kind === 'network') void this.refreshAfterChange();
      throw e;
    }
    void this.refreshAfterChange();
  }

  /** Calls a meeting off; everyone invited is told by the server. Already validated and confirmed. */
  async cancelMeeting(before: MeetingBefore): Promise<void> {
    if (this.demo) {
      this.events = this.events.filter((e) => e.id !== before.id);
      this.demoCreated = this.demoCreated.filter((e) => e.id !== before.id);
      this.emit('changed');
      return;
    }
    if (!this.client) throw new Error('Аккаунт не настроен: укажите сервер в настройках');
    if (this.authLatched) throw new Error('Вход в Exchange не удался. Проверьте логин и пароль в настройках');
    try {
      await this.client.cancelMeeting(before.id, before.changeKey);
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
      if (e instanceof OwaError && e.kind === 'network') void this.refreshAfterChange();
      throw e;
    }
    void this.refreshAfterChange();
  }

  private updateDemoMeeting(before: MeetingBefore, after: EditMeetingInput) {
    const apply = (e: CalendarEvent): CalendarEvent =>
      e.id === before.id ? { ...e, title: after.title, start: after.start, end: after.end, location: after.location || undefined, bodyPreview: after.body ? after.body.replace(/\s+/g, ' ').slice(0, 600) : undefined } : e;
    this.events = this.events.map(apply).sort((a, b) => a.start.localeCompare(b.start));
    this.demoCreated = this.demoCreated.map(apply);
    this.demoCreatedDetails.set(before.id, {
      attendees: [
        ...after.requiredAttendees.map((a) => ({ name: a, email: a, kind: 'required' as const, response: 'notResponded' as const })),
        ...after.optionalAttendees.map((a) => ({ name: a, email: a, kind: 'optional' as const, response: 'notResponded' as const })),
      ],
      bodyText: after.body || undefined,
    });
    this.emit('changed');
  }

  /** A sync that is already running started before the change; wait for it, then load again. */
  private async refreshAfterChange() {
    await this.inFlight?.catch(() => undefined);
    await this.syncNow('manual');
  }

  private addDemoMeeting(m: CreateMeetingInput) {
    const id = `demo-new-${this.demoCreated.length + 1}`;
    const event: CalendarEvent = {
      id,
      changeKey: `ck-${id}`,
      title: m.title,
      start: m.start,
      end: m.end,
      isAllDay: false,
      location: m.location || undefined,
      bodyPreview: m.body ? m.body.replace(/\s+/g, ' ').slice(0, 600) : undefined,
      platform: 'generic',
      isCancelled: false,
      isOrganizer: true,
      responseType: 'organizer',
      categories: [],
      isRecurring: false,
    };
    if (this.demoCreated.length >= 50) this.demoCreated.shift();
    this.demoCreated.push(event);
    this.demoCreatedDetails.set(id, {
      attendees: [
        ...m.requiredAttendees.map((a) => ({ name: a, email: a, kind: 'required' as const, response: 'notResponded' as const })),
        ...m.optionalAttendees.map((a) => ({ name: a, email: a, kind: 'optional' as const, response: 'notResponded' as const })),
      ],
      bodyText: m.body || undefined,
    });
    this.events = [...this.events, event].sort((a, b) => a.start.localeCompare(b.start));
    this.emit('changed');
  }

  /**
   * Directory suggestions for the recipients field. A failure only means "no suggestions": typing an
   * address by hand still works. Nothing here logs the query (it is what the person is typing).
   */
  async resolvePeople(query: string): Promise<PersonSuggestion[]> {
    if (this.demo) return demoPeople(query);
    if (!this.client || this.authLatched) return [];
    try {
      return await this.client.resolveNames(query);
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
      log.warn(`resolve: failed: ${describeError(e)}`);
      return [];
    }
  }

  /**
   * Free/busy for the people in `req` (already validated) and, when the server tells, the user's
   * own mailbox. Demo mode answers with fictional data and makes no request.
   */
  async availability(req: AvailabilityRequest): Promise<AvailabilityResult> {
    const release = this.availabilityGate.enter();
    try {
      if (this.demo) return demoAvailability(req);
      if (!this.client) throw new Error('Аккаунт не настроен');
      return await this.client.getAvailability(req.emails, new Date(req.start), new Date(req.end));
    } catch (e) {
      // Counts and kinds only: the addresses the person typed never go to the log.
      log.warn(`availability: failed: ${describeError(e)}`);
      throw e;
    } finally {
      release();
    }
  }

  // ---------- Meeting statistics ----------

  /**
   * The meetings of one period (already validated: at most 60 days) for the statistics window.
   * The widget keeps only a short range in memory, so the period is asked for with one
   * `GetCalendarView` — the same request the sync uses, with no other field and nothing else sent.
   * The answer is not cached and does not replace the synced list: it belongs to that window only.
   */
  async statsEvents(req: StatsRequest): Promise<CalendarEvent[]> {
    const release = this.statsGate.enter();
    try {
      if (this.demo) return demoStatsEvents(req);
      if (!this.client) throw new Error('Аккаунт не настроен');
      // After a wrong password the login is not tried again by itself (it could lock the domain account).
      if (this.authLatched) throw new Error('Вход в Exchange не удался. Проверьте логин и пароль в настройках');
      return await this.client.fetchCalendarView(new Date(req.start), new Date(req.end));
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
      // Counts and kinds only: what the period holds never goes to the log.
      log.warn(`stats: failed: ${describeError(e)}`);
      throw e;
    } finally {
      release();
    }
  }

  /**
   * "Reset cache": forgets the saved meeting list and the session with the server, then loads
   * everything again. The password, the certificate pin and the settings are left alone. The list
   * restarts empty, so what is loaded next is not announced as a flood of "new invitations".
   */
  async clearCache() {
    // A sync that is running finishes first: its answer must not put the old list back.
    await this.inFlight?.catch(() => undefined);
    log.info('cache: cleared on request');
    this.events = [];
    clearEventCache();
    this.authLatched = false;
    this.emit('cacheCleared');
    this.rebuildClient(); // a new client starts with an empty session: cookies and storage are dropped
    this.emit('changed');
    void this.syncNow('manual');
  }

  /**
   * The server a settings update would switch to, or null when it stays the same. Switching is
   * what points the password and the Windows identity at a new place, so the caller asks the
   * person to confirm it in a native dialog first.
   */
  serverChangeOf(update: unknown): string | null {
    if (this.demo) return null;
    const next = serverKey(sanitizeUpdate(update, this.settings).settings.account.serverUrl);
    return next && next !== serverKey(this.settings.account.serverUrl) ? next : null;
  }

  async applySettings(update: SettingsUpdate): Promise<SaveResult> {
    const prev = this.settings;
    // Whatever the renderer sent is rebuilt field by field: types, enums and ranges are enforced here.
    // The certificate pin and hasPassword are copied from the current state, never from the page.
    const clean = sanitizeUpdate(update, prev);
    if (clean.settings.account.serverUrl) {
      const check = checkServerUrl(clean.settings.account.serverUrl);
      if (!check.ok) throw new Error(serverUrlError(check));
      clean.settings.account.serverUrl = check.url.replace(/^https:\/\//, '');
    }
    const account = clean.settings.account;
    const key = serverKey(account.serverUrl);
    let hasPassword = prev.account.hasPassword;
    let passwordRemoved = false;
    if (clean.password !== undefined) {
      hasPassword = savePassword(clean.password || undefined, key) && !!clean.password;
    } else if (hasPassword && key !== serverKey(prev.account.serverUrl)) {
      // The saved password was typed for the previous server; it is never sent to a different one.
      savePassword(undefined, key);
      hasPassword = false;
      passwordRemoved = true;
      log.info('password removed: it belonged to another server');
    }
    this.settings = { ...clean.settings, account: { ...account, hasPassword, useWindowsAuth: !(account.username && hasPassword) } };
    saveSettings(this.settings);

    const accountChanged =
      clean.password !== undefined || JSON.stringify({ ...prev.account, hasPassword: 0 }) !== JSON.stringify({ ...this.settings.account, hasPassword: 0 });
    if (accountChanged) {
      this.authLatched = false;
      if (prev.account.serverUrl !== this.settings.account.serverUrl) {
        this.events = [];
        saveEventCache([]);
      }
      this.rebuildClient();
      void this.syncNow('manual');
    }
    if (prev.syncIntervalMinutes !== this.settings.syncIntervalMinutes) this.reschedule();
    this.emit('changed');
    this.emit('settings', prev, this.settings);
    return { passwordRemoved };
  }

  async testConnection(update: SettingsUpdate): Promise<ConnectionTestResult> {
    if (this.demo) return { ok: true, message: 'Демо-режим: подключение не требуется', eventCount: this.events.length };
    const clean = sanitizeUpdate(update, this.settings);
    const a = clean.settings.account;
    let client: OwaClient | undefined;
    try {
      const password = clean.password !== undefined ? clean.password || undefined : loadPassword(serverKey(a.serverUrl));
      client = new OwaClient({
        serverUrl: a.serverUrl,
        partition: 'owa-test',
        useWindowsAuth: !(a.username && password),
        username: a.username || undefined,
        password,
        trustedFingerprint: pinFor(this.settings.account, hostOf(a.serverUrl)),
      });
      log.info(`test: connecting to ${client.host}`);
      const now = new Date();
      const events = await client.fetchCalendarView(new Date(now.getFullYear(), now.getMonth(), now.getDate()), new Date(now.getTime() + 7 * 86_400_000));
      log.info(`test: ok, ${events.length} events`);
      return { ok: true, message: `Подключено. Встреч на неделю: ${events.length}`, eventCount: events.length };
    } catch (e) {
      if (e instanceof OwaError && e.cert) this.untrusted = e.cert;
      log.warn(`test: failed: ${describeError(e)}`);
      const d = describe(e);
      return { ok: false, message: d.error ?? 'Ошибка', untrustedCert: d.untrustedCert };
    } finally {
      client?.dispose();
    }
  }

  /** The certificate a trust prompt may show: the one a server presented and Windows rejected. */
  pendingCertificate(): CertInfo | undefined {
    return this.untrusted;
  }

  /**
   * Pins the certificate a server presented, for that host only. The fingerprint must be the one
   * the network layer just rejected: a value made up by the renderer is refused.
   */
  async trustCertificate(fingerprint: string) {
    const pending = this.untrusted;
    if (!pending || pending.fingerprint !== fingerprint) throw new Error('Сертификат изменился — обновите календарь и повторите');
    log.info(`certificate pinned for ${pending.host}: ${pending.fingerprint}`);
    this.untrusted = undefined;
    this.settings = { ...this.settings, account: { ...this.settings.account, trustedCertFingerprint: pending.fingerprint, trustedCertHost: pending.host } };
    saveSettings(this.settings);
    this.authLatched = false;
    this.rebuildClient();
    this.emit('changed');
    void this.syncNow('manual');
  }

  forgetCertificate() {
    if (!this.settings.account.trustedCertFingerprint) return;
    log.info(`certificate pin removed for ${this.settings.account.trustedCertHost}`);
    this.settings = { ...this.settings, account: { ...this.settings.account, trustedCertFingerprint: undefined, trustedCertHost: undefined } };
    saveSettings(this.settings);
    this.rebuildClient();
    this.emit('changed');
  }
}
