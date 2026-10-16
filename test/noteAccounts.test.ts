import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { confirmAccountRecovery } from '../src/main/accountRecovery';
import { CalendarService } from '../src/main/calendarService';
import {
    DEFAULT_SETTINGS,
    loadParticipantGroups,
    saveNotes,
    saveParticipantGroups,
    savePassword,
    saveSettings,
} from '../src/main/store';
import { NoteBook } from '../src/shared/notes';
import { participantGroupAccount } from '../src/shared/participantGroups';
import { type CalendarEvent } from '../src/shared/types';

const state = vi.hoisted(() => ({ path: '' }));
vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(`ENC:${s}`),
        decryptString: (b: Buffer) => {
            if (!b.toString().startsWith('ENC:')) throw new Error('Cannot decrypt');
            return b.toString().slice(4);
        },
    },
}));
vi.mock('../src/main/log', () => ({
    log: { info: vi.fn(), warn: vi.fn() },
    describeError: () => 'redacted',
}));
vi.mock('../src/main/owa/client', () => ({
    OwaClient: class {
        private disposed = false;
        fetchCalendarView = async () => {
            if (this.disposed) throw new Error('Transport disposed');
            return [];
        };
        dispose = () => {
            this.disposed = true;
        };
    },
}));
const event: CalendarEvent = {
    id: 'same-title-2026-10-16T10:00:00.000Z',
    title: 'Same title in two accounts',
    start: new Date().toISOString(),
    end: new Date(Date.now() + 3_600_000).toISOString(),
    isAllDay: false,
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    isRecurring: false,
    categories: [],
    platform: 'generic',
};
beforeEach(() => {
    state.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-note-accounts-'));
    savePassword('synthetic-password', 'mail.example');
    saveSettings({
        ...structuredClone(DEFAULT_SETTINGS),
        account: {
            ...DEFAULT_SETTINGS.account,
            serverUrl: 'mail.example',
            username: 'alice',
            useWindowsAuth: false,
            hasPassword: true,
        },
    });
});
afterEach(() => rmSync(state.path, { recursive: true, force: true }));

async function switchUser(service: CalendarService, username: string) {
    await service.applySettings({
        settings: { ...service.settings, account: { ...service.settings.account, username } },
    });
    await service.syncNow();
    service.events = [{ ...event }];
}
it('isolates colliding meeting notes and note IDs across accounts and restores both', async () => {
    const service = new CalendarService(false);
    service.events = [{ ...event }];
    service.setNote(event.id, 'Alice private note');
    await switchUser(service, 'bob');
    expect(service.noteIds()).toEqual([]);
    expect(service.getNote(event.id)).toBe('');
    service.setNote(event.id, 'Bob private note');
    await switchUser(service, 'alice');
    expect(service.noteIds()).toEqual([event.id]);
    expect(service.getNote(event.id)).toBe('Alice private note');
    await switchUser(service, 'bob');
    expect(service.getNote(event.id)).toBe('Bob private note');
});

it('keeps manual-auth notes attached to the same account after restart', () => {
    const before = new CalendarService(false);
    expect(before.settings.account.useWindowsAuth).toBe(false);
    before.events = [{ ...event }];
    before.setNote(event.id, 'Alice restart note');
    const after = new CalendarService(false);
    expect(after.settings.account.useWindowsAuth).toBe(false);
    after.events = [{ ...event }];
    expect(after.getNote(event.id)).toBe('Alice restart note');
    expect(after.noteIds()).toEqual([event.id]);
});
it('preserves unassigned legacy notes without exposing their IDs or changing them on clear', () => {
    const legacy = new NoteBook();
    legacy.set(event.id, 'Unassigned private note', event.start, new Date());
    const path = nodePath.join(state.path, 'notes.bin');
    const original = Buffer.from(`ENC:${JSON.stringify(legacy)}`);
    writeFileSync(path, original);
    const service = new CalendarService(false);
    service.events = [{ ...event }];
    expect(service.hasUnassignedNotes()).toBe(true);
    expect(service.noteIds()).toEqual([]);
    expect(service.getNote(event.id)).toBe('');
    service.setNote(event.id, 'New assigned note');
    expect(service.clearNotes()).toBe(1);
    expect(service.getNote(event.id)).toBe('');
    expect(readdirSync(nodePath.join(state.path, 'notes'))).toEqual([]);
    expect(readFileSync(path)).toEqual(original);
    expect(service.hasUnassignedNotes()).toBe(true);
    expect(new CalendarService(true).hasUnassignedNotes()).toBe(false);
});
it('clears only the current account while preserving another account with the same meeting ID', async () => {
    const service = new CalendarService(false);
    service.events = [{ ...event }];
    service.setNote(event.id, 'Alice retained note');
    await switchUser(service, 'bob');
    service.setNote(event.id, 'Bob cleared note');
    expect(service.clearNotes()).toBe(1);
    await switchUser(service, 'alice');
    expect(service.getNote(event.id)).toBe('Alice retained note');
    await switchUser(service, 'bob');
    expect(service.noteIds()).toEqual([]);
    expect(service.getNote(event.id)).toBe('');
});

it('keeps SSO groups and notes separate from a manual windows login through switching and restart', async () => {
    const manual = new CalendarService(false);
    await switchUser(manual, 'windows');
    manual.setNote(event.id, 'Manual private');
    manual.saveParticipantGroup(manual.participantGroupState().account, {
        name: 'Manual team',
        emails: ['manual@example.invalid'],
    });
    const manualOwner = manual.participantGroupState().account;
    await manual.applySettings({
        settings: {
            ...manual.settings,
            account: { ...manual.settings.account, username: '', useWindowsAuth: true },
        },
    });
    await manual.syncNow();
    manual.events = [{ ...event }];
    expect(manual.noteIds()).toEqual([]);
    expect(manual.participantGroupState().groups).toEqual([]);
    manual.setNote(event.id, 'SSO private');
    manual.saveParticipantGroup(manual.participantGroupState().account, {
        name: 'SSO team',
        emails: ['sso@example.invalid'],
    });
    expect(participantGroupAccount(manual.settings.account)).not.toBe(manualOwner);
    await manual.applySettings({
        settings: {
            ...manual.settings,
            account: { ...manual.settings.account, username: 'windows', useWindowsAuth: false },
        },
    });
    await manual.syncNow();
    manual.events = [{ ...event }];
    expect(manual.getNote(event.id)).toBe('Manual private');
    expect(manual.participantGroupState().groups.map((group) => group.name)).toEqual([
        'Manual team',
    ]);
    const restarted = new CalendarService(false);
    restarted.events = [{ ...event }];
    expect(restarted.getNote(event.id)).toBe('Manual private');
    expect(restarted.participantGroupState().groups.map((group) => group.name)).toEqual([
        'Manual team',
    ]);
});

it('requires native approval for old windows data and keeps it inaccessible to the other mode', async () => {
    const account = {
        ...DEFAULT_SETTINGS.account,
        serverUrl: 'mail.example',
        username: '',
        useWindowsAuth: true,
    };
    saveSettings({ ...structuredClone(DEFAULT_SETTINGS), account });
    const owner = JSON.stringify(['mail.example', 'windows']);
    const notes = new NoteBook();
    notes.set(event.id, 'Preserved SSO note', event.start, new Date());
    saveNotes(notes, owner);
    const groups = loadParticipantGroups();
    groups.save(
        owner,
        { name: 'Preserved SSO team', emails: ['private@example.invalid'] },
        randomUUID,
    );
    saveParticipantGroups(groups);
    const service = new CalendarService(false);
    service.events = [{ ...event }];
    const newOwner = service.participantGroupState().account;
    expect(service.accountRecovery).toBe('available');
    expect(service.getNote(event.id)).toBe('');
    expect(service.participantGroupState().groups).toEqual([]);
    expect(() => service.recoverAccountData('forged', service.accountRevision)).toThrow();
    expect(() => service.recoverAccountData(newOwner, service.accountRevision + 1)).toThrow();
    await confirmAccountRecovery(service, newOwner, async () => 0);
    expect(service.getNote(event.id)).toBe('');
    await confirmAccountRecovery(service, newOwner, async () => 1);
    expect(service.getNote(event.id)).toBe('Preserved SSO note');
    const groupId = service.participantGroupState().groups[0].id;
    await switchUser(service, 'windows');
    expect(service.settings.account.useWindowsAuth).toBe(false);
    expect(service.getNote(event.id)).toBe('');
    expect(service.participantGroupState().groups).toEqual([]);
    expect(() =>
        service.deleteParticipantGroup(service.participantGroupState().account, groupId),
    ).toThrow();
    expect(service.accountRecovery).toBeUndefined();
});
