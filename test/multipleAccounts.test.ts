import * as fs from 'node:fs';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
    accountFolder,
    emptyAccountSettings,
    loadAccountProfiles,
    readAccountPassword,
} from '../src/main/accountProfiles';
import { CalendarAccounts } from '../src/main/calendarAccounts';
import { mergeOwnBusy } from '../src/main/calendarAvailability';
import { demoEvents } from '../src/main/demo';
import { loadParticipantGroups } from '../src/main/groupStorage';
import { hasAccountNotes } from '../src/main/noteStorage';
import { OwaError } from '../src/main/owa/errors';
import { loadRecent } from '../src/main/recentStorage';
import { saveEventCache, savePassword, saveSettings } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { accountOwner } from '../src/shared/accountOwner';
import { type CalendarEvent, type CertInfo } from '../src/shared/types';

const harness = vi.hoisted(() => ({
    path: '',
    encryptionAvailable: true,
    clients: new Map<string, { partition: string; password?: string }>(),
    load: vi.fn<(username: string) => Promise<CalendarEvent[]>>(),
    rows: [] as CalendarAccounts[],
}));

vi.mock('electron', () => ({
    app: { getPath: () => harness.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => harness.encryptionAvailable,
        encryptString: (text: string) => Buffer.from(`ENC:${text}`),
        decryptString: (data: Buffer) => {
            const text = data.toString();
            if (!text.startsWith('ENC:')) throw new Error('Invalid fixture');
            return text.slice(4);
        },
    },
}));
vi.mock('node:fs', async (original) => {
    const real = await original<typeof fs>();
    return { ...real, renameSync: vi.fn(real.renameSync), rmdirSync: vi.fn(real.rmdirSync) };
});
vi.mock('../src/main/owa/http', async () => ({
    OwaError: (await import('../src/main/owa/errors')).OwaError,
}));
vi.mock('../src/main/owa/client', () => ({
    OwaClient: class {
        constructor(
            private readonly options: { username: string; partition: string; password?: string },
        ) {
            harness.clients.set(options.username, options);
        }
        fetchCalendarView() {
            return harness.load(this.options.username);
        }
        dispose = vi.fn();
    },
}));
vi.mock('../src/main/log', () => ({
    log: { info: vi.fn(), warn: vi.fn() },
    describeError: () => 'redacted',
}));

const real = await vi.importActual<typeof fs>('node:fs');
const baseEvent = () => ({ ...demoEvents()[0], id: 'same-exchange-id' });
const draft = (username: string) => ({
    label: username,
    username,
    serverUrl: 'mail.example.test',
    password: `test-secret-${username}`,
});

function openRegistry() {
    const registry = new CalendarAccounts();
    harness.rows.push(registry);
    return registry;
}

beforeEach(() => {
    harness.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-multiple-accounts-'));
    harness.encryptionAvailable = true;
    harness.clients.clear();
    harness.load.mockImplementation(async () => [baseEvent()]);
    vi.mocked(fs.renameSync).mockImplementation(real.renameSync);
    vi.mocked(fs.rmdirSync).mockImplementation(real.rmdirSync);
});
afterEach(() => {
    for (const registry of harness.rows.splice(0)) {
        for (const { id } of registry.summaries()) registry.calendar(id).stop();
    }
    rmSync(harness.path, { recursive: true, force: true });
    vi.clearAllMocks();
});

it('can retry migration after the registry write failed and retains the matching encrypted data', () => {
    const account = { ...draft('old'), useWindowsAuth: false, hasPassword: true };
    saveSettings({ ...DEFAULT_SETTINGS, account });
    savePassword('legacy-secret', 'mail.example.test');
    const event = baseEvent();
    saveEventCache([event], accountOwner(account));
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        if (String(to).endsWith('accounts.json')) throw new Error('Disk full');
        real.renameSync(from, to);
    });
    expect(() => loadAccountProfiles()).toThrow('Disk full');
    expect(existsSync(nodePath.join(harness.path, 'secret.bin'))).toBe(true);
    expect(existsSync(nodePath.join(harness.path, 'cache.bin'))).toBe(true);
    vi.mocked(fs.renameSync).mockImplementation(real.renameSync);
    const registry = openRegistry();
    const primary = registry.primaryId!;
    expect(registry.summaries()).toHaveLength(1);
    expect(readAccountPassword(registry.profile(primary))).toBe('legacy-secret');
    expect(registry.events[0]).toMatchObject({ accountId: primary, title: event.title });
    expect(openRegistry().primaryId).toBe(primary);
    expect(existsSync(nodePath.join(harness.path, 'secret.bin'))).toBe(false);
});

it('keeps the encrypted originals and manual login mode while Windows encryption is unavailable', () => {
    const account = { ...draft('old'), useWindowsAuth: false, hasPassword: true };
    saveSettings({ ...DEFAULT_SETTINGS, account });
    savePassword('legacy-secret', 'mail.example.test');
    saveEventCache([baseEvent()], accountOwner(account));
    harness.encryptionAvailable = false;
    const pending = loadAccountProfiles();
    expect(pending.legacyPending).toBe(true);
    expect(pending.accounts[0].settings).toMatchObject({
        useWindowsAuth: false,
        hasPassword: false,
    });
    expect(existsSync(nodePath.join(harness.path, 'secret.bin'))).toBe(true);
    expect(existsSync(nodePath.join(harness.path, 'cache.bin'))).toBe(true);
    harness.encryptionAvailable = true;
    const registry = openRegistry();
    expect(registry.primaryId).toBe(pending.primary);
    expect(registry.primary.settings.account.hasPassword).toBe(true);
    expect(registry.events).toHaveLength(1);
    expect(existsSync(nodePath.join(harness.path, 'secret.bin'))).toBe(false);
    expect(existsSync(nodePath.join(harness.path, 'cache.bin'))).toBe(false);
});

it('isolates credentials, partitions, meeting actions, cache, filters and failed login for two accounts on one host', async () => {
    const registry = openRegistry();
    const a = registry.add(draft('A'));
    const b = registry.add(draft('B'));
    harness.load.mockImplementation(async (username) => [{ ...baseEvent(), title: username }]);
    registry.start();
    await registry.syncNow('manual');
    const events = new Map(registry.events.map((event) => [event.accountId, event]));
    const aid = events.get(a)!.id;
    const bid = events.get(b)!.id;
    expect(aid).not.toBe(bid);
    expect(registry.target(aid)).toEqual({ calendar: registry.calendar(a), id: baseEvent().id });
    expect(registry.target(bid)).toEqual({ calendar: registry.calendar(b), id: baseEvent().id });
    expect(harness.clients.get('A')?.partition).not.toBe(harness.clients.get('B')?.partition);
    expect(harness.clients.get('A')?.password).toBe('test-secret-A');
    expect(
        readAccountPassword(registry.profile(a), registry.calendar(b).settings.account),
    ).toBeUndefined();
    registry.setVisible(a, false);
    expect(registry.events).toHaveLength(2);
    const restarted = openRegistry();
    expect(restarted.summaries().find((profile) => profile.id === a)?.visible).toBe(false);
    expect(restarted.events.map((event) => event.title).toSorted()).toEqual(['A', 'B']);
    harness.load.mockImplementation(async (username) => {
        if (username === 'A') throw new OwaError('auth', 'Wrong password');
        return [{ ...baseEvent(), title: 'B updated' }];
    });
    await registry.syncNow('manual');
    await registry.syncNow('manual');
    expect(registry.calendar(a).sync.errorKind).toBe('auth');
    expect(registry.calendar(b).sync.phase).toBe('ok');
    expect(registry.events.find((event) => event.accountId === b)?.title).toBe('B updated');
    expect(harness.load.mock.calls.filter(([username]) => username === 'A')).toHaveLength(2);
});

it('continues deleting one account after restart without clearing the other account’s data', async () => {
    const registry = openRegistry();
    const a = registry.add(draft('A'));
    const b = registry.add(draft('B'));
    registry.start();
    await registry.syncNow('manual');
    for (const id of [a, b]) {
        const calendar = registry.calendar(id);
        const owner = accountOwner(calendar.settings.account);
        calendar.saveParticipantGroup(owner, { name: 'Team', emails: ['user@example.test'] });
        calendar.setNote(baseEvent().id, 'Account note');
    }
    const ownerA = accountOwner(registry.calendar(a).settings.account);
    const ownerB = accountOwner(registry.calendar(b).settings.account);
    const old = registry.events.find((event) => event.accountId === a)!.id;
    vi.mocked(fs.rmdirSync).mockImplementationOnce(() => {
        throw new Error('Directory busy');
    });
    expect(() => registry.remove(a)).toThrow('Аккаунт отключён');
    expect(() => registry.target(old)).toThrow();
    expect(registry.primaryId).toBe(b);
    expect(loadAccountProfiles().deleting).toHaveLength(1);
    expect(openRegistry().primaryId).toBe(b);
    expect(loadAccountProfiles().deleting).toHaveLength(0);
    expect(existsSync(accountFolder(a))).toBe(false);
    expect(hasAccountNotes(ownerA)).toBe(false);
    expect(hasAccountNotes(ownerB)).toBe(true);
    expect(loadRecent(ownerA).size).toBe(0);
    expect(loadParticipantGroups().list(ownerA)).toEqual([]);
    expect(loadParticipantGroups().list(ownerB)).toHaveLength(1);
});

it('preserves known busy time when any account has no coverage', () => {
    expect(mergeOwnBusy(['01230', '44002'], 6)).toBe('442324');
    expect(mergeOwnBusy(['00', '12'], 2)).toBe('12');
    expect(mergeOwnBusy([], 2)).toBe('44');
});

it('uses the selected server for participants and keeps known own busy slots during a partial failure', async () => {
    const registry = openRegistry();
    const a = registry.calendar(registry.add(draft('A')));
    const b = registry.calendar(registry.add(draft('B')));
    const start = new Date().toISOString();
    const end = new Date(Date.parse(start) + 3_600_000).toISOString();
    const request = { start, end, emails: ['person@example.test'] };
    const lookupA = vi.spyOn(a, 'availability').mockResolvedValue({
        start,
        end,
        people: [{ email: request.emails[0], digits: '00' }],
        self: { email: 'a@example.test', digits: '20' },
        slotMinutes: 30,
    });
    const lookupB = vi.spyOn(b, 'availability').mockRejectedValue(new Error('Network unavailable'));
    const result = await registry.availability(a, request);
    expect(lookupA).toHaveBeenCalledWith(request);
    expect(lookupB).toHaveBeenCalledWith({ start, end, emails: [] });
    expect(result.self?.digits).toBe('24');
    expect(result.people).toEqual([{ email: request.emails[0], digits: '00' }]);
    await expect(registry.availability(b, request)).rejects.toThrow('Network unavailable');
});

it('edits the profile in place without preserving another owner’s credentials or MCP binding', async () => {
    const registry = openRegistry();
    const a = registry.add(draft('A'));
    registry.add(draft('B'));
    registry.setVisible(a, false);
    const calendar = registry.calendar(a);
    const previous = calendar.settings.account;
    const changed = vi.fn();
    registry.on('ownerChanged', changed);
    registry.start();
    await registry.syncNow('manual');
    const oldMeeting = registry.events.find((event) => event.accountId === a)!;
    const update = {
        settings: { ...calendar.settings, account: { ...previous, username: 'A-corrected' } },
    };
    await expect(calendar.testConnection(update)).rejects.toThrow('Сохраните параметры');
    await expect(
        calendar.applySettings({
            settings: { ...calendar.settings, account: { ...previous, username: 'B' } },
        }),
    ).rejects.toThrow('уже добавлен');
    expect(readAccountPassword(registry.profile(a), previous)).toBe('test-secret-A');
    await expect(calendar.applySettings(update)).resolves.toEqual({ passwordRemoved: true });
    expect(registry.primaryId).toBe(a);
    expect(registry.profile(a)).toMatchObject({ label: 'A', visible: false });
    expect(calendar.settings.account).toMatchObject({
        username: 'A-corrected',
        useWindowsAuth: false,
        hasPassword: false,
    });
    expect(readAccountPassword(registry.profile(a), previous)).toBeUndefined();
    expect(registry.target.bind(registry, oldMeeting.id)).toThrow();
    expect(changed).toHaveBeenCalledExactlyOnceWith(a, accountOwner(previous));
    expect(openRegistry().calendar(a).settings.account).toMatchObject({
        username: 'A-corrected',
        useWindowsAuth: false,
    });
});

it.each(['initial', 'rotated'] as const)(
    'keeps the %s password and profile if interrupted immediately before the registry commit',
    async (kind) => {
        const registry = openRegistry();
        const id = registry.add(draft('A'));
        const calendar = registry.calendar(id);
        const previousPassword = kind === 'initial' ? 'test-secret-A' : 'rotated-password';
        if (kind === 'rotated') {
            await calendar.applySettings({
                settings: calendar.settings,
                password: previousPassword,
            });
            await registry.syncNow('manual');
        }
        const profileDir = harness.path;
        const interrupted = mkdtempSync(nodePath.join(tmpdir(), 'owa-interrupted-save-'));
        vi.mocked(fs.renameSync).mockImplementation((from, to) => {
            // Reopen a copy of the disk state before any catch, finally or post-commit cleanup can run.
            if (String(to).endsWith('accounts.json'))
                cpSync(profileDir, interrupted, { recursive: true });
            real.renameSync(from, to);
        });
        try {
            await calendar.applySettings({
                settings: {
                    ...calendar.settings,
                    account: { ...calendar.settings.account, username: 'B' },
                    theme: 'dark',
                },
                password: 'new-password',
            });
            await registry.syncNow('manual');
            const committed = openRegistry();
            expect(committed.primary.settings).toMatchObject({
                theme: 'dark',
                account: { username: 'B' },
            });
            expect(readAccountPassword(committed.profile(id))).toBe('new-password');

            harness.path = interrupted;
            for (let restart = 0; restart < 2; restart++) {
                const recovered = openRegistry();
                expect(recovered.primary.settings).toMatchObject({
                    theme: 'system',
                    account: { username: 'A', hasPassword: true },
                });
                expect(readAccountPassword(recovered.profile(id))).toBe(previousPassword);
                expect(
                    readAccountPassword(recovered.profile(id), committed.primary.settings.account),
                ).toBeUndefined();
            }
        } finally {
            harness.path = profileDir;
            rmSync(interrupted, { recursive: true, force: true });
        }
    },
);

it('does not apply shared settings or credentials when the registry commit fails', async () => {
    saveSettings({ ...DEFAULT_SETTINGS, account: emptyAccountSettings(), theme: 'dark' });
    const registry = openRegistry();
    const id = registry.add(draft('A'));
    const other = registry.add(draft('B'));
    const calendar = registry.calendar(id);
    const previous = calendar.settings.account;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        if (String(to).endsWith('accounts.json')) throw new Error('Disk full');
        real.renameSync(from, to);
    });
    await expect(
        calendar.applySettings({
            settings: {
                ...calendar.settings,
                account: { ...previous, serverUrl: 'new.example.test' },
                theme: 'light',
            },
            password: 'new-password',
        }),
    ).rejects.toThrow('Disk full');
    expect(calendar.settings).toMatchObject({ account: previous, theme: 'dark' });
    expect(registry.calendar(other).settings.theme).toBe('dark');
    const restarted = openRegistry();
    expect(restarted.primary.settings).toMatchObject({ account: previous, theme: 'dark' });
    expect(restarted.calendar(other).settings.theme).toBe('dark');
    expect(readAccountPassword(restarted.profile(id))).toBe('test-secret-A');
});

it('trusting a certificate changes only the account that presented it', async () => {
    const registry = openRegistry();
    const a = registry.calendar(registry.add(draft('A')));
    const otherId = registry.add(draft('B'));
    const b = registry.calendar(otherId);
    const certificate: CertInfo = {
        host: 'mail.example.test',
        fingerprint: `sha256/${'a'.repeat(43)}=`,
        issuer: 'Test',
        subject: 'Test',
        validTo: new Date().toISOString(),
        reason: 'Test',
    };
    const failure = new OwaError('certificate', 'Certificate rejected');
    failure.cert = certificate;
    harness.load.mockImplementation(async (username) => {
        if (username === 'B') throw failure;
        return [baseEvent()];
    });
    registry.start();
    await registry.syncNow('manual');
    expect(b.pendingCertificate()).toEqual(certificate);
    expect(a.pendingCertificate()).toBeUndefined();
    expect(registry.syncState).toMatchObject({
        accountId: otherId,
        sync: { untrustedCert: certificate },
    });
    const revision = a.accountRevision;
    const approval = (accountRevision: number) => ({
        host: certificate.host,
        fingerprint: certificate.fingerprint,
        accountRevision,
    });
    await expect(a.trustCertificate(approval(revision))).rejects.toThrow();
    harness.load.mockResolvedValue([baseEvent()]);
    await b.trustCertificate(approval(b.accountRevision));
    await registry.syncNow('manual');
    expect(a.accountRevision).toBe(revision);
    expect(a.settings.account.trustedCertFingerprint).toBeUndefined();
    expect(b.settings.account.trustedCertFingerprint).toBe(certificate.fingerprint);
});
