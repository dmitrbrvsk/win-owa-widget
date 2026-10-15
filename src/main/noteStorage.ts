// Legacy notes have no reliable account owner: preserve them without reading or assigning them.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import nodePath from 'node:path';

import { NoteBook } from '../shared/notes';

import { log } from './log';
import { decrypt, encrypt, profileDir, readBounded, writeAtomic } from './profileStorage';

const MAX_NOTE_FILE_BYTES = 8 * 1024 * 1024;
const unreadableNotes = new Set<string>();

function notePath(account: string): string {
    if (!account || account.length > 2048) throw new Error('Invalid note account');
    const key = createHash('sha256').update(account).digest('hex');
    return nodePath.join(profileDir(), 'notes', `${key}.bin`);
}

/** Only existence is inspected: legacy contents and meeting IDs never enter the active account. */
export function hasUnassignedNotes(): boolean {
    return existsSync(nodePath.join(profileDir(), 'notes.bin'));
}

export function loadNotes(account: string, now: Date = new Date()): NoteBook {
    const path = notePath(account);
    try {
        if (!existsSync(path)) {
            unreadableNotes.delete(path);
            return new NoteBook();
        }
        const plain = decrypt(readBounded(path, MAX_NOTE_FILE_BYTES));
        if (!plain) throw new Error('Cannot decrypt notes');
        const raw: unknown = JSON.parse(plain);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid notes');
        const value = raw as { version?: unknown; account?: unknown; notes?: unknown };
        if (value.version !== 2 || value.account !== account || !Array.isArray(value.notes))
            throw new Error('Invalid note owner or container');
        const book = NoteBook.parse(raw, now);
        unreadableNotes.delete(path);
        return book;
    } catch {
        unreadableNotes.add(path);
        log.warn(
            'notes: could not read the account file; original preserved and writes blocked until recovery',
        );
        return new NoteBook();
    }
}

/** An empty book removes only this account's file; an unreadable original is never overwritten. */
export function saveNotes(book: NoteBook, account: string): boolean {
    const path = notePath(account);
    if (unreadableNotes.has(path))
        throw new Error(
            'Файл заметок не удалось прочитать. Исходный файл сохранен: восстановите доступ и перезапустите приложение',
        );
    if (book.size === 0) {
        rmSync(path, { force: true });
        return true;
    }
    const enc = encrypt(JSON.stringify({ version: 2, account, notes: book.toJSON().notes }));
    if (!enc) return false;
    if (enc.length > MAX_NOTE_FILE_BYTES)
        throw new Error(
            'Файл заметок слишком большой: удалите ненужные заметки и повторите сохранение',
        );
    mkdirSync(nodePath.dirname(path), { recursive: true });
    writeAtomic(path, enc);
    return true;
}
