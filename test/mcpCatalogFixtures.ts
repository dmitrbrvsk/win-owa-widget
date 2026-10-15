import { type McpCalendarView } from '../src/main/mcp/catalog';
import { type CalendarEvent } from '../src/shared/types';

export const ACCESS = { enabled: true, allowTitles: false };
export const TITLES = { enabled: true, allowTitles: true };
export const RANGE = { start: '2026-10-16T00:00:00Z', end: '2026-10-17T00:00:00Z' };
export const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

export function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
        id: 'PRIVATE-EXCHANGE-ID',
        title: 'Planning',
        start: '2026-10-16T09:00:00Z',
        end: '2026-10-16T10:00:00Z',
        isAllDay: false,
        platform: 'teams',
        isCancelled: false,
        isOrganizer: false,
        responseType: 'accepted',
        categories: [],
        isRecurring: false,
        ...patch,
    };
}

export function view(patch: Partial<McpCalendarView> = {}): McpCalendarView {
    return {
        account: 'PRIVATE-ACCOUNT',
        revision: 1,
        events: [event()],
        privacyMode: false,
        sync: { phase: 'ok', lastSuccess: '2026-10-16T10:00:00+03:00' },
        version: '1.4.4',
        demo: false,
        ...patch,
    };
}

export function firstId(payload: Record<string, unknown>): string {
    if (!Array.isArray(payload.meetings)) throw new Error('Missing meetings');
    const first: unknown = payload.meetings[0];
    if (!first || typeof first !== 'object' || !('id' in first) || typeof first.id !== 'string')
        throw new Error('Missing opaque id');
    return first.id;
}
