// Free time inside the working day, and long runs of meetings with no break: computed from the
// meetings already loaded, on this computer, without asking the server anything.
import { relevantTimed } from './events';
import { type Workday } from './timeline';
import { type CalendarEvent } from './types';

/** A gap shorter than this is not "free time": it is the walk to the next room. */
export const MIN_FREE_MINUTES = 30;
/** Meetings closer together than this are one stretch: ten minutes is not a break. */
export const BREAK_MINUTES = 10;
/** A stretch of meetings at least this long gets a warning. */
export const LONG_STRETCH_MINUTES = 180;

/** Epoch milliseconds, end exclusive. */
export interface Span {
    start: number;
    end: number;
}

const MIN = 60_000;

function dayBounds(day: Date): { start: number; end: number } {
    return {
        start: new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(),
        end: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime(),
    };
}

/** The working hours of `day` as instants (local wall clock, so a DST switch day is handled). */
export function workdaySpan(day: Date, workday: Workday): Span {
    const start = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        Math.max(0, Math.min(23, workday.startHour)),
    ).getTime();
    const endHour = Math.max(1, Math.min(24, workday.endHour));
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), endHour).getTime();
    return { start, end: Math.max(start, end) };
}

/**
 * The time taken on `day`, merged into non-overlapping spans. Busy is what Exchange itself counts
 * as busy: meetings accepted, tentative or not answered yet (an unanswered invitation shows as
 * "tentative" to everyone else). Declined and cancelled meetings and all-day events take no time.
 */
export function busySpans(events: CalendarEvent[], day: Date, gapMinutes = 0): Span[] {
    const { start: d0, end: d1 } = dayBounds(day);
    const spans = relevantTimed(events)
        .map((e) => ({
            start: Math.max(Date.parse(e.start), d0),
            end: Math.min(Date.parse(e.end), d1),
        }))
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
        .toSorted((a, b) => a.start - b.start);
    const out: Span[] = [];
    for (const s of spans) {
        const last = out.at(-1);
        if (last && s.start <= last.end + gapMinutes * MIN) last.end = Math.max(last.end, s.end);
        else out.push({ ...s });
    }
    return out;
}

/** Rounds up to the next five minutes: "free from 14:55", not "from 14:52:17". */
function ceil5(t: number): number {
    const step = 5 * MIN;
    return Math.ceil(t / step) * step;
}

/**
 * Gaps of at least `minMinutes` between meetings, inside the working hours of `day`. On today only
 * what is still ahead counts; a day that is over has none.
 */
export function freeWindows(
    events: CalendarEvent[],
    day: Date,
    workday: Workday,
    now: Date,
    minMinutes = MIN_FREE_MINUTES,
): Span[] {
    const work = workdaySpan(day, workday);
    const from = Math.max(work.start, ceil5(now.getTime()));
    if (from >= work.end) return [];
    const out: Span[] = [];
    let cursor = from;
    for (const b of busySpans(events, day)) {
        if (b.end <= cursor) continue;
        if (b.start >= work.end) break;
        if (b.start - cursor >= minMinutes * MIN) out.push({ start: cursor, end: b.start });
        cursor = Math.max(cursor, b.end);
    }
    if (work.end - cursor >= minMinutes * MIN) out.push({ start: cursor, end: work.end });
    return out;
}

/** The first free window still ahead today, or undefined when the working day has none left. */
export function nextFreeWindow(
    events: CalendarEvent[],
    now: Date,
    workday: Workday,
): Span | undefined {
    return freeWindows(events, now, workday, now)[0];
}

/**
 * The longest run of meetings on `day` with no break of `BREAK_MINUTES` or more, when it lasts at
 * least `LONG_STRETCH_MINUTES`. On today a run that is already over is not reported.
 */
export function longStretch(events: CalendarEvent[], day: Date, now: Date): Span | undefined {
    let best: Span | undefined;
    for (const s of busySpans(events, day, BREAK_MINUTES)) {
        if (s.end <= now.getTime()) continue;
        if (s.end - s.start < LONG_STRETCH_MINUTES * MIN) continue;
        if (!best || s.end - s.start > best.end - best.start) best = s;
    }
    return best;
}

/** Whole minutes in a span. */
export function spanMinutes(s: Span): number {
    return Math.round((s.end - s.start) / MIN);
}
