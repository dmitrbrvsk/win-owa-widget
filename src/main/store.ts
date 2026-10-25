// Settings (plain JSON) and secrets / cache (encrypted with Windows DPAPI via safeStorage).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import nodePath from 'node:path';

import { openSecret, sealSecret } from '../shared/secret';
import { checkServerUrl, serverKey } from '../shared/serverUrl';
import { type AppSettings, type CalendarEvent } from '../shared/types';
import { readStoredPin, sanitizeEvents, sanitizeSettings } from '../shared/validate';

import { log } from './log';
import { decrypt, encrypt, profileDir as dir, readBounded, writeAtomic } from './profileStorage';
import { DEFAULT_SETTINGS } from './store.defaults';

export { DEFAULT_SETTINGS };
export { loadParticipantGroups, saveParticipantGroups } from './groupStorage';
export { hasUnassignedNotes, loadNotes, saveNotes } from './noteStorage';
export { loadRecent, removeRecent, saveRecent } from './recentStorage';

/** No settings file yet: the very first launch, when the settings window should open to confirm the defaults. */
export function isFirstRun(): boolean {
    return !existsSync(nodePath.join(dir(), 'settings.json'));
}

export function loadSettings(): AppSettings {
    try {
        const raw = JSON.parse(
            readFileSync(nodePath.join(dir(), 'settings.json'), 'utf8'),
        ) as unknown;
        // The file is plain JSON that any program of this user can edit: read it through the same filter as the UI input.
        const clean = sanitizeSettings(raw, DEFAULT_SETTINGS);
        // A stored address that cannot be connected to (an e-mail typed into an older version, say) is
        // replaced by the default rather than failing every sync until the person finds it.
        if (clean.account.serverUrl && !checkServerUrl(clean.account.serverUrl).ok) {
            log.warn(
                `settings: stored server address is not a server address, using the default instead`,
            );
            clean.account.serverUrl = DEFAULT_SETTINGS.account.serverUrl;
        }
        const hasPassword = !!loadPassword(serverKey(clean.account.serverUrl));
        return {
            ...clean,
            account: {
                ...clean.account,
                ...readStoredPin(raw),
                hasPassword,
                useWindowsAuth: !clean.account.username || !hasPassword,
            },
        };
    } catch {
        return { ...DEFAULT_SETTINGS, account: { ...DEFAULT_SETTINGS.account } };
    }
}

export function saveSettings(s: AppSettings) {
    writeAtomic(nodePath.join(dir(), 'settings.json'), JSON.stringify(s, null, 2));
}

/**
 * The saved password, only for the server it was typed for (`server` is `host[:port]`, see
 * serverKey). For any other server, or none, there is no password.
 */
export function loadPassword(server: string): string | undefined {
    const p = nodePath.join(dir(), 'secret.bin');
    if (!server || !existsSync(p)) return undefined;
    const plain = decrypt(readFileSync(p));
    if (plain === null) return undefined;
    const opened = openSecret(plain, server);
    if (opened.kind === 'ok') return opened.password;
    if (opened.kind === 'legacy') {
        // Saved by a version before 0.2.0, which kept the bare password with no record of the server it
        // was typed for. Binding it to whatever address is in settings.json now would hand it to a server
        // the person never confirmed (that file is editable by anything running as this user), so it is
        // forgotten instead and asked for again — once, on the way from a build nobody is running any more.
        log.warn(
            'password: stored by a version before 0.2.0 with no server of its own; forgotten, it has to be entered again',
        );
        rmSync(p, { force: true });
        return undefined;
    }
    return undefined;
}

/** Returns whether the password is stored afterwards (false: cleared, or encryption unavailable). */
export function savePassword(password: string | undefined, server: string): boolean {
    const p = nodePath.join(dir(), 'secret.bin');
    if (!password || !server) {
        rmSync(p, { force: true });
        return false;
    }
    const enc = encrypt(sealSecret(password, server));
    // No OS encryption available → never write the password in the clear.
    if (!enc) return false;
    writeAtomic(p, enc);
    return true;
}

/** The last synced meetings, so the widget shows something offline and right after launch. */
export function loadEventCache(account: string): CalendarEvent[] {
    try {
        const p = nodePath.join(dir(), 'cache.bin');
        if (!existsSync(p)) return [];
        const text = decrypt(readBounded(p, 16 * 1024 * 1024));
        if (!text) return [];
        const raw: unknown = JSON.parse(text);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []; // Legacy cache has no owner: resync.
        const value = raw as Record<string, unknown>;
        return value.version === 2 && value.account === account ? sanitizeEvents(value.events) : [];
    } catch {
        log.warn('cache: could not read the optional cache; starting without it');
        return [];
    }
}

export function saveEventCache(events: CalendarEvent[], account: string) {
    const enc = encrypt(JSON.stringify({ version: 2, account, events }));
    if (enc) writeAtomic(nodePath.join(dir(), 'cache.bin'), enc);
}

/** Removes the saved meeting list from the disk (the "reset cache" button). */
export function clearEventCache() {
    rmSync(nodePath.join(dir(), 'cache.bin'), { force: true });
}
