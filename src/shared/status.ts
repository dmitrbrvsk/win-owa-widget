// What the tray icon says. Port of MenuBarSmartStatusFormatter.swift: a countdown before a
// meeting, time left during one, otherwise just the calendar glyph.
import type { CalendarEvent } from './types';
import { activeMeetings, joinUrlForActions, minutesBetween, relevantTimed, startOf, startOfDay } from './events';

export const IMMINENT_MINUTES = 2;
export const SOON_MINUTES = 15;

export type TrayKind = 'overlap' | 'inMeeting' | 'imminent' | 'soon' | 'idle' | 'tomorrow' | 'later' | 'nothing';

export interface TrayPresentation {
  kind: TrayKind;
  /** Short text drawn on the icon, e.g. "12" or "1ч". */
  badge?: string;
  minutes?: number;
  days?: number;
  event?: CalendarEvent;
  count?: number;
  hasJoin: boolean;
}

export function compactMinutes(min: number, hourSuffix = 'ч'): string {
  if (min < 60) return String(min);
  return `${Math.floor(min / 60)}${hourSuffix}`;
}

export function trayPresentation(events: CalendarEvent[], now: Date): TrayPresentation {
  const active = activeMeetings(events, now);
  if (active.length > 1) {
    const left = minutesBetween(now, new Date(active[0].end));
    return { kind: 'overlap', badge: compactMinutes(left), minutes: left, event: active[0], count: active.length, hasJoin: active.some((e) => !!joinUrlForActions(e)) };
  }
  if (active.length === 1) {
    const left = minutesBetween(now, new Date(active[0].end));
    return { kind: 'inMeeting', badge: compactMinutes(left), minutes: left, event: active[0], hasJoin: !!joinUrlForActions(active[0]) };
  }

  const next = relevantTimed(events)
    .filter((e) => startOf(e) > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!next) return { kind: 'nothing', hasJoin: false };

  const until = minutesBetween(now, startOf(next));
  const hasJoin = !!joinUrlForActions(next);
  if (until <= IMMINENT_MINUTES) return { kind: 'imminent', badge: String(until), minutes: until, event: next, hasJoin };
  if (until <= SOON_MINUTES) return { kind: 'soon', badge: String(until), minutes: until, event: next, hasJoin };

  const days = Math.round((startOfDay(startOf(next)).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days <= 0) return { kind: 'idle', minutes: until, event: next, hasJoin };
  if (days === 1) return { kind: 'tomorrow', days, event: next, hasJoin };
  return { kind: 'later', days, event: next, hasJoin };
}
