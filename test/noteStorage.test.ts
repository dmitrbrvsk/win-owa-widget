import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { hasUnassignedNotes, loadNotes, saveNotes } from '../src/main/store';
import { NoteBook } from '../src/shared/notes';

const state = vi.hoisted(() => ({ path: '', available: true, oversize: false }));
const ALICE = '["mail.example","alice"]';
const BOB = '["mail.example","bob"]';
const NOW = new Date('2026-10-16T10:00:00.000Z');
const pathFor = (account: string) =>
    nodePath.join(state.path, 'notes', `${createHash('sha256').update(account).digest('hex')}.bin`);
vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => state.available,
        encryptString: (s: string) =>
            state.oversize ? Buffer.alloc(8 * 1024 * 1024 + 1) : Buffer.from(`ENC:${s}`),
        decryptString: (b: Buffer) => {
            if (!b.toString().startsWith('ENC:')) throw new Error('Cannot decrypt');
            return b.toString().slice(4);
        },
    },
}));
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
beforeEach(() => {
    state.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-note-storage-'));
    state.available = true;
    state.oversize = false;
});
afterEach(() => rmSync(state.path, { recursive: true, force: true }));
function book(text: string): NoteBook {
    const notes = new NoteBook();
    notes.set('same-id', text, NOW.toISOString(), NOW);
    return notes;
}
it('round-trips independent owners through separate encrypted containers', () => {
    expect(saveNotes(book('Alice private note'), ALICE)).toBe(true);
    expect(saveNotes(book('Bob private note'), BOB)).toBe(true);
    expect(loadNotes(ALICE, NOW).get('same-id')).toBe('Alice private note');
    expect(loadNotes(BOB, NOW).get('same-id')).toBe('Bob private note');
    expect(hasUnassignedNotes()).toBe(false);
});
it('fails closed when another account container is copied into the expected file', () => {
    saveNotes(book('Alice private note'), ALICE);
    copyFileSync(pathFor(ALICE), pathFor(BOB));
    const original = readFileSync(pathFor(BOB));
    expect(loadNotes(BOB, NOW).ids()).toEqual([]);
    expect(() => saveNotes(book('Bob replacement'), BOB)).toThrow(/Исходный файл сохранен/);
    expect(() => saveNotes(new NoteBook(), BOB)).toThrow(/Исходный файл сохранен/);
    expect(readFileSync(pathFor(BOB))).toEqual(original);
    expect(saveNotes(book('Alice update remains possible'), ALICE)).toBe(true);
    expect(loadNotes(ALICE, NOW).get('same-id')).toBe('Alice update remains possible');
});
it.each([
    { version: 2, notes: [] },
    { version: 2, account: ALICE, notes: {} },
    { version: 3, account: ALICE, notes: [] },
])('preserves a container with unknown owner or schema: %j', (value) => {
    mkdirSync(nodePath.dirname(pathFor(ALICE)), { recursive: true });
    const original = `ENC:${JSON.stringify(value)}`;
    writeFileSync(pathFor(ALICE), original);
    expect(loadNotes(ALICE, NOW).size).toBe(0);
    expect(() => saveNotes(new NoteBook(), ALICE)).toThrow(/Исходный файл сохранен/);
    expect(readFileSync(pathFor(ALICE), 'utf8')).toBe(original);
});
it('preserves a temporarily unreadable current account until a successful reload', () => {
    saveNotes(book('Alice retained note'), ALICE);
    const original = readFileSync(pathFor(ALICE));
    state.available = false;
    expect(loadNotes(ALICE, NOW).size).toBe(0);
    state.available = true;
    expect(() => saveNotes(book('Must not replace'), ALICE)).toThrow(/Исходный файл сохранен/);
    expect(readFileSync(pathFor(ALICE))).toEqual(original);
    const recovered = loadNotes(ALICE, NOW);
    expect(recovered.get('same-id')).toBe('Alice retained note');
    expect(saveNotes(recovered, ALICE)).toBe(true);
});
it('never writes plaintext when encryption is unavailable', () => {
    state.available = false;
    expect(saveNotes(book('Private note'), ALICE)).toBe(false);
    expect(existsSync(pathFor(ALICE))).toBe(false);
});

it('refuses oversized ciphertext without replacing a readable account file', () => {
    saveNotes(book('Original note'), ALICE);
    const original = readFileSync(pathFor(ALICE));
    state.oversize = true;
    expect(() => saveNotes(book('Replacement note'), ALICE)).toThrow(/слишком большой/);
    expect(readFileSync(pathFor(ALICE))).toEqual(original);
    state.oversize = false;
    expect(loadNotes(ALICE, NOW).get('same-id')).toBe('Original note');
    expect(saveNotes(book('Readable replacement'), ALICE)).toBe(true);
    expect(loadNotes(ALICE, NOW).get('same-id')).toBe('Readable replacement');
});
