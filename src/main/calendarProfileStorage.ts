import { type AppSettings } from '../shared/types';

import {
    clearAccountCache,
    discardLegacyArtifact,
    MIGRATED_ACCOUNT_ID,
    readAccountCache,
    writeAccountCache,
} from './accountProfiles';
import { type CalendarProfileStorage } from './calendarService';

export function calendarProfileStorage(
    settings: AppSettings,
    id: string | undefined,
    legacyPending: () => boolean,
    persistence: Pick<
        CalendarProfileStorage,
        'saveSettings' | 'loadPassword' | 'validateConnection'
    >,
): CalendarProfileStorage {
    return {
        partition: `owa-${id ?? 'empty'}`,
        settings,
        ...persistence,
        loadCache: (owner) => (id ? readAccountCache(id, owner) : []),
        saveCache: (events, owner) => {
            if (id) writeAccountCache(id, owner, events);
        },
        clearCache: () => {
            if (id) clearAccountCache(id);
            if (id === MIGRATED_ACCOUNT_ID && legacyPending()) discardLegacyArtifact('cache.bin');
        },
    };
}
