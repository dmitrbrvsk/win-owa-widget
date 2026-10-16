import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AccountData } from '../src/main/accountData';
import { loadParticipantGroups, saveParticipantGroups } from '../src/main/groupStorage';
import { loadNotes, saveNotes } from '../src/main/noteStorage';
import { loadEventCache, saveEventCache } from '../src/main/store';
import { NoteBook } from '../src/shared/notes';
import { participantGroupAccount } from '../src/shared/participantGroups';
import { type CalendarEvent } from '../src/shared/types';

const nativeFs = await vi.importActual<typeof fs>('node:fs');
const state = vi.hoisted(() => ({ profile: '', available: true }));
vi.mock('electron', () => ({
    app: { getPath: () => state.profile, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => state.available,
        encryptString: (text: string) => Buffer.from(`ENC:${text}`),
        decryptString: (data: Buffer) => {
            if (!data.toString().startsWith('ENC:')) throw new Error('Invalid fixture');
            return data.toString().slice(4);
        },
    },
}));
vi.mock('node:fs', async (original) => {
    const real = await original<typeof fs>();
    return { ...real, renameSync: vi.fn(real.renameSync) };
});
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
const key = (principal: string, sso = false) =>
    participantGroupAccount({
        serverUrl: 'mail.example',
        username: principal,
        useWindowsAuth: sso,
    });
const legacy = (principal: string) => JSON.stringify(['mail.example', principal]);
const notePath = (owner: string) =>
    nodePath.join(
        state.profile,
        'notes',
        `${createHash('sha256').update(owner).digest('hex')}.bin`,
    );
const groupPath = () => nodePath.join(state.profile, 'groups.bin');
const now = new Date('2026-10-16T10:00:00Z');
function seed(owner: string) {
    const groups = loadParticipantGroups();
    groups.save(owner, { name: 'Original team', emails: ['private@example.invalid'] }, randomUUID);
    saveParticipantGroups(groups);
    const notes = new NoteBook();
    notes.set('same-event', 'Original note', now.toISOString(), now);
    saveNotes(notes, owner);
    return { note: readFileSync(notePath(owner)), groups: readFileSync(groupPath()) };
}
beforeEach(() => {
    vi.mocked(fs.renameSync).mockImplementation(nativeFs.renameSync);
    state.profile = mkdtempSync(nodePath.join(tmpdir(), 'owa-owner-migration-'));
    state.available = true;
});
afterEach(() => {
    vi.restoreAllMocks();
    rmSync(state.profile, { recursive: true, force: true });
});

it('automatically migrates an unambiguous manual owner, preserves originals, and never resurrects deleted notes', () => {
    const original = seed(legacy('alice'));
    const local = new AccountData(key('alice'), false);
    expect(local.recovery).toBeUndefined();
    expect(local.notes.get('same-event')).toBe('Original note');
    expect(local.groups.list(key('alice'))).toHaveLength(1);
    expect(local.groups.list(legacy('alice'))).toEqual([]);
    expect(readFileSync(notePath(legacy('alice')))).toEqual(original.note);
    const backups = readdirSync(nodePath.join(state.profile, 'account-migrations')).filter((file) =>
        file.endsWith('.groups.bin'),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(nodePath.join(state.profile, 'account-migrations', backups[0]))).toEqual(
        original.groups,
    );
    saveNotes(new NoteBook(), key('alice'));
    expect(new AccountData(key('alice'), false).notes.size).toBe(0);
    expect(readFileSync(notePath(legacy('alice')))).toEqual(original.note);
});

it.each([true, false])(
    'quarantines ambiguous records until assignment (SSO=%s), then prevents a second claim',
    (claimSso) => {
        const original = seed(legacy('windows'));
        const sso = new AccountData(key('', true), false);
        const manual = new AccountData(key('windows'), false);
        for (const local of [sso, manual]) {
            expect(local.recovery).toBe('available');
            expect(local.notes.size).toBe(0);
            expect(local.groups.list(key('windows'))).toEqual([]);
            expect(local.groups.list(key('', true))).toEqual([]);
        }
        expect(readFileSync(groupPath())).toEqual(original.groups);
        const claimed = claimSso ? sso : manual;
        const rejected = claimSso ? manual : sso;
        const claimedOwner = claimSso ? key('', true) : key('windows');
        const rejectedOwner = claimSso ? key('windows') : key('', true);
        claimed.recover();
        expect(claimed.notes.get('same-event')).toBe('Original note');
        expect(claimed.groups.list(claimedOwner)).toHaveLength(1);
        expect(() => rejected.recover()).toThrow(/Исходные данные сохранены/);
        const other = new AccountData(rejectedOwner, false);
        expect(other.recovery).toBeUndefined();
        expect(other.notes.size).toBe(0);
        expect(other.groups.list(rejectedOwner)).toEqual([]);
        expect(readFileSync(notePath(legacy('windows')))).toEqual(original.note);
    },
);

it('keeps current notes and preserves both groups when names and IDs conflict', () => {
    seed(legacy('windows'));
    const book = loadParticipantGroups();
    const old = book.list(legacy('windows'))[0];
    book.save(
        key('windows'),
        { name: old.name, emails: ['current@example.invalid'] },
        () => old.id,
    );
    saveParticipantGroups(book);
    const current = new NoteBook();
    current.set('same-event', 'Current note', now.toISOString(), now);
    saveNotes(current, key('windows'));
    const local = new AccountData(key('windows'), false);
    local.recover();
    expect(local.notes.get('same-event')).toBe('Current note');
    const groups = local.groups.list(key('windows'));
    expect(groups.map((group) => group.name)).toEqual(['Original team', 'Original team (2)']);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
    expect(loadNotes(legacy('windows'), now).get('same-event')).toBe('Original note');
});

it.each(['reservation', 'groups', 'notes', 'receipt'])(
    'resumes a failed %s write only for the reserved owner',
    (stage) => {
        const original = seed(legacy('windows'));
        const owner = key('', true);
        const local = new AccountData(owner, false);
        const real = nativeFs.renameSync;
        let receipts = 0;
        const rename = vi.mocked(fs.renameSync).mockImplementation((from, to) => {
            const target = String(to);
            if (target.includes('account-migrations') && !target.endsWith('.groups.bin'))
                receipts += 1;
            if (
                (stage === 'reservation' && receipts === 1) ||
                (stage === 'groups' && target === groupPath()) ||
                (stage === 'notes' && target === notePath(owner)) ||
                (stage === 'receipt' && receipts === 2)
            )
                throw new Error('Simulated write failure');
            return real(from, to);
        });
        expect(() => local.recover()).toThrow(/Исходные данные сохранены/);
        if (stage === 'reservation') {
            expect(readFileSync(groupPath())).toEqual(original.groups);
            expect(readFileSync(notePath(legacy('windows')))).toEqual(original.note);
            rename.mockRestore();
            local.recover();
            expect(local.notes.get('same-event')).toBe('Original note');
            return;
        }
        expect(() => local.assertWritable()).toThrow(/восстановление/);
        rename.mockRestore();
        const other = new AccountData(key('windows'), false);
        expect(other.notes.size).toBe(0);
        expect(other.groups.list(key('windows'))).toEqual([]);
        const recovered = new AccountData(owner, false);
        expect(recovered.recovery).toBeUndefined();
        expect(recovered.notes.get('same-event')).toBe('Original note');
        expect(recovered.groups.list(owner)).toHaveLength(1);
        expect(readFileSync(notePath(legacy('windows')))).toEqual(original.note);
        expect(() => recovered.assertWritable()).not.toThrow();
    },
);

it('does not reserve or alter data when encryption is unavailable', () => {
    const original = seed(legacy('windows'));
    const local = new AccountData(key('windows'), false);
    state.available = false;
    expect(() => local.recover()).toThrow(/Исходные данные сохранены/);
    expect(readFileSync(groupPath())).toEqual(original.groups);
    expect(readFileSync(notePath(legacy('windows')))).toEqual(original.note);
    state.available = true;
    local.recover();
    expect(local.notes.get('same-event')).toBe('Original note');
});

it('does not lose current data or reserve a destination when merging would exceed group limits', () => {
    const original = seed(legacy('windows'));
    const groups = loadParticipantGroups();
    for (let i = 0; i < 30; i++)
        groups.save(
            key('windows'),
            { name: `Team ${i}`, emails: ['x@example.invalid'] },
            randomUUID,
        );
    saveParticipantGroups(groups);
    const before = readFileSync(groupPath());
    const local = new AccountData(key('windows'), false);
    expect(() => local.recover()).toThrow();
    expect(() => local.assertWritable()).not.toThrow();
    expect(readFileSync(groupPath())).toEqual(before);
    expect(readFileSync(notePath(legacy('windows')))).toEqual(original.note);
});

it('keeps a corrupt journal fail-closed and never auto-imports legacy cache', () => {
    seed(legacy('windows'));
    const local = new AccountData(key('windows'), false);
    local.recover();
    const directory = nodePath.join(state.profile, 'account-migrations');
    const journal = readdirSync(directory).find((file) => !file.endsWith('.groups.bin'))!;
    writeFileSync(nodePath.join(directory, journal), 'corrupt');
    const failed = new AccountData(key('', true), false);
    expect(failed.recovery).toBe('retry');
    expect(() => failed.assertWritable()).toThrow();
    expect(failed.notes.size).toBe(0);
    const event: CalendarEvent = {
        id: 'private-legacy',
        title: 'Private legacy meeting',
        start: now.toISOString(),
        end: new Date(now.getTime() + 3_600_000).toISOString(),
        isAllDay: false,
        isCancelled: false,
        isOrganizer: false,
        isRecurring: false,
        categories: [],
        platform: 'generic',
        responseType: 'accepted',
    };
    saveEventCache([event], legacy('windows'));
    expect(loadEventCache(legacy('windows'))).toHaveLength(1);
    expect(loadEventCache(key('', true))).toEqual([]);
});

it('fails before copying notes when the old encrypted note file is unreadable', () => {
    seed(legacy('windows'));
    writeFileSync(notePath(legacy('windows')), 'broken original');
    const groups = readFileSync(groupPath());
    const local = new AccountData(key('windows'), false);
    expect(() => local.recover()).toThrow();
    expect(readFileSync(notePath(legacy('windows')), 'utf8')).toBe('broken original');
    expect(readFileSync(groupPath())).toEqual(groups);
});

it('preserves all notes when the combined books exceed the note limit', () => {
    seed(legacy('windows'));
    const current = new NoteBook();
    for (let i = 0; i < 500; i++) current.set(`current-${i}`, 'Retained', now.toISOString(), now);
    saveNotes(current, key('windows'));
    const before = readFileSync(notePath(key('windows')));
    const groups = readFileSync(groupPath());
    const local = new AccountData(key('windows'), false);
    expect(() => local.recover()).toThrow();
    expect(readFileSync(notePath(key('windows')))).toEqual(before);
    expect(readFileSync(groupPath())).toEqual(groups);
});

it('does not overwrite a truncated backup on retry or discard the original groups', () => {
    seed(legacy('windows'));
    const directory = nodePath.join(state.profile, 'account-migrations');
    const local = new AccountData(key('windows'), false);
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        if (String(to) === groupPath()) throw new Error('Interrupted write');
        return nativeFs.renameSync(from, to);
    });
    expect(() => local.recover()).toThrow();
    vi.mocked(fs.renameSync).mockImplementation(nativeFs.renameSync);
    const backup = readdirSync(directory).find((file) => file.endsWith('.groups.bin'))!;
    writeFileSync(nodePath.join(directory, backup), 'truncated');
    const before = readFileSync(groupPath());
    expect(() => local.recover()).toThrow();
    expect(readFileSync(groupPath())).toEqual(before);
    expect(readFileSync(nodePath.join(directory, backup), 'utf8')).toBe('truncated');
});
