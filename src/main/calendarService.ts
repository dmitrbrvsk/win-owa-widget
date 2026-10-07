// Owns the account, the sync loop and the current meeting list.
import { EventEmitter } from 'node:events';
import type { AppSettings, CalendarEvent, CertInfo, ConnectionTestResult, EventDetails, RsvpAction, SettingsUpdate, SyncState } from '../shared/types';
import { describeError, log } from './log';
import { OwaClient } from './owa/client';
import { OwaError } from './owa/http';
import { checkServerUrl, serverUrlError } from '../shared/serverUrl';
import { sanitizeUpdate } from '../shared/validate';
import { demoDetails, demoEvents } from './demo';
import { loadEventCache, loadPassword, loadSettings, saveEventCache, savePassword, saveSettings } from './store';

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
      const password = loadPassword();
      this.client = new OwaClient({
        serverUrl: a.serverUrl,
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

  /** `auto` syncs are skipped while the wrong-password latch is set; manual ones always run. */
  syncNow(reason: 'auto' | 'manual' | 'popup' = 'manual'): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (reason !== 'manual' && this.authLatched) return Promise.resolve();
    if (reason === 'popup' && this.sync.lastSuccess && Date.now() - Date.parse(this.sync.lastSuccess) < 60_000) {
      return Promise.resolve();
    }
    this.inFlight = this.doSync().finally(() => (this.inFlight = undefined));
    return this.inFlight;
  }

  private async doSync() {
    if (this.demo) {
      this.events = demoEvents();
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
      this.events = events.sort((a, b) => a.start.localeCompare(b.start));
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
    if (this.demo) return demoDetails(e);
    if (!this.client) throw new Error('Аккаунт не настроен');
    return this.client.fetchDetails(e.id, e.changeKey);
  }

  async respond(id: string, action: RsvpAction): Promise<void> {
    const e = this.find(id);
    if (!this.demo) {
      if (!this.client) throw new Error('Аккаунт не настроен');
      await this.client.respond(e.id, e.changeKey, action);
    }
    // Optimistic update; the next sync brings the server's truth (and a new ChangeKey).
    e.responseType = action === 'accept' ? 'accepted' : action === 'tentative' ? 'tentative' : 'declined';
    this.emit('changed');
    if (!this.demo) setTimeout(() => void this.syncNow('manual'), 1500);
  }

  async applySettings(update: SettingsUpdate) {
    const prev = this.settings;
    // Whatever the renderer sent is rebuilt field by field: types, enums and ranges are enforced here.
    // The certificate pin and hasPassword are copied from the current state, never from the page.
    const clean = sanitizeUpdate(update, prev);
    if (clean.settings.account.serverUrl) {
      const check = checkServerUrl(clean.settings.account.serverUrl);
      if (!check.ok) throw new Error(serverUrlError(check));
      clean.settings.account.serverUrl = check.url.replace(/^https:\/\//, '');
    }
    let hasPassword = prev.account.hasPassword;
    if (clean.password !== undefined) hasPassword = savePassword(clean.password || undefined) && !!clean.password;
    const account = clean.settings.account;
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
  }

  async testConnection(update: SettingsUpdate): Promise<ConnectionTestResult> {
    if (this.demo) return { ok: true, message: 'Демо-режим: подключение не требуется', eventCount: this.events.length };
    const clean = sanitizeUpdate(update, this.settings);
    const a = clean.settings.account;
    let client: OwaClient | undefined;
    try {
      const password = clean.password !== undefined ? clean.password || undefined : loadPassword();
      client = new OwaClient({
        serverUrl: a.serverUrl,
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
