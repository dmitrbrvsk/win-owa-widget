import { startOfDay } from './events';
import { type CalendarEvent, type CalendarSelection } from './types';
import { parseId } from './validate';

export function calendarDateValue(day: Date): string {
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function checkedDay(raw: unknown): string {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
        throw new Error('Недопустимый день календаря');
    const [year, month, day] = raw.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        year < 1970 ||
        year > 2200 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    )
        throw new Error('Недопустимый день календаря');
    return raw;
}

export function dateOfCalendarDay(raw: string): Date {
    const [year, month, day] = checkedDay(raw).split('-').map(Number);
    return new Date(year, month - 1, day);
}

/** Only a date and an opaque event id cross the window boundary, never meeting contents or links. */
export function parseCalendarSelection(raw: unknown): CalendarSelection {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Недопустимый выбор в календаре');
    const value = raw as Record<string, unknown>;
    return {
        day: value.day === undefined ? undefined : checkedDay(value.day),
        eventId: value.eventId === undefined ? undefined : parseId(value.eventId),
    };
}

/** A meeting may have moved since the popup opened: its current start decides which day to show. */
export function calendarView(
    selection: CalendarSelection | null,
    events: readonly CalendarEvent[],
    now: Date,
): { day: Date; eventId: string | null } {
    const event = selection?.eventId ? events.find((e) => e.id === selection.eventId) : undefined;
    let day = startOfDay(now);
    if (event) day = startOfDay(new Date(event.start));
    else if (selection?.day) day = dateOfCalendarDay(selection.day);
    return {
        day,
        eventId: event?.id ?? null,
    };
}
