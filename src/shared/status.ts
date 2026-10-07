// What the tray icon says. Port of MenuBarSmartStatusFormatter.swift: a countdown before a
// meeting, time left during one, otherwise just the calendar glyph.
import type { CalendarEvent } from './types';
import { activeMeetings, isEngaged, joinUrlForActions, minutesBetween, pendingInvitations, relevantTimed, startOf, startOfDay } from './events';

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
  /** Invitations still waiting for an answer: the same ones the popup lists under "Новые приглашения". */
  invites: number;
  /**
   * Epoch ms when the pulse ends (the start of the meeting). Present only while the icon should
   * pulse: the last IMMINENT_MINUTES before a meeting the person is going to.
   */
  pulseUntil?: number;
}

export function compactMinutes(min: number, hourSuffix = 'ч'): string {
  if (min < 60) return String(min);
  return `${Math.floor(min / 60)}${hourSuffix}`;
}

export function trayPresentation(events: CalendarEvent[], now: Date): TrayPresentation {
  return { ...meetingStatus(events, now), invites: pendingInvitations(events, now).length };
}

function meetingStatus(events: CalendarEvent[], now: Date): Omit<TrayPresentation, 'invites'> {
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
  if (until <= IMMINENT_MINUTES) {
    // Pulse only for a meeting the person said yes to (or runs), with or without a link: someone
    // who ignores an invitation is not nudged, and an in-person meeting needs the nudge as much.
    const together = relevantTimed(events).filter((e) => startOf(e).getTime() === startOf(next).getTime());
    const pulseUntil = together.some(isEngaged) ? startOf(next).getTime() : undefined;
    return { kind: 'imminent', badge: String(until), minutes: until, event: next, hasJoin, pulseUntil };
  }
  if (until <= SOON_MINUTES) return { kind: 'soon', badge: String(until), minutes: until, event: next, hasJoin };

  const days = Math.round((startOfDay(startOf(next)).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days <= 0) return { kind: 'idle', minutes: until, event: next, hasJoin };
  if (days === 1) return { kind: 'tomorrow', days, event: next, hasJoin };
  return { kind: 'later', days, event: next, hasJoin };
}

/** Windows shows at most 127 characters of a tray tooltip (the main process cuts there). */
export const TRAY_TOOLTIP_MAX = 127;

/**
 * Tooltip text: `build(title)` followed by the `tail` lines. A long meeting title is shortened (with
 * "…") first, so the lines after it, such as the number of new invitations, are never cut off.
 */
export function composeTooltip(build: (title: string) => string, title: string, tail: Array<string | undefined>, max = TRAY_TOOLTIP_MAX): string {
  const extra = tail.filter((l): l is string => !!l).join('\n');
  const rest = extra ? `\n${extra}` : '';
  const room = max - rest.length - build('').length;
  const shown = title.length <= room ? title : room > 1 ? `${clipUnits(title, room - 1).trimEnd()}…` : '';
  return build(shown) + rest;
}

/** Cuts to at most `units` UTF-16 units without splitting a surrogate pair. */
function clipUnits(s: string, units: number): string {
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > units) break;
    out += ch;
  }
  return out;
}
