import { isEffectivelyCancelled } from './events';
import { type CalendarEvent } from './types';

/** Explicit whitelist: new fields on an Exchange event cannot silently become visible. */
export function privateEvent(event: CalendarEvent, language: 'ru' | 'en' = 'ru'): CalendarEvent {
    return {
        id: event.id,
        ...(event.accountId ? { accountId: event.accountId } : {}),
        ...(event.accountColor ? { accountColor: event.accountColor } : {}),
        title: language === 'en' ? 'Busy' : 'Занято',
        start: event.start,
        end: event.end,
        isAllDay: event.isAllDay,
        platform: 'generic',
        isCancelled: isEffectivelyCancelled(event),
        isOrganizer: false,
        responseType: event.responseType,
        categories: [],
        isRecurring: false,
    };
}
