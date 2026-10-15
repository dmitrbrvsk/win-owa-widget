import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CalendarService } from '../src/main/calendarService';
import {
    DEFAULT_SETTINGS,
    loadEventCache,
    saveEventCache,
    saveNotes,
    savePassword,
    saveSettings,
} from '../src/main/store';
import { NoteBook } from '../src/shared/notes';
import { participantGroupAccount } from '../src/shared/participantGroups';
import { type CalendarEvent } from '../src/shared/types';

const state = vi.hoisted(() => ({
    path: '',
    reads: 0,
    failure: 'first',
    clients: [] as Array<{ windows: boolean; hasPassword: boolean; hasUsername: boolean }>,
}));
const event: CalendarEvent = {
    id: 'same-id-in-both-mailboxes',
    title: 'Synthetic meeting',
    start: '2026-10-16T09:00:00.000Z',
    end: '2026-10-16T10:00:00.000Z',
    isAllDay: false,
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    isRecurring: false,
    categories: [],
    platform: 'generic',
};
vi.mock('electron', () => ({
    app: { getPath: () => state.path, isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(`ENC:${s}`),
        decryptString: (b: Buffer) => {
            const plain = b.toString().slice(4);
            if (plain.includes('"password":')) {
                state.reads += 1;
                if (
                    (state.failure === 'first' && state.reads === 1) ||
                    (state.failure === 'later' && state.reads >= 2)
                )
                    throw new Error('Temporary key failure');
            }
            return plain;
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
        constructor(options: { useWindowsAuth: boolean; username?: string; password?: string }) {
            state.clients.push({
                windows: options.useWindowsAuth,
                hasPassword: !!options.password,
                hasUsername: !!options.username,
            });
        }
        dispose() {
            this.disposed = true;
        }
        fetchCalendarView = async () => {
            if (this.disposed) throw new Error('Transport disposed');
            return [{ ...event }];
        };
    },
}));

const account = {
    ...DEFAULT_SETTINGS.account,
    serverUrl: 'mail.example',
    username: 'alice',
    hasPassword: true,
    useWindowsAuth: false,
};
const MANUAL = participantGroupAccount(account);
const WINDOWS = participantGroupAccount({ ...account, useWindowsAuth: true });
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T08:00:00Z'));
    state.path = mkdtempSync(nodePath.join(tmpdir(), 'owa-credential-mode-'));
    state.reads = 0;
    state.clients = [];
    savePassword('synthetic-password', 'mail.example');
    saveSettings({ ...structuredClone(DEFAULT_SETTINGS), account: { ...account } });
    for (const [owner, text] of [
        [MANUAL, 'Manual private note'],
        [WINDOWS, 'Windows private note'],
    ]) {
        const notes = new NoteBook();
        notes.set(event.id, text, event.start, new Date());
        saveNotes(notes, owner);
    }
});
afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    rmSync(state.path, { recursive: true, force: true });
});

it('keeps canonical Windows ownership if the secret becomes readable after settings load', async () => {
    state.failure = 'first';
    saveEventCache([event], WINDOWS);
    const service = new CalendarService(false);
    expect(state.reads).toBe(1);
    expect(service.settings.account.useWindowsAuth).toBe(true);
    expect(service.getNote(event.id)).toBe('Windows private note');
    service.start();
    await service.syncNow();
    expect(state.clients).toEqual([{ windows: true, hasPassword: false, hasUsername: false }]);
    expect(service.getNote(event.id)).toBe('Windows private note');
    expect(loadEventCache(WINDOWS)).toHaveLength(1);
    expect(loadEventCache(MANUAL)).toEqual([]);
});

it('fails closed under manual ownership if later secret reads fail, preserving the matching cache', async () => {
    state.failure = 'later';
    saveEventCache([event], MANUAL);
    const service = new CalendarService(false);
    expect(state.reads).toBe(1);
    expect(service.settings.account.useWindowsAuth).toBe(false);
    expect(service.getNote(event.id)).toBe('Manual private note');
    service.start();
    await service.syncNow();
    expect(state.reads).toBeGreaterThanOrEqual(2);
    expect(state.clients).toEqual([]);
    expect(service.sync.phase).toBe('error');
    expect(service.getNote(event.id)).toBe('Manual private note');
    expect(loadEventCache(MANUAL)).toHaveLength(1);
    expect(loadEventCache(WINDOWS)).toEqual([]);
});
