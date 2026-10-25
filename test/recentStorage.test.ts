import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadRecent, removeRecent, saveRecent } from '../src/main/recentStorage';
import { RecentBook } from '../src/shared/frequent';

const state = vi.hoisted(() => ({ path: '', available: true }));
const ALICE = '["mail.example","alice"]';
const BOB = '["mail.example","bob"]';
const NOW = new Date('2026-10-25T10:00:00.000Z');
const pathFor = (account: string) =>
    nodePath.join(
        state.path,
        'recent',
        `${createHash('sha256').update(account).digest('hex')}.bin`,
    );
vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => state.available,
        encryptString: (s: string) => Buffer.from(`ENC:${s}`),
        decryptString: (b: Buffer) => {
            if (!b.toString().startsWith('ENC:')) throw new Error('Cannot decrypt');
            return b.toString().slice(4);
        },
    },
}));
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
beforeEach(() => {
    state.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-recent-storage-'));
    state.available = true;
});
afterEach(() => rmSync(state.path, { recursive: true, force: true }));

function book(email: string, place: string): RecentBook {
    const b = new RecentBook();
    b.record([{ email, name: email.split('@', 1)[0] }], place, NOW);
    return b;
}

it('keeps each account in its own encrypted file', () => {
    expect(saveRecent(book('colleague@alice.example', 'Комната A'), ALICE)).toBe(true);
    expect(saveRecent(book('colleague@bob.example', 'Комната B'), BOB)).toBe(true);
    expect(
        loadRecent(ALICE, NOW)
            .listPeople()
            .map((p) => p.email),
    ).toEqual(['colleague@alice.example']);
    expect(
        loadRecent(BOB, NOW)
            .listPlaces()
            .map((p) => p.text),
    ).toEqual(['Комната B']);
    // Written through the OS encryption (mocked here as an "ENC:" prefix), never as plain JSON.
    expect(readFileSync(pathFor(ALICE)).toString().startsWith('ENC:')).toBe(true);
});

it('a file copied from another account is not used, and not overwritten', () => {
    saveRecent(book('colleague@alice.example', 'Комната A'), ALICE);
    copyFileSync(pathFor(ALICE), pathFor(BOB));
    const original = readFileSync(pathFor(BOB));
    expect(loadRecent(BOB, NOW).size).toBe(0);
    expect(saveRecent(book('someone@bob.example', ''), BOB)).toBe(false);
    expect(readFileSync(pathFor(BOB))).toEqual(original);
});

it('nothing is written without OS encryption', () => {
    state.available = false;
    expect(saveRecent(book('colleague@alice.example', ''), ALICE)).toBe(false);
    expect(existsSync(pathFor(ALICE))).toBe(false);
});

it('an empty list and "forget" remove the file', () => {
    saveRecent(book('colleague@alice.example', 'Комната A'), ALICE);
    expect(saveRecent(new RecentBook(), ALICE)).toBe(true);
    expect(existsSync(pathFor(ALICE))).toBe(false);
    saveRecent(book('colleague@alice.example', 'Комната A'), ALICE);
    removeRecent(ALICE);
    expect(existsSync(pathFor(ALICE))).toBe(false);
    expect(loadRecent(ALICE, NOW).size).toBe(0);
});
