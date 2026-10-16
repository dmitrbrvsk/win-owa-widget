import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';

import { MAX_GROUP_NAME, ParticipantGroupBook } from '../shared/participantGroups';

import { log } from './log';
import { decrypt, encrypt, profileDir as dir, readBounded, writeAtomic } from './profileStorage';

const MAX_GROUP_FILE_BYTES = 1024 * 1024;
const unreadableGroups = new Set<string>();

/** Participant addresses are never written as plain JSON. */
export function loadParticipantGroups(): ParticipantGroupBook {
    const path = nodePath.join(dir(), 'groups.bin');
    try {
        if (!existsSync(path)) {
            unreadableGroups.delete(path);
            return new ParticipantGroupBook();
        }
        const plain = decrypt(readBounded(path, MAX_GROUP_FILE_BYTES));
        if (!plain) throw new Error('Cannot decrypt participant groups');
        const raw: unknown = JSON.parse(plain);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Invalid participant groups');
        const value = raw as { version?: unknown; groups?: unknown };
        if (value.version !== 1 || !Array.isArray(value.groups))
            throw new Error('Invalid participant groups');
        const book = ParticipantGroupBook.parse(raw);
        if (book.toJSON().groups.length !== value.groups.length)
            throw new Error('Invalid participant group entries');
        unreadableGroups.delete(path);
        return book;
    } catch {
        unreadableGroups.add(path);
        log.warn(
            'groups: could not read the file; original preserved and writes blocked until recovery',
        );
        return new ParticipantGroupBook();
    }
}
export function saveParticipantGroups(book: ParticipantGroupBook): boolean {
    const path = nodePath.join(dir(), 'groups.bin');
    if (unreadableGroups.has(path))
        throw new Error(
            'Файл групп не удалось прочитать. Исходный файл сохранен: восстановите доступ и перезапустите приложение',
        );
    const enc = encrypt(JSON.stringify(book));
    if (!enc) return false;
    if (enc.length > MAX_GROUP_FILE_BYTES)
        throw new Error(
            'Файл групп слишком большой: удалите ненужные группы и повторите сохранение',
        );
    writeAtomic(path, enc);
    return true;
}

/** Build the complete replacement before reserving ownership or changing any file. */
export function prepareGroupMigration(from: string, to: string, backup: string): () => void {
    const path = nodePath.join(dir(), 'groups.bin');
    const book = loadParticipantGroups();
    if (unreadableGroups.has(path)) throw new Error('Cannot read preserved groups');
    const legacy = book.list(from);
    if (!legacy.length) return () => {};
    const next = ParticipantGroupBook.parse({
        version: 1,
        groups: book.toJSON().groups.filter((entry) => entry.account !== from),
    });
    const own = next.list(to);
    const names = new Set(own.map((entry) => entry.name.toLowerCase()));
    const ids = new Set(own.map((entry) => entry.id));
    for (const entry of legacy) {
        let { name } = entry;
        for (let suffix = 2; names.has(name.toLowerCase()); suffix++) {
            const tail = ` (${suffix})`;
            name = entry.name.slice(0, MAX_GROUP_NAME - tail.length).trimEnd() + tail;
        }
        const id = ids.has(entry.id) ? randomUUID() : entry.id;
        next.save(to, { name, emails: entry.emails }, () => id);
        names.add(name.toLowerCase());
        ids.add(id);
    }
    const original = readBounded(path, MAX_GROUP_FILE_BYTES);
    return () => {
        if (existsSync(backup)) {
            const saved = decrypt(readBounded(backup, MAX_GROUP_FILE_BYTES));
            if (
                !saved ||
                JSON.stringify(ParticipantGroupBook.parse(JSON.parse(saved)).list(from)) !==
                    JSON.stringify(legacy)
            )
                throw new Error('Cannot verify preserved group backup');
        } else {
            writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
        }
        if (!saveParticipantGroups(next)) throw new Error('Cannot encrypt migrated groups');
    };
}
