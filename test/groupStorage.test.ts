import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadParticipantGroups, saveParticipantGroups } from '../src/main/store';
import { ParticipantGroupBook } from '../src/shared/participantGroups';

const state = vi.hoisted(() => ({ path: '', available: true, oversize: false }));
vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => state.available,
        encryptString: (text: string) =>
            state.oversize
                ? Buffer.alloc(1024 * 1024 + 1)
                : Buffer.from(`encrypted:${Buffer.from(text).toString('base64')}`),
        decryptString: (buf: Buffer) => {
            const text = buf.toString();
            if (!text.startsWith('encrypted:')) throw new Error('invalid encrypted data');
            return Buffer.from(text.slice(10), 'base64').toString();
        },
    },
}));
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
    state.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-groups-test-'));
    state.available = true;
    state.oversize = false;
});
afterEach(() => rmSync(state.path, { force: true, recursive: true }));
it('encrypts and reloads saved groups, never falls back to plain text', () => {
    const book = new ParticipantGroupBook();
    book.save('account', { name: 'Team', emails: ['private@example.com'] }, randomUUID);
    expect(saveParticipantGroups(book)).toBe(true);
    const path = nodePath.join(state.path, 'groups.bin');
    const encrypted = readFileSync(path);
    expect(encrypted.toString()).not.toContain('private@example.com');
    expect(loadParticipantGroups().list('account')).toEqual(book.list('account'));
    state.available = false;
    book.save('account', { name: 'Other', emails: ['new@example.com'] }, randomUUID);
    expect(saveParticipantGroups(book)).toBe(false);
    expect(readFileSync(path)).toEqual(encrypted);
    expect(loadParticipantGroups().list('account')).toEqual([]);
});
it('handles missing, corrupt and oversized encrypted files safely', () => {
    expect(loadParticipantGroups().list('account')).toEqual([]);
    writeFileSync(nodePath.join(state.path, 'groups.bin'), 'corrupt');
    expect(loadParticipantGroups().list('account')).toEqual([]);
    writeFileSync(nodePath.join(state.path, 'groups.bin'), Buffer.alloc(1024 * 1024 + 1));
    expect(loadParticipantGroups().list('account')).toEqual([]);
});
it('preserves valid groups after temporary decryption failure until a successful reload', () => {
    const original = new ParticipantGroupBook();
    original.save('account-a', { name: 'Original team', emails: ['a@example.com'] }, randomUUID);
    saveParticipantGroups(original);
    const path = nodePath.join(state.path, 'groups.bin');
    const encrypted = readFileSync(path);
    state.available = false;
    const unavailable = loadParticipantGroups();
    state.available = true;
    unavailable.save('account-b', { name: 'New team', emails: ['b@example.com'] }, randomUUID);
    expect(() => saveParticipantGroups(unavailable)).toThrow(/Исходный файл сохранен/);
    expect(readFileSync(path)).toEqual(encrypted);
    const recovered = loadParticipantGroups();
    expect(recovered.list('account-a')).toEqual(original.list('account-a'));
    expect(saveParticipantGroups(recovered)).toBe(true);
});
it.each([
    'corrupt',
    'encrypted:e2Jyb2tlbg==',
    `encrypted:${Buffer.from(JSON.stringify({ version: 2, groups: [] })).toString('base64')}`,
    `encrypted:${Buffer.from(JSON.stringify({ version: 1, groups: {} })).toString('base64')}`,
    `encrypted:${Buffer.from(JSON.stringify({ version: 1, groups: [{ account: 'account' }] })).toString('base64')}`,
])('preserves invalid group files instead of replacing them with an empty book: %s', (content) => {
    const path = nodePath.join(state.path, 'groups.bin');
    writeFileSync(path, content);
    const unavailable = loadParticipantGroups();
    expect(() => saveParticipantGroups(unavailable)).toThrow(/Исходный файл сохранен/);
    expect(readFileSync(path, 'utf8')).toBe(content);
});

it('refuses oversized ciphertext without replacing readable groups', () => {
    const original = new ParticipantGroupBook();
    original.save('account', { name: 'Original team', emails: ['a@example.com'] }, randomUUID);
    saveParticipantGroups(original);
    const path = nodePath.join(state.path, 'groups.bin');
    const encrypted = readFileSync(path);
    const replacement = new ParticipantGroupBook();
    replacement.save('account', { name: 'New team', emails: ['b@example.com'] }, randomUUID);
    state.oversize = true;
    expect(() => saveParticipantGroups(replacement)).toThrow(/слишком большой/);
    expect(readFileSync(path)).toEqual(encrypted);
    state.oversize = false;
    expect(loadParticipantGroups().list('account')).toEqual(original.list('account'));
    expect(saveParticipantGroups(replacement)).toBe(true);
    expect(loadParticipantGroups().list('account')).toEqual(replacement.list('account'));
});
