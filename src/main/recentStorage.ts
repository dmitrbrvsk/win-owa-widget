// People and places of the meetings this app created, kept per account like the notes: one encrypted
// file per account owner, so a second account never sees the first one's colleagues.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import nodePath from 'node:path';

import { RecentBook } from '../shared/frequent';

import { log } from './log';
import { decrypt, encrypt, profileDir, readBounded, writeAtomic } from './profileStorage';

const MAX_RECENT_FILE_BYTES = 512 * 1024;
const unreadable = new Set<string>();

function recentPath(account: string): string {
    if (!account || account.length > 2048) throw new Error('Invalid recent account');
    const key = createHash('sha256').update(account).digest('hex');
    return nodePath.join(profileDir(), 'recent', `${key}.bin`);
}

export function loadRecent(account: string, now: Date = new Date()): RecentBook {
    const path = recentPath(account);
    try {
        if (!existsSync(path)) {
            unreadable.delete(path);
            return new RecentBook();
        }
        const plain = decrypt(readBounded(path, MAX_RECENT_FILE_BYTES));
        if (!plain) throw new Error('Cannot decrypt');
        const raw: unknown = JSON.parse(plain);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid');
        const value = raw as { version?: unknown; account?: unknown };
        if (value.version !== 1 || value.account !== account) throw new Error('Invalid owner');
        unreadable.delete(path);
        return RecentBook.parse(raw, now);
    } catch {
        // Suggestions are a convenience: an unreadable file is left as it is and simply not used.
        unreadable.add(path);
        log.warn(
            'recent: could not read the account file; suggestions start empty, file preserved',
        );
        return new RecentBook();
    }
}

/** False when nothing was written: no OS encryption, or a file that could not be read is never overwritten. */
export function saveRecent(book: RecentBook, account: string): boolean {
    const path = recentPath(account);
    if (unreadable.has(path)) return false;
    if (book.size === 0) {
        rmSync(path, { force: true });
        return true;
    }
    const enc = encrypt(JSON.stringify({ version: 1, account, ...book.toJSON() }));
    if (!enc || enc.length > MAX_RECENT_FILE_BYTES) return false;
    mkdirSync(nodePath.dirname(path), { recursive: true });
    writeAtomic(path, enc);
    return true;
}

/** "Forget": removes the file even when it could not be read. */
export function removeRecent(account: string): void {
    const path = recentPath(account);
    rmSync(path, { force: true });
    unreadable.delete(path);
}
