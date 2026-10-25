import { describe, expect, it } from 'vitest';

import {
    busySpans,
    freeWindows,
    longStretch,
    nextFreeWindow,
    spanMinutes,
    workdaySpan,
} from '../src/shared/freeTime';
import { type CalendarEvent } from '../src/shared/types';

// The tests run in Europe/Moscow (see globalSetup): wall-clock times below are Moscow times.
const day = new Date(2026, 9, 26); // Monday
const at = (hhmm: string, d = day) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
};
let n = 0;
function ev(s: string, e: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
    n += 1;
    return {
        id: `e${n}`,
        title: `Встреча ${n}`,
        start: at(s).toISOString(),
        end: at(e).toISOString(),
        isAllDay: false,
        platform: 'generic',
        isCancelled: false,
        isOrganizer: false,
        responseType: 'accepted',
        categories: [],
        isRecurring: false,
        ...extra,
    };
}
const hm = (t: number) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const show = (spans: Array<{ start: number; end: number }>) =>
    spans.map((s) => `${hm(s.start)}–${hm(s.end)}`);
const work = { startHour: 9, endHour: 19 };

describe('free windows', () => {
    const events = [
        ev('09:30', '10:00'),
        ev('10:00', '11:00'),
        ev('12:00', '12:20'),
        ev('12:40', '13:00'),
        ev('15:00', '16:00', { responseType: 'notResponded' }),
        ev('16:00', '16:30', { responseType: 'declined' }),
        ev('17:00', '18:00', { isCancelled: true }),
    ];

    it('gaps of 30 minutes or more inside the working hours, on a day ahead', () => {
        const before = at('07:00', new Date(2026, 9, 25));
        // 09:00–09:30 is exactly 30 minutes: it counts; 12:20–12:40 is 20: it does not.
        expect(show(freeWindows(events, day, work, before))).toEqual([
            '09:00–09:30',
            '11:00–12:00',
            '13:00–15:00',
            '16:00–19:00',
        ]);
        expect(show(freeWindows(events, day, work, before, 45))).toEqual([
            '11:00–12:00',
            '13:00–15:00',
            '16:00–19:00',
        ]);
        expect(show(freeWindows([ev('09:30', '10:00')], day, work, before))).toEqual([
            '09:00–09:30',
            '10:00–19:00',
        ]);
    });

    it('an unanswered invitation is busy (Exchange shows it as tentative); declined and cancelled ones are free', () => {
        const before = at('07:00', new Date(2026, 9, 25));
        const spans = show(busySpans(events, day));
        expect(spans).toContain('15:00–16:00');
        expect(spans).not.toContain('16:00–16:30');
        expect(spans.some((s) => s.startsWith('17:00'))).toBe(false);
        expect(show(freeWindows(events, day, work, before)).at(-1)).toBe('16:00–19:00');
    });

    it('today counts from now, rounded up to five minutes; a finished day has none', () => {
        expect(show(freeWindows(events, day, work, at('11:12')))).toEqual([
            '11:15–12:00',
            '13:00–15:00',
            '16:00–19:00',
        ]);
        expect(show(freeWindows(events, day, work, at('11:40')))).toEqual([
            '13:00–15:00',
            '16:00–19:00',
        ]);
        expect(freeWindows(events, day, work, at('19:00'))).toEqual([]);
        expect(freeWindows(events, day, work, at('09:00', new Date(2026, 9, 27)))).toEqual([]);
        expect(show([nextFreeWindow(events, at('13:30'), work)!])).toEqual(['13:30–15:00']);
    });

    it('overlapping and all-day meetings', () => {
        const before = at('07:00', new Date(2026, 9, 25));
        const overlap = [
            ev('10:00', '12:00'),
            ev('11:00', '13:00'),
            ev('12:30', '12:45'),
            { ...ev('00:00', '23:59'), isAllDay: true },
        ];
        expect(show(busySpans(overlap, day))).toEqual(['10:00–13:00']);
        expect(show(freeWindows(overlap, day, work, before))).toEqual([
            '09:00–10:00',
            '13:00–19:00',
        ]);
        expect(show(freeWindows([], day, work, before))).toEqual(['09:00–19:00']);
    });

    it('a meeting from the night before or into the next day is clipped to the day', () => {
        const before = at('07:00', new Date(2026, 9, 25));
        const night = {
            ...ev('09:00', '10:00'),
            start: at('22:00', new Date(2026, 9, 25)).toISOString(),
        };
        expect(show(freeWindows([night], day, work, before))).toEqual(['10:00–19:00']);
    });

    it('working hours on a day when the clocks change still begin and end on the wall clock', () => {
        const s = workdaySpan(new Date(2026, 2, 29), { startHour: 9, endHour: 18 });
        expect(new Date(s.start).getHours()).toBe(9);
        expect(new Date(s.end).getHours()).toBe(18);
        expect(
            workdaySpan(day, { startHour: 0, endHour: 24 }).end -
                workdaySpan(day, { startHour: 0, endHour: 24 }).start,
        ).toBe(24 * 3_600_000);
    });
});

describe('long runs of meetings', () => {
    it('three hours with breaks under ten minutes is one run', () => {
        const run = [
            ev('10:00', '11:00'),
            ev('11:05', '12:00'),
            ev('12:00', '13:15'),
            ev('15:00', '16:00'),
        ];
        const s = longStretch(run, day, at('08:00'));
        expect(s && show([s])).toEqual(['10:00–13:15']);
        expect(s && spanMinutes(s)).toBe(195);
    });

    it('a real break splits it; a short run or one already over is not reported', () => {
        expect(
            longStretch(
                [ev('10:00', '11:00'), ev('11:15', '12:30'), ev('12:30', '13:30')],
                day,
                at('08:00'),
            ),
        ).toBeUndefined();
        expect(
            longStretch([ev('10:00', '12:00'), ev('12:00', '12:59')], day, at('08:00')),
        ).toBeUndefined();
        expect(longStretch([ev('09:00', '12:30')], day, at('12:31'))).toBeUndefined();
        expect(longStretch([ev('09:00', '12:30')], day, at('12:00'))).toBeDefined();
    });

    it('declined meetings are not part of a run', () => {
        expect(
            longStretch(
                [
                    ev('10:00', '11:30'),
                    ev('11:30', '12:00', { responseType: 'declined' }),
                    ev('12:00', '13:30'),
                ],
                day,
                at('08:00'),
            ),
        ).toBeUndefined();
    });
});
