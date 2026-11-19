import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { accountOwner } from '../shared/accountOwner';
import {
    ACCOUNT_COLORS,
    accountColor,
    accountDraft,
    accountLabel,
    type AccountSummary,
} from '../shared/accounts';
import { type EventChange } from '../shared/changes';
import { type AppSettings, type AvailabilityRequest, type SyncState } from '../shared/types';

import {
    type AccountProfiles,
    emptyAccountSettings,
    loadAccountProfiles,
    loadSharedSettings,
    MIGRATED_ACCOUNT_ID,
    profileSummary,
    type SavedAccount,
    writeAccountPassword,
    writeAccountProfiles,
} from './accountProfiles';
import { removeProfileFiles } from './accountRemoval';
import { combinedAvailability } from './calendarAvailability';
import { CalendarEventIndex } from './calendarEventIndex';
import { calendarProfileStorage } from './calendarProfileStorage';
import { CalendarService } from './calendarService';
import { log } from './log';
import { saveSettings } from './store';

// eslint-disable-next-line unicorn/prefer-event-target -- CalendarService and the application already use named EventEmitter events.
export class CalendarAccounts extends EventEmitter {
    private readonly runtimes = new Map<string, CalendarService>();
    private readonly eventIndex = new CalendarEventIndex();
    private profiles: AccountProfiles;
    private global: AppSettings;
    private running = false;
    readonly empty: CalendarService;
    revision = 0;

    constructor() {
        super();
        this.profiles = loadAccountProfiles();
        this.global = loadSharedSettings();
        this.empty = this.createService();
        this.empty.on('changed', () => this.changed());
        this.empty.on('settings', (before, after) => this.emit('settings', before, after));
        this.finishRemovals();
        for (const profile of this.profiles.accounts) this.attach(profile);
        this.eventIndex.update(this.runtimes, this.profiles.accounts);
    }

    get primaryId() {
        return this.profiles.primary;
    }
    get primary() {
        return this.primaryId ? this.calendar(this.primaryId) : this.empty;
    }

    get events() {
        return this.eventIndex.events;
    }

    get sync(): SyncState {
        const states = [...this.runtimes.values()].map((service) => service.sync);
        if (!states.length) return { phase: 'notConfigured' };
        const error = states.find((state) => state.phase === 'error');
        if (error) return error;
        if (states.some((state) => state.phase === 'syncing')) return { phase: 'syncing' };
        return this.primary.sync;
    }

    summaries(anonymous = false): AccountSummary[] {
        return this.profiles.accounts.map((profile, index) =>
            profileSummary(
                profile,
                this.calendar(profile.id).sync,
                anonymous ? String(index + 1) : undefined,
            ),
        );
    }

    profile(id: unknown): SavedAccount {
        const profile = this.profiles.accounts.find((entry) => entry.id === id);
        if (!profile) throw new Error('Аккаунт не найден');
        return profile;
    }

    calendar(id: string): CalendarService {
        const runtime = this.runtimes.get(id);
        if (!runtime) throw new Error('Аккаунт не найден');
        return runtime;
    }

    has(id: string) {
        return this.runtimes.has(id);
    }

    target(id: string) {
        return this.eventIndex.target(id);
    }

    noteIds() {
        return this.eventIndex.noteIds();
    }

    start() {
        this.running = true;
        for (const service of this.runtimes.values()) service.start();
    }

    async syncNow(reason: 'auto' | 'manual' | 'popup') {
        await Promise.allSettled(
            [...this.runtimes.values()].map((service) => service.syncNow(reason)),
        );
    }

    add(raw: unknown) {
        this.finishRemovals();
        const draft = accountDraft(raw);
        const owner = accountOwner(draft.settings);
        if (
            [...this.profiles.accounts, ...this.profiles.deleting].some(
                (entry) => accountOwner(entry.settings) === owner,
            )
        )
            throw new Error('Этот аккаунт уже добавлен или ещё удаляется');
        const id = randomUUID();
        const used = new Set(this.profiles.accounts.map((profile) => profile.color));
        const profile: SavedAccount = {
            id,
            label: draft.label,
            color:
                draft.color ??
                ACCOUNT_COLORS.find((color) => !used.has(color)) ??
                ACCOUNT_COLORS[this.profiles.accounts.length % ACCOUNT_COLORS.length],
            visible: true,
            settings: draft.settings,
        };
        // Write the profile before accepting a secret. A crash here leaves a manual profile that can
        // be completed in Settings, and an unconfigured manual profile never falls back to Windows.
        saveSettings(this.global);
        this.commit({
            ...this.profiles,
            primary: this.primaryId ?? id,
            accounts: [...this.profiles.accounts, profile],
        });
        try {
            if (draft.password) {
                profile.settings.hasPassword = writeAccountPassword(
                    id,
                    profile.settings,
                    draft.password,
                );
            }
        } finally {
            const service = this.attach(profile);
            this.revision += 1;
            if (this.running) service.start();
            this.changed();
        }
        return id;
    }

    rename(id: unknown, label: unknown, color: unknown) {
        const profile = this.profile(id);
        this.replaceProfile({ ...profile, label: accountLabel(label), color: accountColor(color) });
        this.changed();
    }

    setPrimary(id: unknown) {
        const profile = this.profile(id);
        this.commit({ ...this.profiles, primary: profile.id });
        this.changed();
    }

    setVisible(id: unknown, visible: unknown) {
        if (typeof visible !== 'boolean') throw new Error('Недопустимый фильтр');
        this.replaceProfile({ ...this.profile(id), visible });
        this.changed();
    }

    showAll() {
        this.commit({
            ...this.profiles,
            accounts: this.profiles.accounts.map((profile) => ({ ...profile, visible: true })),
        });
        this.changed();
    }

    remove(id: unknown) {
        const profile = this.profile(id);
        const accounts = this.profiles.accounts.filter((entry) => entry !== profile);
        this.commit({
            ...this.profiles,
            accounts,
            primary: this.primaryId === profile.id ? accounts[0]?.id : this.primaryId,
            deleting: [...this.profiles.deleting, profile],
        });
        const service = this.calendar(profile.id);
        service.stop();
        service.removeAllListeners();
        this.runtimes.delete(profile.id);
        this.revision += 1;
        this.eventIndex.update(this.runtimes, this.profiles.accounts);
        this.emit('removed', profile.id, accountOwner(profile.settings));
        this.emit('changed');
        if (!this.finishRemovals())
            throw new Error('Аккаунт отключён. Очистка данных будет повторена при перезапуске');
    }

    private finishRemovals() {
        let done = true;
        for (const profile of this.profiles.deleting) {
            try {
                removeProfileFiles(profile, this.global);
                this.commit({
                    ...this.profiles,
                    legacyPending:
                        profile.id === MIGRATED_ACCOUNT_ID ? false : this.profiles.legacyPending,
                    deleting: this.profiles.deleting.filter((entry) => entry !== profile),
                });
            } catch {
                done = false;
                log.warn('accounts: pending account data cleanup');
            }
        }
        return done;
    }

    private commit(profiles: AccountProfiles) {
        writeAccountProfiles(profiles);
        this.profiles = profiles;
    }

    private replaceProfile(profile: SavedAccount) {
        this.commit({
            ...this.profiles,
            accounts: this.profiles.accounts.map((entry) =>
                entry.id === profile.id ? profile : entry,
            ),
        });
    }

    private createService(profile?: SavedAccount) {
        const id = profile?.id;
        const settings = { ...this.global, account: profile?.settings ?? emptyAccountSettings() };
        return new CalendarService(
            false,
            calendarProfileStorage(
                settings,
                id,
                () => this.profiles.legacyPending === true,
                (next) => {
                    if (id) {
                        const saved = this.profile(id);
                        if (JSON.stringify(saved.settings) !== JSON.stringify(next.account))
                            this.replaceProfile({ ...saved, settings: next.account });
                    }
                    const shared = { ...next, account: emptyAccountSettings() };
                    if (JSON.stringify(this.global) === JSON.stringify(shared)) return;
                    saveSettings(shared);
                    this.global = shared;
                    for (const calendar of this.runtimes.values())
                        calendar.setSharedSettings(shared);
                    if (id) this.empty.setSharedSettings(shared);
                },
            ),
        );
    }

    private attach(profile: SavedAccount) {
        const service = this.createService(profile);
        this.runtimes.set(profile.id, service);
        service.on('changed', () => this.changed());
        service.on('settings', (before, after) => this.emit('settings', before, after));
        service.on('accountChanged', () => {
            this.revision += 1;
            this.emit('accountChanged', profile.id);
        });
        service.on('cacheCleared', () => this.emit('cacheCleared'));
        service.on('changes', (changes: EventChange[]) => {
            this.eventIndex.update(this.runtimes, this.profiles.accounts);
            this.emit('changes', this.eventIndex.projectChanges(profile.id, changes));
        });
        return service;
    }

    private changed() {
        this.eventIndex.update(this.runtimes, this.profiles.accounts);
        this.emit('changed');
    }

    availability(selected: CalendarService, request: AvailabilityRequest) {
        return combinedAvailability(selected, [...this.runtimes.values()], request);
    }
}
