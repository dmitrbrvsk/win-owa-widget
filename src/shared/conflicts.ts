// Which meetings of mine a given time collides with. Pure arithmetic over the list the widget already
// holds: nothing is asked of the server and nothing is sent.
import type { CalendarEvent } from './types';
import { isEffectivelyCancelled, isEngaged } from './events';

/** At most this many collisions are listed; the rest is a count. */
export const MAX_CONFLICTS_SHOWN = 4;

/**
 * Meetings the person is going to (accepted, maybe, or their own) that overlap the span [start, end).
 * An all-day entry, a cancelled one, a declined one and an unanswered invitation do not block the time.
 * Meetings that merely touch (one ends when the other starts) do not collide.
 */
export function conflictsInRange(start: Date, end: Date, events: CalendarEvent[], exceptId?: string): CalendarEvent[] {
  const from = start.getTime();
  const to = end.getTime();
  if (!(to > from)) return [];
  return events
    .filter((e) => {
      if (e.id === exceptId || e.isAllDay || isEffectivelyCancelled(e) || !isEngaged(e)) return false;
      return Date.parse(e.start) < to && Date.parse(e.end) > from;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The collisions of one meeting with the rest of the calendar. */
export function conflictsOf(target: CalendarEvent, events: CalendarEvent[]): CalendarEvent[] {
  if (target.isAllDay || isEffectivelyCancelled(target)) return [];
  return conflictsInRange(new Date(target.start), new Date(target.end), events, target.id);
}

/** Whether `other` can be declined from here: someone else's meeting that still takes an answer. */
export function canDecline(other: CalendarEvent): boolean {
  return !!other.changeKey && !other.isOrganizer && other.responseType !== 'declined' && !isEffectivelyCancelled(other);
}
