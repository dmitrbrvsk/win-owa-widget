import { describe, expect, it } from 'vitest';

import { demoEvents } from '../src/main/demo';
import { SnapshotReceiver } from '../src/shared/snapshotReceiver';
import { SnapshotPublisher } from '../src/shared/snapshotTransport';
import { type CalendarEvent, type Snapshot } from '../src/shared/types';

const base = demoEvents()[0];
const events: CalendarEvent[] = Array.from({ length: 3000 }, (_, i) => ({
    ...base,
    id: `event-${i}`,
    title: `Meeting ${i}`,
    start: '2026-10-16T09:00:00Z',
    end: '2026-10-16T09:30:00Z',
    platform: 'generic',
    bodyPreview: 'A'.repeat(300),
}));
const state = { sync: { phase: 'ok' }, settings: { privacyMode: false } } as Omit<
    Snapshot,
    'events'
>;
const source = (scope = 'account-a|public|en') => ({ state, events, scope, project: () => events });
const wire = <T>(value: T): T => structuredClone(value);

describe('incremental calendar snapshots', () => {
    it('sends no calendar on sync-only updates and preserves the renderer array', () => {
        const publisher = new SnapshotPublisher();
        const renderer = new SnapshotReceiver();
        const first = renderer.accept(wire(publisher.capture(source())));
        expect(first?.events).toHaveLength(3000);
        const update = publisher.capture({
            ...source(),
            state: { ...state, sync: { phase: 'syncing' } },
        });
        expect(update).not.toHaveProperty('events');
        expect(JSON.stringify(update).length).toBeLessThan(500);
        const next = renderer.accept(wire(update));
        expect(next?.events).toBe(first?.events);
        expect(next?.sync.phase).toBe('syncing');
    });

    it.each(['account-b|public|en', 'account-a|private|en', 'account-a|private|ru'])(
        'replaces the full calendar for scope %s even with the same source array',
        (scope) => {
            const publisher = new SnapshotPublisher();
            const renderer = new SnapshotReceiver();
            const first = renderer.accept(wire(publisher.capture(source())));
            const safe = events.map((event) => ({ ...event, title: 'Busy', bodyPreview: '' }));
            const message = publisher.capture({ ...source(scope), project: () => safe });
            expect(message.events).toBe(safe);
            const next = renderer.accept(wire(message));
            expect(next?.events).not.toBe(first?.events);
            expect(next?.events[0].title).toBe('Busy');
        },
    );

    it('sends a full calendar after edits and explicit initial reads', () => {
        const publisher = new SnapshotPublisher();
        publisher.capture(source());
        expect(publisher.capture(source(), true).events).toHaveLength(3000);
        expect(publisher.capture({ ...source(), events: [], project: () => [] }).events).toEqual(
            [],
        );
    });

    it('never combines a delta from another calendar with a cached array', () => {
        const publisher = new SnapshotPublisher();
        const renderer = new SnapshotReceiver();
        renderer.accept(wire(publisher.capture(source())));
        publisher.capture(source('account-b|public|en')); // Deliberately missed full update.
        expect(
            renderer.accept(wire(publisher.capture(source('account-b|public|en')))),
        ).toBeUndefined();
        expect(renderer.current).toBeUndefined();
        const fresh = renderer.accept(wire(publisher.capture(source('account-b|public|en'), true)));
        expect(fresh?.events).toHaveLength(3000);
    });

    it('ignores late initial responses after a newer private update', () => {
        const publisher = new SnapshotPublisher();
        const renderer = new SnapshotReceiver();
        const delayed = wire(publisher.capture(source(), true));
        const masked = events.map((event) => ({ ...event, title: 'Busy', bodyPreview: '' }));
        const current = renderer.accept(
            wire(publisher.capture({ ...source('private'), project: () => masked })),
        );
        expect(renderer.accept(delayed)).toBeUndefined();
        expect(renderer.current).toBe(current);
        expect(renderer.current?.events[0].title).toBe('Busy');
    });
});
