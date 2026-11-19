import { type AppSettings } from '../shared/types';

import {
    clearAccountCache,
    discardLegacyArtifact,
    MIGRATED_ACCOUNT_ID,
    readAccountCache,
    readAccountPassword,
    writeAccountCache,
    writeAccountPassword,
} from './accountProfiles';
import { type CalendarProfileStorage } from './calendarService';

export function calendarProfileStorage(
    settings: AppSettings,
    id: string | undefined,
    legacyPending: () => boolean,
    saveSettings: CalendarProfileStorage['saveSettings'],
): CalendarProfileStorage {
    const discardLegacy = (file: 'secret.bin' | 'cache.bin') => {
        if (id === MIGRATED_ACCOUNT_ID && legacyPending()) discardLegacyArtifact(file);
    };
    return {
        partition: `owa-${id ?? 'empty'}`,
        settings,
        saveSettings,
        loadPassword: (account) => (id ? readAccountPassword(id, account) : undefined),
        savePassword: (password, account) => {
            if (!id) return false;
            const saved = writeAccountPassword(id, account, password);
            discardLegacy('secret.bin');
            return saved;
        },
        loadCache: (owner) => (id ? readAccountCache(id, owner) : []),
        saveCache: (events, owner) => {
            if (id) writeAccountCache(id, owner, events);
        },
        clearCache: () => {
            if (id) clearAccountCache(id);
            discardLegacy('cache.bin');
        },
    };
}
