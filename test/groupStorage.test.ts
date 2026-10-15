import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadParticipantGroups, saveParticipantGroups } from '../src/main/store';
import { ParticipantGroupBook } from '../src/shared/participantGroups';

const state = vi.hoisted(() => ({ path: '', available: true }));
vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => state.available,
        encryptString: (text: string) =>
            Buffer.from(`encrypted:${Buffer.from(text).toString('base64')}`),
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
