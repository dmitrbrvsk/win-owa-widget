// Owns the account, the sync loop and the current meeting list.
import { EventEmitter } from 'node:events';
import type { AppSettings, CalendarEvent, ConnectionTestResult, EventDetails, RsvpAction, SettingsUpdate, SyncState } from '../shared/types';
import { OwaClient } from './owa/client';
import { OwaError } from './owa/http';
import { demoDetails, demoEvents } from './demo';
import { loadEventCache, loadPassword, loadSettings, saveEventCache, savePassword, saveSettings } from './store';

const DAYS_BACK = 7;
const DAYS_AHEAD = 30;

function syncRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_BACK);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AHEAD + 1);
  return { start, end };
}

function describe(e: unknown): Pick<SyncState, 'error' | 'errorKind' | 'untrustedFingerprint'> {
  if (e instanceof OwaError) {
    const kind = e.kind === 'loginHost' ? 'auth' : e.kind;
    return { error: e.message, errorKind: kind, untrustedFingerprint: e.kind === 'certificate' ? e.detail : undefined };
  }
  return { error: e instanceof Error ? e.message : String(e), errorKind: 'other' };
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
      this.client = new OwaClient({
        serverUrl: a.serverUrl,
        useWindowsAuth: a.useWindowsAuth,
        username: a.username || undefined,
        password: loadPassword(),
        trustedFingerprint: a.trustedCertFingerprint,
      });
    } catch (e) {
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
      this.setSync({ phase: 'ok', lastSuccess: new Date().toISOString() });
    } catch (e) {
      if (e instanceof OwaError && e.kind === 'auth') this.authLatched = true;
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
    if (update.password !== undefined) savePassword(update.password || undefined);
    const hasPassword = update.password !== undefined ? !!update.password : prev.account.hasPassword;
    this.settings = { ...update.settings, account: { ...update.settings.account, hasPassword } };
    saveSettings(this.settings);

    const accountChanged =
      update.password !== undefined || JSON.stringify({ ...prev.account, hasPassword: 0 }) !== JSON.stringify({ ...this.settings.account, hasPassword: 0 });
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
    const a = update.settings.account;
    try {
      const client = new OwaClient({
        serverUrl: a.serverUrl,
        useWindowsAuth: a.useWindowsAuth,
        username: a.username || undefined,
        password: update.password !== undefined ? update.password || undefined : loadPassword(),
        trustedFingerprint: a.trustedCertFingerprint,
      });
      const now = new Date();
      const events = await client.fetchCalendarView(new Date(now.getFullYear(), now.getMonth(), now.getDate()), new Date(now.getTime() + 7 * 86_400_000));
      client.dispose();
      return { ok: true, message: `Подключено. Встреч на неделю: ${events.length}`, eventCount: events.length };
    } catch (e) {
      const d = describe(e);
      return { ok: false, message: d.untrustedFingerprint ? `${d.error}. Отпечаток: ${d.untrustedFingerprint}` : d.error ?? 'Ошибка' };
    }
  }

  async trustCertificate(fingerprint: string) {
    await this.applySettings({ settings: { ...this.settings, account: { ...this.settings.account, trustedCertFingerprint: fingerprint } } });
  }
}
