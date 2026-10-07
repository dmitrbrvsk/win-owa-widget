// Small rules about meetings shared by the tray status, reminders and the UI.
import type { CalendarEvent } from './types';

const CANCEL_PREFIXES = ['отменено:', 'cancelled:', 'canceled:'];

export const startOf = (e: CalendarEvent) => new Date(e.start);
export const endOf = (e: CalendarEvent) => new Date(e.end);

export function isEffectivelyCancelled(e: CalendarEvent): boolean {
  if (e.isCancelled) return true;
  const t = e.title.trim().toLowerCase();
  return CANCEL_PREFIXES.some((p) => t.startsWith(p));
}

/** Subject without Exchange's "Canceled:" prefix; the UI strikes the title through instead. */
export function displayTitle(e: CalendarEvent): string {
  const trimmed = e.title.trim();
  const lower = trimmed.toLowerCase();
  for (const p of CANCEL_PREFIXES) {
    if (lower.startsWith(p)) {
      const rest = trimmed.slice(p.length).trim();
      return rest || trimmed;
    }
  }
  return trimmed;
}

/** Link for Join / Copy; cancelled meetings hide actions even if a link remains. */
export function joinUrlForActions(e: CalendarEvent): string | undefined {
  return isEffectivelyCancelled(e) ? undefined : e.joinUrl;
}

/** An invitation someone else sent that is still waiting for my answer. */
export function isAwaitingResponse(e: CalendarEvent, now: Date): boolean {
  return (
    !!e.changeKey &&
    !e.isOrganizer &&
    e.responseType === 'notResponded' &&
    !isEffectivelyCancelled(e) &&
    endOf(e) > now
  );
}

export function pendingInvitations(events: CalendarEvent[], now: Date): CalendarEvent[] {
  return events.filter((e) => isAwaitingResponse(e, now)).sort((a, b) => a.start.localeCompare(b.start));
}

/** Timed meetings that matter for status, reminders and join. */
export function relevantTimed(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => !e.isAllDay && !isEffectivelyCancelled(e) && e.responseType !== 'declined');
}

/** Meetings running now, soonest-ending first. */
export function activeMeetings(events: CalendarEvent[], now: Date): CalendarEvent[] {
  return relevantTimed(events)
    .filter((e) => startOf(e) <= now && endOf(e) > now)
    .sort((a, b) => a.end.localeCompare(b.end));
}

/** Next meetings that start at the earliest upcoming start time (several may start together). */
export function nextMeetingGroup(events: CalendarEvent[], now: Date): CalendarEvent[] {
  const upcoming = relevantTimed(events)
    .filter((e) => startOf(e) > now)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!upcoming.length) return [];
  const first = startOf(upcoming[0]).getTime();
  return upcoming.filter((e) => startOf(e).getTime() === first);
}

/**
 * The meeting a "Join" hotkey or banner should act on: one in progress with a link, otherwise
 * one starting within the next `leadMinutes` with a link.
 */
export function joinCandidates(events: CalendarEvent[], now: Date, leadMinutes = 10): CalendarEvent[] {
  const withLink = relevantTimed(events).filter((e) => joinUrlForActions(e));
  const active = withLink.filter((e) => startOf(e) <= now && endOf(e) > now);
  const soon = withLink.filter((e) => {
    const diff = startOf(e).getTime() - now.getTime();
    return diff > 0 && diff <= leadMinutes * 60_000;
  });
  return [...soon, ...active].sort((a, b) => a.start.localeCompare(b.start));
}

export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return events.filter((e) => startOf(e) < dayEnd && endOf(e) > dayStart);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 60_000));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
