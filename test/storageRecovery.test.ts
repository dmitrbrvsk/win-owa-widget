// Unreadable optional profile files must not prevent startup.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
    loadEventCache,
    loadNotes,
    loadParticipantGroups,
    saveEventCache,
    saveNotes,
} from '../src/main/store';
import { NoteBook } from '../src/shared/notes';
import { type CalendarEvent } from '../src/shared/types';

const ACCOUNT = '["mail.example","alice"]';
const state = vi.hoisted(() => ({ path: '' }));
const noteFile = () =>
    nodePath.join(state.path, 'notes', `${createHash('sha256').update(ACCOUNT).digest('hex')}.bin`);

vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(`ENC:${s}`),
        decryptString: (b: Buffer) => {
            if (!b.toString().startsWith('ENC:')) throw new Error('bad');
            return b.toString().slice(4);
        },
    },
}));
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
beforeEach(() => {
    state.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-audit-'));
});
afterEach(() => rmSync(state.path, { recursive: true, force: true }));
it('recovers from unreadable optional files without deleting them', () => {
    for (const name of ['cache.bin', 'groups.bin']) mkdirSync(nodePath.join(state.path, name));
    mkdirSync(noteFile(), { recursive: true });
    expect(() => loadEventCache('account')).not.toThrow();
    expect(() => loadNotes(ACCOUNT)).not.toThrow();
    expect(() => loadParticipantGroups()).not.toThrow();
});

const event: CalendarEvent = {
    id: 'e',
    title: 'Private',
    start: '2026-10-15T09:00:00.000Z',
    end: '2026-10-15T10:00:00.000Z',
    isAllDay: false,
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    isRecurring: false,
    categories: [],
    platform: 'generic',
};
it('binds the encrypted calendar cache to its account and never guesses a legacy owner', () => {
    saveEventCache([event], 'account-A');
    expect(loadEventCache('account-A').map((e) => e.id)).toEqual(['e']);
    expect(loadEventCache('account-B')).toEqual([]);
    writeFileSync(nodePath.join(state.path, 'cache.bin'), `ENC:${JSON.stringify([event])}`);
    expect(loadEventCache('account-A')).toEqual([]);
});
it.each(['corrupt', 'ENC:{broken', 'ENC:[]'])(
    'preserves unreadable notes and prevents destructive empty writes: %s',
    (content) => {
        const path = noteFile();
        mkdirSync(nodePath.dirname(path), { recursive: true });
        writeFileSync(path, content);
        expect(loadNotes(ACCOUNT).size).toBe(0);
        expect(() => saveNotes(new NoteBook(), ACCOUNT)).toThrow(/Исходный файл сохранен/);
        expect(readFileSync(path, 'utf8')).toBe(content);
    },
);
it('rejects oversized optional files before reading and keeps the notes file', () => {
    writeFileSync(nodePath.join(state.path, 'cache.bin'), Buffer.alloc(16 * 1024 * 1024 + 1));
    mkdirSync(nodePath.dirname(noteFile()), { recursive: true });
    writeFileSync(noteFile(), Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(loadEventCache('account')).toEqual([]);
    expect(loadNotes(ACCOUNT).size).toBe(0);
    expect(existsSync(noteFile())).toBe(true);
});
it('unblocks note writes after the file has been recovered and reloaded', () => {
    const path = noteFile();
    mkdirSync(nodePath.dirname(path), { recursive: true });
    writeFileSync(path, 'corrupt');
    loadNotes(ACCOUNT);
    writeFileSync(path, `ENC:${JSON.stringify({ version: 2, account: ACCOUNT, notes: [] })}`);
    expect(loadNotes(ACCOUNT).size).toBe(0);
    expect(() => saveNotes(new NoteBook(), ACCOUNT)).not.toThrow();
});
