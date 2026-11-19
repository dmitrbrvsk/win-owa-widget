import { existsSync, rmdirSync, rmSync } from 'node:fs';
import nodePath from 'node:path';

import { accountOwner } from '../shared/accountOwner';
import { type AppSettings } from '../shared/types';

import { removeMigratedAccountData } from './accountMigration';
import {
    accountFolder,
    discardLegacyArtifact,
    MIGRATED_ACCOUNT_ID,
    removeAccountPasswordFiles,
    type SavedAccount,
} from './accountProfiles';
import { removeRecent } from './recentStorage';
import { saveSettings } from './store';

export function removeProfileFiles(profile: SavedAccount, settings: AppSettings) {
    const owner = accountOwner(profile.settings);
    const folder = accountFolder(profile.id);
    removeAccountPasswordFiles(profile.id);
    for (const name of ['cache.bin', 'cache.bin.tmp']) {
        rmSync(nodePath.join(folder, name), { force: true });
    }
    if (profile.id === MIGRATED_ACCOUNT_ID) {
        saveSettings(settings);
        discardLegacyArtifact('secret.bin');
        discardLegacyArtifact('cache.bin');
    }
    if (existsSync(folder)) rmdirSync(folder);
    removeMigratedAccountData(owner);
    removeRecent(owner);
}
