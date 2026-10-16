import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import nodePath from 'node:path';

import { legacyAccountOwner } from '../shared/accountOwner';

import { loadParticipantGroups, prepareGroupMigration } from './groupStorage';
import { hasAccountNotes, prepareNoteMigration } from './noteStorage';
import { decrypt, encrypt, profileDir, readBounded, writeAtomic } from './profileStorage';

interface Receipt {
    version: 1;
    from: string;
    to: string;
    done: boolean;
}

function paths(from: string) {
    const key = createHash('sha256').update(from).digest('hex');
    const directory = nodePath.join(profileDir(), 'account-migrations');
    return {
        directory,
        receipt: nodePath.join(directory, `${key}.bin`),
        backup: nodePath.join(directory, `${key}.groups.bin`),
    };
}

function readReceipt(from: string): Receipt | undefined {
    const { receipt } = paths(from);
    if (!existsSync(receipt)) return undefined;
    const plain = decrypt(readBounded(receipt, 16 * 1024));
    if (!plain) throw new Error('Cannot decrypt account migration');
    const value: unknown = JSON.parse(plain);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid account migration');
    const record = value as Partial<Receipt>;
    if (
        record.version !== 1 ||
        record.from !== from ||
        typeof record.to !== 'string' ||
        typeof record.done !== 'boolean' ||
        legacyAccountOwner(record.to)?.key !== from
    )
        throw new Error('Invalid account migration owner');
    return record as Receipt;
}

function writeReceipt(record: Receipt) {
    const location = paths(record.from);
    const encrypted = encrypt(JSON.stringify(record));
    if (!encrypted || encrypted.length > 16 * 1024)
        throw new Error('Cannot save account migration');
    mkdirSync(location.directory, { recursive: true, mode: 0o700 });
    writeAtomic(location.receipt, encrypted);
}

/** A saved decision reserves an ambiguous source before any data is copied to its new owner. */
export function migrateAccountData(owner: string, claim = false): 'available' | undefined {
    const legacy = legacyAccountOwner(owner);
    if (!legacy) return undefined;
    const receipt = readReceipt(legacy.key);
    if (receipt && receipt.to !== owner) {
        if (claim) throw new Error('Preserved data already belongs to another account');
        return undefined;
    }
    if (receipt?.done) return undefined;
    const hasGroups = loadParticipantGroups().list(legacy.key).length > 0;
    if (!receipt && !hasGroups && !hasAccountNotes(legacy.key)) return undefined;
    if (!receipt && legacy.ambiguous && !claim) return 'available';

    // Preflight both replacements first. Capacity/conflict errors cannot make a partial import.
    const groups = prepareGroupMigration(legacy.key, owner, paths(legacy.key).backup);
    const notes = prepareNoteMigration(legacy.key, owner);
    if (!receipt) writeReceipt({ version: 1, from: legacy.key, to: owner, done: false });
    groups();
    notes();
    writeReceipt({ version: 1, from: legacy.key, to: owner, done: true });
    return undefined;
}

/** A partial migration cannot be edited or deleted until its idempotent retry finishes. */
export function incompleteAccountMigration(owner: string): boolean {
    const legacy = legacyAccountOwner(owner);
    if (!legacy) return false;
    try {
        const receipt = readReceipt(legacy.key);
        return receipt?.to === owner && !receipt.done;
    } catch {
        return true;
    }
}
