import { existsSync, mkdirSync, rmSync } from 'node:fs';
import nodePath from 'node:path';

import { accountOwner } from '../shared/accountOwner';
import {
    ACCOUNT_COLORS,
    accountColor,
    accountLabel,
    type AccountSummary,
} from '../shared/accounts';
import { openSecret, sealSecret } from '../shared/secret';
import { checkServerUrl, serverKey } from '../shared/serverUrl';
import {
    type AccountSettings,
    type AppSettings,
    type CalendarEvent,
    type SyncState,
} from '../shared/types';
import { readStoredPin, sanitizeEvents, sanitizeSettings } from '../shared/validate';

import { decrypt, encrypt, profileDir, readBounded, writeAtomic } from './profileStorage';
import { saveSettings } from './store';
import { DEFAULT_SETTINGS } from './store.defaults';

export const MIGRATED_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;
const PASSWORD_FILES = ['secret.bin', 'secret-next.bin'] as const;
type PasswordFile = (typeof PASSWORD_FILES)[number];
const EMPTY_ACCOUNT: AccountSettings = {
    serverUrl: '',
    username: '',
    useWindowsAuth: true,
    hasPassword: false,
};

export interface SavedAccount {
    id: string;
    label: string;
    color: string;
    visible: boolean;
    settings: AccountSettings;
    /** Existing profiles use secret.bin; null explicitly means no saved password. */
    passwordFile?: PasswordFile | null;
}

export function profileLabel(profile: SavedAccount): string {
    return profile.label || profile.settings.username || profile.settings.serverUrl;
}

export function profileSummary(
    profile: SavedAccount,
    sync: SyncState,
    label = profileLabel(profile),
): AccountSummary {
    const { id, color, visible } = profile;
    const { phase, errorKind, lastSuccess } = sync;
    return { id, label, color, visible, phase, errorKind, lastSuccess };
}

export interface AccountProfiles {
    version: 1;
    primary?: string;
    legacyPending?: boolean;
    shared?: AppSettings;
    accounts: SavedAccount[];
    deleting: SavedAccount[];
}

function record(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Недопустимые данные аккаунта');
    return input as Record<string, unknown>;
}

export function accountFolder(id: string): string {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(id))
        throw new Error('Недопустимый идентификатор аккаунта');
    return nodePath.join(profileDir(), 'accounts', id);
}

function profilesPath() {
    return nodePath.join(profileDir(), 'accounts.json');
}

function activePasswordFile(profile: SavedAccount) {
    return profile.passwordFile === undefined ? PASSWORD_FILES[0] : profile.passwordFile;
}

export function removeAccountPasswordFiles(id: string, keep?: SavedAccount) {
    const folder = accountFolder(id);
    for (const file of PASSWORD_FILES) {
        const path = nodePath.join(folder, file);
        if (!keep || file !== activePasswordFile(keep)) rmSync(path, { force: true });
        rmSync(`${path}.tmp`, { force: true });
    }
}

export function readAccountPassword(
    profile: SavedAccount,
    settings = profile.settings,
): string | undefined {
    const file = activePasswordFile(profile);
    if (!file || settings.useWindowsAuth) return undefined;
    try {
        const plain = decrypt(
            readBounded(nodePath.join(accountFolder(profile.id), file), 16 * 1024),
        );
        const opened = openSecret(plain ?? '', accountOwner(settings));
        return opened.kind === 'ok' ? opened.password : undefined;
    } catch {
        return undefined;
    }
}

export function writeAccountPassword(
    id: string,
    settings: AccountSettings,
    password: string,
    file: PasswordFile = PASSWORD_FILES[0],
) {
    const encrypted = encrypt(sealSecret(password, accountOwner(settings)));
    if (!encrypted) throw new Error('Шифрование Windows недоступно: пароль не сохранён');
    mkdirSync(accountFolder(id), { recursive: true });
    writeAtomic(nodePath.join(accountFolder(id), file), encrypted);
    return true;
}

export function stageAccountPassword(
    profile: SavedAccount,
    settings: AccountSettings,
    password: string,
) {
    if (!password) return null;
    const file =
        activePasswordFile(profile) === PASSWORD_FILES[0] ? PASSWORD_FILES[1] : PASSWORD_FILES[0];
    writeAccountPassword(profile.id, settings, password, file);
    return file;
}

export function readAccountCache(id: string, owner: string): CalendarEvent[] {
    try {
        const raw = decrypt(
            readBounded(nodePath.join(accountFolder(id), 'cache.bin'), MAX_CACHE_BYTES),
        );
        const value = record(JSON.parse(raw ?? 'null'));
        return value.version === 2 && value.account === owner ? sanitizeEvents(value.events) : [];
    } catch {
        return [];
    }
}

export function writeAccountCache(id: string, owner: string, events: CalendarEvent[]) {
    const encrypted = encrypt(JSON.stringify({ version: 2, account: owner, events }));
    if (!encrypted || encrypted.length > MAX_CACHE_BYTES) return;
    mkdirSync(accountFolder(id), { recursive: true });
    writeAtomic(nodePath.join(accountFolder(id), 'cache.bin'), encrypted);
}

export function clearAccountCache(id: string) {
    rmSync(nodePath.join(accountFolder(id), 'cache.bin'), { force: true });
}

export function writeAccountProfiles(profiles: AccountProfiles) {
    const raw = JSON.stringify(profiles, null, 2);
    if (Buffer.byteLength(raw) > MAX_PROFILE_BYTES)
        throw new Error('Список аккаунтов слишком большой');
    writeAtomic(profilesPath(), raw);
}

function parseProfile(input: unknown): SavedAccount {
    const value = record(input);
    if (typeof value.id !== 'string') throw new Error('Недопустимый идентификатор аккаунта');
    accountFolder(value.id);
    const settings = record(value.settings);
    const address = checkServerUrl(
        typeof settings.serverUrl === 'string' ? settings.serverUrl : '',
    );
    if (
        !address.ok ||
        typeof settings.username !== 'string' ||
        settings.username.length > 256 ||
        typeof settings.useWindowsAuth !== 'boolean' ||
        settings.useWindowsAuth === Boolean(settings.username.trim())
    )
        throw new Error('Повреждены настройки аккаунта');
    const account: AccountSettings = {
        serverUrl: address.url.replace(/^https:\/\//, ''),
        username: settings.username.trim(),
        useWindowsAuth: settings.useWindowsAuth,
        hasPassword: false,
    };
    if (
        typeof settings.trustedCertHost === 'string' &&
        settings.trustedCertHost === new URL(address.url).hostname &&
        typeof settings.trustedCertFingerprint === 'string' &&
        /^sha256\/[\dA-Za-z+/]{43}=$/.test(settings.trustedCertFingerprint)
    ) {
        account.trustedCertHost = settings.trustedCertHost;
        account.trustedCertFingerprint = settings.trustedCertFingerprint;
    }
    const { passwordFile } = value;
    if (
        passwordFile !== undefined &&
        passwordFile !== null &&
        passwordFile !== PASSWORD_FILES[0] &&
        passwordFile !== PASSWORD_FILES[1]
    )
        throw new Error('Повреждена ссылка на пароль аккаунта');
    const profile: SavedAccount = {
        id: value.id,
        label: accountLabel(value.label),
        color: accountColor(value.color),
        visible: value.visible === true,
        settings: account,
        passwordFile,
    };
    account.hasPassword = !!readAccountPassword(profile);
    return profile;
}

export function loadAccountProfiles(): AccountProfiles {
    const path = profilesPath();
    const profiles: AccountProfiles = { version: 1, accounts: [], deleting: [] };
    if (existsSync(path)) {
        const raw = record(JSON.parse(readBounded(path, MAX_PROFILE_BYTES).toString('utf8')));
        if (raw.version !== 1 || !Array.isArray(raw.accounts) || !Array.isArray(raw.deleting))
            throw new Error('Повреждён список аккаунтов');
        profiles.accounts = raw.accounts.map(parseProfile);
        profiles.deleting = raw.deleting.map(parseProfile);
        const all = [...profiles.accounts, ...profiles.deleting];
        if (
            new Set(all.map((p) => p.id)).size !== all.length ||
            new Set(all.map((p) => accountOwner(p.settings))).size !== all.length
        )
            throw new Error('Список аккаунтов содержит дубликаты');
        profiles.primary =
            profiles.accounts.find((p) => p.id === raw.primary)?.id ?? profiles.accounts[0]?.id;
        profiles.legacyPending = raw.legacyPending === true;
        if (raw.shared !== undefined) profiles.shared = sharedSettings(raw.shared);
        return resumeLegacyMigration(profiles);
    }
    const old = readLegacySettings();
    const oldAccount =
        old.account && typeof old.account === 'object'
            ? (old.account as Partial<AccountSettings>)
            : undefined;
    const { account } = sanitizeSettings(old, DEFAULT_SETTINGS);
    const address = checkServerUrl(account.serverUrl);
    if (!address.ok) return profiles;
    Object.assign(account, readStoredPin(old));
    account.serverUrl = address.url.replace(/^https:\/\//, '');
    const secret = nodePath.join(profileDir(), 'secret.bin');
    account.useWindowsAuth =
        !account.username ||
        (oldAccount?.useWindowsAuth !== false && !oldAccount?.hasPassword && !existsSync(secret));
    if (account.useWindowsAuth) account.username = '';
    profiles.accounts.push({
        id: MIGRATED_ACCOUNT_ID,
        label: '',
        color: ACCOUNT_COLORS[0],
        visible: true,
        settings: account,
    });
    profiles.primary = MIGRATED_ACCOUNT_ID;
    // The registry identifies the original owner before any original is retired.
    profiles.legacyPending = true;
    writeAccountProfiles(profiles);
    return resumeLegacyMigration(profiles);
}

function readLegacySettings() {
    try {
        const path = nodePath.join(profileDir(), 'settings.json');
        return record(JSON.parse(readBounded(path, MAX_PROFILE_BYTES).toString('utf8')));
    } catch {
        return {};
    }
}

function sharedSettings(raw: unknown): AppSettings {
    return {
        ...sanitizeSettings(raw, DEFAULT_SETTINGS),
        account: emptyAccountSettings(),
    };
}

export function loadSharedSettings() {
    return sharedSettings(readLegacySettings());
}

function copyLegacyArtifacts(profile: SavedAccount) {
    const { settings, id } = profile;
    const oldSecret = nodePath.join(profileDir(), 'secret.bin');
    if (
        !settings.useWindowsAuth &&
        profile.passwordFile === undefined &&
        existsSync(oldSecret) &&
        !existsSync(nodePath.join(accountFolder(id), PASSWORD_FILES[0]))
    ) {
        const plain = decrypt(readBounded(oldSecret, 16 * 1024));
        if (plain === null) return false;
        const opened = openSecret(plain, serverKey(settings.serverUrl));
        if (opened.kind === 'ok') writeAccountPassword(id, settings, opened.password);
    }
    const oldCache = nodePath.join(profileDir(), 'cache.bin');
    const newCache = nodePath.join(accountFolder(id), 'cache.bin');
    if (existsSync(oldCache) && !existsSync(newCache)) {
        const encrypted = readBounded(oldCache, MAX_CACHE_BYTES);
        const plain = decrypt(encrypted);
        if (plain === null) return false;
        let cache: Record<string, unknown> | undefined;
        try {
            cache = record(JSON.parse(plain));
        } catch {
            cache = undefined;
        }
        if (cache?.version === 2 && cache.account === accountOwner(settings)) {
            mkdirSync(accountFolder(id), { recursive: true });
            writeAtomic(newCache, encrypted);
        }
    }
    return true;
}

function resumeLegacyMigration(profiles: AccountProfiles) {
    if (profiles.legacyPending) {
        const old = profiles.accounts.find(({ id }) => id === MIGRATED_ACCOUNT_ID);
        try {
            if (old && !copyLegacyArtifacts(old)) return profiles;
            if (old) old.settings.hasPassword = !!readAccountPassword(old);
            writeAccountProfiles({ ...profiles, legacyPending: false });
            profiles.legacyPending = false;
        } catch {
            // A restart can finish the import after storage or DPAPI recovers.
            return profiles;
        }
    }
    const raw = readLegacySettings();
    const legacy = raw.account as Partial<AccountSettings> | undefined;
    if (legacy?.serverUrl) saveSettings(loadSharedSettings());
    discardLegacyArtifact('secret.bin');
    discardLegacyArtifact('cache.bin');
    return profiles;
}

export function discardLegacyArtifact(name: 'secret.bin' | 'cache.bin') {
    const path = nodePath.join(profileDir(), name);
    rmSync(path, { force: true });
    rmSync(`${path}.tmp`, { force: true });
}

export function emptyAccountSettings(): AccountSettings {
    return { ...EMPTY_ACCOUNT };
}
