import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { demoEvents } from '../src/main/demo';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { type FullSnapshotMessage, type SnapshotMessage } from '../src/shared/snapshotTypes';
import { type OwaApi, type Snapshot } from '../src/shared/types';

// This hook only has two state slots and an effect with []. Keep state across renders,
// commit the real subscription effect once, and execute its actual cleanup on unmount.
const hooks = vi.hoisted(() => {
    const values: unknown[] = [];
    let cursor = 0;
    let mounted = false;
    let updates = 0;
    let pending: (() => void | (() => void)) | undefined;
    let cleanup: (() => void) | undefined;
    return {
        state: <T>(initial: T): [T, (value: T) => void] => {
            const index = cursor;
            cursor += 1;
            if (index >= values.length) values.push(initial);
            return [
                values[index] as T,
                (value) => {
                    values[index] = value;
                    updates += 1;
                },
            ];
        },
        effect: (effect: () => void | (() => void)) => {
            if (!mounted) pending = effect;
        },
        render: <T>(render: () => T): T => {
            cursor = 0;
            const result = render();
            if (pending) {
                cleanup = pending() ?? undefined;
                pending = undefined;
                mounted = true;
            }
            return result;
        },
        unmount: () => {
            cleanup?.();
            cleanup = undefined;
        },
        updateCount: () => updates,
        reset: () => {
            values.length = 0;
            cursor = 0;
            mounted = false;
            updates = 0;
            pending = undefined;
            cleanup = undefined;
        },
    };
});
const wire = vi.hoisted(() => ({
    getSnapshot: vi.fn<OwaApi['getSnapshot']>(),
    subscribe: vi.fn<OwaApi['onSnapshot']>(),
    unsubscribe: vi.fn(),
    listener: undefined as ((value: Snapshot | SnapshotMessage) => void) | undefined,
}));
vi.mock('react', () => ({ useState: hooks.state, useEffect: hooks.effect, useMemo: vi.fn() }));
vi.mock('../src/renderer/api', () => ({
    api: { getSnapshot: wire.getSnapshot, onSnapshot: wire.subscribe },
}));

// Vitest loads the renderer module at runtime; its unrelated browser hooks do not add DOM
// globals to the Node TypeScript project that checks this test.
const { useSnapshot } = await vi.importActual<{
    useSnapshot: () => { snap: Snapshot | null; error: string | null };
}>('../src/renderer/hooks');

const deferred = () => {
    let resolve!: (value: Snapshot) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Snapshot>((fulfill, fail) => {
        resolve = fulfill;
        reject = fail;
    });
    return { promise, resolve, reject };
};
const full = (sequence = 1, eventsRevision = 1): FullSnapshotMessage => ({
    sequence,
    eventsRevision,
    events: [{ ...demoEvents()[0], title: 'SECRET_MEETING' }],
    sync: { phase: 'ok' },
    settings: structuredClone(DEFAULT_SETTINGS),
    demo: false,
    version: 'test',
    taskbarLight: false,
    logPath: '/test/log',
    noteIds: [],
    participantGroups: { account: 'account-a', groups: [] },
});
const delta = (value: FullSnapshotMessage): SnapshotMessage => {
    const next: SnapshotMessage = { ...value };
    delete next.events;
    return next;
};
const render = () => hooks.render(useSnapshot);
const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    return render();
};
const emit = (value: Snapshot | SnapshotMessage) => {
    expect(wire.listener).toBeTypeOf('function');
    wire.listener!(structuredClone(value));
};
beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    hooks.reset();
    wire.listener = undefined;
    wire.subscribe.mockImplementation((listener) => {
        wire.listener = listener;
        return () => {
            wire.unsubscribe();
            wire.listener = undefined;
        };
    });
});
afterEach(() => {
    hooks.unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('useSnapshot transport integration', () => {
    it('reuses the received calendar array when a sequenced delta updates state', async () => {
        wire.getSnapshot.mockResolvedValue(structuredClone(full()));
        expect(render()).toEqual({ snap: null, error: null });
        const first = await settle();
        expect(first.snap?.events[0].title).toBe('SECRET_MEETING');
        const update = delta(full(2));
        update.sync = { phase: 'syncing' };
        emit(update);
        const next = render();
        expect(next.snap?.events).toBe(first.snap?.events);
        expect(next.snap?.sync.phase).toBe('syncing');
        expect(wire.getSnapshot).toHaveBeenCalledTimes(1);
        expect(wire.subscribe).toHaveBeenCalledTimes(1);
    });

    it('keeps a newer private update when the initial public request resolves late', async () => {
        const initial = deferred();
        wire.getSnapshot.mockReturnValue(initial.promise);
        render();
        const masked = full(2, 2);
        masked.settings.privacyMode = true;
        masked.events = masked.events.map((event) => ({ ...event, title: 'Busy' }));
        emit(masked);
        const privateState = render();
        initial.resolve(structuredClone(full()));
        const afterLateInitial = await settle();
        expect(afterLateInitial.snap).toBe(privateState.snap);
        expect(afterLateInitial.snap?.settings.privacyMode).toBe(true);
        expect(JSON.stringify(afterLateInitial.snap)).not.toContain('SECRET_MEETING');
        expect(wire.getSnapshot).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
        'fetches a fresh full snapshot when a baseline is missing (initial resolved: %s)',
        async (initialResolved) => {
            const initial = deferred();
            const recovery = deferred();
            wire.getSnapshot
                .mockReturnValueOnce(initial.promise)
                .mockReturnValueOnce(recovery.promise);
            render();
            if (initialResolved) {
                initial.resolve(full());
                await settle();
            }
            emit(delta(full(3, 2)));
            expect(wire.getSnapshot).toHaveBeenCalledTimes(2);
            const replacement = full(4, 2);
            replacement.events = [];
            replacement.participantGroups.account = 'account-b';
            recovery.resolve(structuredClone(replacement));
            const recovered = await settle();
            expect(recovered.snap?.events).toEqual([]);
            expect(recovered.snap?.participantGroups.account).toBe('account-b');
            if (!initialResolved) {
                initial.resolve(full());
                expect((await settle()).snap).toBe(recovered.snap);
            }
        },
    );

    it.each(['resolve', 'reject'] as const)(
        'unsubscribes and ignores late callbacks and promise %s after cleanup',
        async (completion) => {
            const initial = deferred();
            wire.getSnapshot.mockReturnValue(initial.promise);
            render();
            const callback = wire.listener!;
            hooks.unmount();
            expect(wire.unsubscribe).toHaveBeenCalledTimes(1);
            expect(wire.listener).toBeUndefined();
            const updates = hooks.updateCount();
            callback(full(2));
            if (completion === 'resolve') initial.resolve(full());
            else initial.reject(new Error('Late disconnect'));
            await Promise.resolve();
            await Promise.resolve();
            expect(hooks.updateCount()).toBe(updates);
            expect(wire.getSnapshot).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('retries failures at the existing delays, reports exhaustion, and clears errors on update', async () => {
        wire.getSnapshot.mockRejectedValue(new Error('Snapshot unavailable'));
        render();
        expect((await settle()).error).toBeNull();
        await vi.advanceTimersByTimeAsync(399);
        expect(wire.getSnapshot).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(wire.getSnapshot).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(800);
        expect(wire.getSnapshot).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1200);
        expect(wire.getSnapshot).toHaveBeenCalledTimes(4);
        expect(render()).toEqual({ snap: null, error: 'Snapshot unavailable' });
        emit(full(5));
        expect(render().error).toBeNull();
        expect(render().snap?.events).toHaveLength(1);
    });

    it('continues accepting ordinary full snapshots from the browser demo API', async () => {
        const demo: Snapshot = full();
        delete (demo as Partial<FullSnapshotMessage>).sequence;
        delete (demo as Partial<FullSnapshotMessage>).eventsRevision;
        wire.getSnapshot.mockResolvedValue(demo);
        render();
        expect((await settle()).snap).toBe(demo);
        emit({ ...demo, events: [] });
        expect(render().snap?.events).toEqual([]);
    });
});
