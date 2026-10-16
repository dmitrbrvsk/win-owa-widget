import { describe, expect, it } from 'vitest';

import { demoEvents } from '../src/main/demo';
import { type FullSnapshotMessage } from '../src/shared/snapshotTypes';

import { ipcHarness } from './ipcSecurityHarness';

describe('main snapshot transport wiring', () => {
    it('reuses the calendar during sync status changes and sends an empty replacement on clear', async () => {
        const h = ipcHarness(true);
        h.service.events = demoEvents();
        const first = await h.call<FullSnapshotMessage>('getSnapshot');
        h.service.sync = { phase: 'syncing' };
        const update = h.snapshotUpdate();
        expect(update.events).toBeUndefined();
        expect(update.eventsRevision).toBe(first.eventsRevision);
        expect(update.sync.phase).toBe('syncing');
        h.service.events = [];
        expect(h.snapshotUpdate().events).toEqual([]);
    });

    it('publishes optimistic RSVP changes immediately, including in demo mode', async () => {
        const h = ipcHarness(true);
        h.service.events = demoEvents();
        const event = h.service.events[0];
        const before = await h.call<FullSnapshotMessage>('getSnapshot');
        await h.call('respond', event.id, 'decline');
        const update = h.snapshotUpdate();
        expect(update.eventsRevision).toBeGreaterThan(before.eventsRevision);
        expect(update.events?.find((item) => item.id === event.id)?.responseType).toBe('declined');
        expect(before.events.find((item) => item.id === event.id)?.responseType).toBe(
            event.responseType,
        );
    });

    it('never sends the public projection when entering privacy or changing its language', async () => {
        const h = ipcHarness(true);
        h.service.events = demoEvents().map((event) => ({ ...event, title: 'SECRET_MEETING' }));
        h.service.settings.language = 'en';
        await h.call('getSnapshot');
        await h.call('setPrivacyMode', true);
        const masked = h.snapshotUpdate();
        expect(masked.events?.[0].title).toBe('Busy');
        expect(JSON.stringify(masked)).not.toContain('SECRET_MEETING');
        h.service.settings.language = 'ru';
        expect(h.snapshotUpdate().events?.[0].title).toBe('Занято');
        await h.call('setPrivacyMode', false);
        expect(h.snapshotUpdate().events?.[0].title).toBe('SECRET_MEETING');
    });

    it('sends a full update for a new account even if a source array is temporarily identical', async () => {
        const h = ipcHarness(true);
        h.service.events = demoEvents();
        const first = await h.call<FullSnapshotMessage>('getSnapshot');
        h.service.settings.account = { ...h.service.settings.account, username: 'another-account' };
        const update = h.snapshotUpdate();
        expect(update.events).toHaveLength(first.events.length);
        expect(update.eventsRevision).toBeGreaterThan(first.eventsRevision);
    });
});
