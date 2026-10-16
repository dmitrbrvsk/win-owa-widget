import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAvailabilityGrid, useAvailabilityGridScroll } from '../src/renderer/availabilityGrid';
import { type CalendarEvent } from '../src/shared/types';

// Execute the production hooks with React's dependency comparison and a commit phase. The
// Node test environment has no DOM; scrollLeft is the only browser operation in these hooks.
const hooks = vi.hoisted(() => {
    const entries: Array<{ deps: readonly unknown[]; value: unknown }> = [];
    const pending: Array<() => void> = [];
    let cursor = 0;
    const memo = <T>(create: () => T, deps: readonly unknown[]): T => {
        const index = cursor;
        cursor += 1;
        const previous = entries[index];
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i])))
            return previous.value as T;
        const value = create();
        entries[index] = { deps, value };
        return value;
    };
    return {
        memo,
        effect: (effect: () => void, deps: readonly unknown[]) => {
            memo(() => pending.push(effect), deps);
        },
        render: <T>(render: () => T): T => {
            cursor = 0;
            const result = render();
            for (const effect of pending.splice(0)) effect();
            return result;
        },
        reset: () => {
            entries.length = 0;
            pending.length = 0;
            cursor = 0;
        },
    };
});
vi.mock('react', () => ({ useMemo: hooks.memo, useEffect: hooks.effect }));

type GridInput = Parameters<typeof useAvailabilityGrid>[0];
const originalTZ = process.env.TZ;
const scroller = { current: { scrollLeft: 0 } };
let input: GridInput;
beforeEach(() => {
    process.env.TZ = 'Europe/Moscow';
    hooks.reset();
    scroller.current.scrollLeft = 0;
    input = {
        result: null,
        events: [],
        windowStart: new Date(2026, 9, 5).getTime(),
        windowEnd: new Date(2026, 9, 12).getTime(),
        now: new Date(2026, 9, 7, 10),
        workdayStartHour: 8,
        workdayEndHour: 20,
        showWeekends: false,
    };
});
afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
});

const render = () =>
    hooks.render(() => {
        const model = useAvailabilityGrid(input);
        useAvailabilityGridScroll(scroller, model.grid, model.today, 14);
        return model;
    });
const initialLeft = (model: ReturnType<typeof render>) => {
    const day = model.grid.days.find((d) => d.date === model.today);
    return day ? Math.max(0, day.first * 14 - 28) : 0;
};

describe('availability model and initial scrolling', () => {
    it('keeps the model and manual scroll on minute ticks and visibility refreshes', () => {
        const first = render();
        expect(scroller.current.scrollLeft).toBe(initialLeft(first));
        scroller.current.scrollLeft = 777;
        input = { ...input, now: new Date(2026, 9, 7, 10, 1) };
        expect(render().grid).toBe(first.grid);
        expect(scroller.current.scrollLeft).toBe(777);
        input = { ...input, now: new Date(2026, 9, 7, 16, 34) };
        expect(render().grid).toBe(first.grid);
        expect(scroller.current.scrollLeft).toBe(777);
    });

    it('updates calendar cells without moving a manually scrolled grid', () => {
        const first = render();
        scroller.current.scrollLeft = 777;
        const event: CalendarEvent = {
            id: 'meeting',
            changeKey: 'updated',
            title: 'Updated meeting',
            start: new Date(2026, 9, 7, 10).toISOString(),
            end: new Date(2026, 9, 7, 11).toISOString(),
            isAllDay: false,
            platform: 'generic',
            isCancelled: false,
            isOrganizer: false,
            responseType: 'accepted',
            categories: [],
            isRecurring: false,
        };
        input = { ...input, events: [event] };
        const updated = render();
        expect(updated.grid).not.toBe(first.grid);
        const slot = updated.grid.slots.findIndex((s) => s.start === Date.parse(event.start));
        expect(updated.grid.people[0].cells[slot]).toBe('busy');
        expect(scroller.current.scrollLeft).toBe(777);
    });

    it('accepts refreshed availability data without resetting scroll', () => {
        render();
        scroller.current.scrollLeft = 777;
        input = {
            ...input,
            result: {
                start: new Date(input.windowStart).toISOString(),
                end: new Date(input.windowEnd).toISOString(),
                slotMinutes: 30,
                people: [{ email: 'colleague@example.com', digits: '2'.repeat(336) }],
            },
        };
        const refreshed = render();
        expect(refreshed.grid.people[1].cells.every((cell) => cell === 'busy')).toBe(true);
        expect(scroller.current.scrollLeft).toBe(777);
        input = { ...input, result: { ...input.result!, people: [...input.result!.people] } };
        render();
        expect(scroller.current.scrollLeft).toBe(777);
    });

    it('repositions on local midnight and updates calendar coverage boundaries', () => {
        input = {
            ...input,
            now: new Date(2026, 9, 7, 23, 59),
            windowStart: new Date(2026, 8, 28).getTime(),
            windowEnd: new Date(2026, 9, 5).getTime(),
        };
        const first = render();
        const slot = first.grid.slots.findIndex(
            (s) => s.start === new Date(2026, 8, 30, 8).getTime(),
        );
        expect(first.grid.people[0].cells[slot]).toBe('free');
        scroller.current.scrollLeft = 777;
        input = { ...input, now: new Date(2026, 9, 8) };
        const next = render();
        expect(next.today).toBe(new Date(2026, 9, 8).getTime());
        expect(next.grid.people[0].cells[slot]).toBe('nodata');
        expect(scroller.current.scrollLeft).toBe(0);
    });

    it('moves to the new today column when midnight falls inside the displayed week', () => {
        input = { ...input, now: new Date(2026, 9, 7, 23, 59) };
        const first = render();
        scroller.current.scrollLeft = 777;
        input = { ...input, now: new Date(2026, 9, 8) };
        const next = render();
        expect(initialLeft(next)).toBeGreaterThan(initialLeft(first));
        expect(scroller.current.scrollLeft).toBe(initialLeft(next));
    });

    it('starts a newly selected week at today or at its first column', () => {
        render();
        scroller.current.scrollLeft = 777;
        input = {
            ...input,
            windowStart: new Date(2026, 9, 12).getTime(),
            windowEnd: new Date(2026, 9, 19).getTime(),
        };
        expect(initialLeft(render())).toBe(0);
        expect(scroller.current.scrollLeft).toBe(0);
        input = {
            ...input,
            windowStart: new Date(2026, 9, 5).getTime(),
            windowEnd: new Date(2026, 9, 12).getTime(),
        };
        const current = render();
        expect(scroller.current.scrollLeft).toBe(initialLeft(current));
        expect(scroller.current.scrollLeft).toBeGreaterThan(0);
    });

    it.each([{ workdayEndHour: 18 }, { showWeekends: true }])(
        'repositions when visible column geometry changes: %j',
        (settings) => {
            render();
            scroller.current.scrollLeft = 777;
            input = { ...input, ...settings };
            const changed = render();
            expect(scroller.current.scrollLeft).toBe(initialLeft(changed));
        },
    );

    it('retains one local day across a daylight-saving clock change', () => {
        process.env.TZ = 'Europe/Berlin';
        input = { ...input, now: new Date('2026-10-25T00:30:00Z') };
        const first = render();
        scroller.current.scrollLeft = 777;
        input = { ...input, now: new Date('2026-10-25T02:30:00Z') };
        const afterClockChange = render();
        expect(afterClockChange.today).toBe(first.today);
        expect(afterClockChange.grid).toBe(first.grid);
        expect(scroller.current.scrollLeft).toBe(777);
    });

    it('detects a runtime zone change even when both zones share today’s midnight', () => {
        process.env.TZ = 'Europe/London';
        input = {
            ...input,
            now: new Date('2026-10-21T12:00:00Z'),
            windowStart: Date.parse('2026-10-26T00:00:00Z'),
            windowEnd: Date.parse('2026-11-02T00:00:00Z'),
        };
        const london = render();
        process.env.TZ = 'Africa/Lagos';
        const lagos = render();
        expect(lagos.today).toBe(london.today);
        expect(lagos.grid.slots[0].start).not.toBe(london.grid.slots[0].start);
    });

    it('recomputes today when the runtime zone changes without a new clock value', () => {
        input = { ...input, now: new Date('2026-10-07T21:30:00Z') };
        expect(render().today).toBe(Date.parse('2026-10-07T21:00:00Z'));
        scroller.current.scrollLeft = 777;
        process.env.TZ = 'Europe/London';
        const london = render();
        expect(london.today).toBe(Date.parse('2026-10-06T23:00:00Z'));
        expect(scroller.current.scrollLeft).toBe(initialLeft(london));
    });
});
