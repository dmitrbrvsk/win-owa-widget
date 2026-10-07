// "Meeting statistics": how much time meetings take over a period and with whom it is spent.
// Pure, like the rest of src/shared — no Electron, no React — so every number below is testable.
// One pass per event plus one sort of the timed ones: no meeting is ever compared with every
// other, which is what keeps a period of a few thousand meetings instant.
import type { CalendarEvent, MeetingPlatform } from './types';
import { isEffectivelyCancelled } from './events';
import { weekStart } from './availability';
import { oneLine } from './text';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const STATS_PERIODS = ['thisWeek', 'lastWeek', 'last4Weeks'] as const;
export type StatsPeriodKind = (typeof STATS_PERIODS)[number];

/** One request covers the whole period, so the period is kept to what a single calendar view may carry. */
export const MAX_STATS_DAYS = 60;
/** A stranger's display name ends up in the ranking: one line, and no longer than a name is. */
export const MAX_PERSON_NAME = 120;

export interface StatsPeriod {
  kind: StatsPeriodKind;
  /** Local instants as ms since the epoch; the period is half-open, [start, end). */
  start: number;
  end: number;
}

const shiftDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/**
 * The three periods the window offers, as local midnights (built with the Date constructor, so a
 * week with a daylight-saving switch in it is 167 or 169 hours long, not "7 × 24").
 * "Last 4 weeks" is this week and the three before it.
 */
export function statsPeriod(kind: StatsPeriodKind, now: Date): StatsPeriod {
  const monday = weekStart(now);
  const nextMonday = shiftDays(monday, 7);
  if (kind === 'lastWeek') return { kind, start: shiftDays(monday, -7).getTime(), end: monday.getTime() };
  if (kind === 'last4Weeks') return { kind, start: shiftDays(monday, -21).getTime(), end: nextMonday.getTime() };
  return { kind, start: monday.getTime(), end: nextMonday.getTime() };
}

export interface StatsDay {
  /** Local midnight of the day. */
  date: number;
  weekend: boolean;
  /** Hours of timed meetings on this day: only the part inside both the day and the period. */
  hours: number;
  /** Timed meetings that touch this day. */
  meetings: number;
  /** All-day entries covering this day; they never add to `hours`. */
  allDay: number;
  /** Working hours this day contributes, from the settings; 0 on a weekend. */
  workHours: number;
}

export interface PersonStat {
  /** What the counting goes by: the organizer's address when the server gave one, else the name. */
  key: string;
  name: string;
  hours: number;
  meetings: number;
}

/** A meeting with no link anywhere is "none": it happens in a room, or nowhere in particular. */
export type StatsPlatform = MeetingPlatform | 'none';
export interface PlatformStat {
  platform: StatsPlatform;
  hours: number;
  meetings: number;
}

export type StatsResponse = 'accepted' | 'tentative' | 'organizer' | 'notResponded';
export interface ResponseStat {
  response: StatsResponse;
  hours: number;
  meetings: number;
}

export interface StatsWorkday {
  workdayStartHour: number;
  workdayEndHour: number;
}

export interface MeetingStats {
  period: StatsPeriod;
  /** Timed meetings counted; all-day entries are not meetings here (see `allDayMeetings`). */
  meetings: number;
  /** Hours summed per meeting: two meetings at the same time count twice, as the day bars do. */
  hours: number;
  /** Hours actually occupied: overlapping meetings are merged, so this is time, not workload. */
  busyHours: number;
  /** Working hours the period holds, from the settings and the weekdays in it. */
  workHours: number;
  /** Of `busyHours`, the part that falls inside working hours. */
  busyWorkHours: number;
  /** `busyWorkHours` / `workHours`; 0 when the period has no working hours at all. */
  shareOfWork: number;
  freeWorkHours: number;
  /** Average length of one counted meeting, in minutes; 0 when there are none. */
  avgMinutes: number;
  /** The day with the most meeting hours, or null when the period holds no meeting hours. */
  longestDay: StatsDay | null;
  /** Meetings that begin at the very moment another one ends. */
  backToBack: number;
  allDayMeetings: number;
  /** Day slots all-day entries cover (one entry over three days of the period counts three). */
  allDayDays: number;
  /**
   * The person's own meetings. They have no other organizer to credit, and the calendar view
   * carries no attendees, so they are counted here instead of in `people`.
   */
  ownMeetings: number;
  ownHours: number;
  days: StatsDay[];
  /** Most hours first; ties go by the number of meetings and then by name, so the order never wobbles. */
  people: PersonStat[];
  platforms: PlatformStat[];
  responses: ResponseStat[];
}

/** The part of [aStart, aEnd) that also lies in [bStart, bEnd), in milliseconds. */
const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/** The slice of one day that belongs to the period, and the working hours inside that slice. */
interface DayBounds {
  start: number;
  end: number;
  workStart: number;
  workEnd: number;
}

function buildDays(period: StatsPeriod, workday: StatsWorkday): { days: StatsDay[]; bounds: DayBounds[] } {
  const fromHour = Math.max(0, Math.min(23, Math.round(workday.workdayStartHour)));
  const toHour = Math.max(fromHour + 1, Math.min(24, Math.round(workday.workdayEndHour)));
  const days: StatsDay[] = [];
  const bounds: DayBounds[] = [];
  const first = new Date(period.start);
  let day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  // The period is capped before it gets here; the day count guards a broken one from looping on.
  while (day.getTime() < period.end && days.length < MAX_STATS_DAYS) {
    const next = shiftDays(day, 1);
    const weekday = day.getDay();
    const weekend = weekday === 0 || weekday === 6;
    const start = Math.max(day.getTime(), period.start);
    const end = Math.min(next.getTime(), period.end);
    const workStart = Math.max(start, new Date(day.getFullYear(), day.getMonth(), day.getDate(), fromHour).getTime());
    // A weekend is not working time: its window is empty, so meetings on it count as hours but not as "busy at work".
    const workEnd = weekend ? workStart : Math.max(workStart, Math.min(end, new Date(day.getFullYear(), day.getMonth(), day.getDate(), toHour).getTime()));
    days.push({ date: day.getTime(), weekend, hours: 0, meetings: 0, allDay: 0, workHours: (workEnd - workStart) / HOUR_MS });
    bounds.push({ start, end, workStart, workEnd });
    day = next;
  }
  return { days, bounds };
}

/** Index of the day whose slice holds `at`; the days are consecutive, so the guess is off by at most one. */
function dayAt(bounds: readonly DayBounds[], at: number): number {
  if (!bounds.length) return 0;
  let i = Math.floor((at - bounds[0].start) / DAY_MS);
  i = Math.max(0, Math.min(bounds.length - 1, i));
  while (i > 0 && bounds[i].start > at) i -= 1;
  while (i + 1 < bounds.length && bounds[i].end <= at) i += 1;
  return i;
}

const responseOf = (e: CalendarEvent): StatsResponse => {
  if (e.isOrganizer || e.responseType === 'organizer') return 'organizer';
  if (e.responseType === 'accepted') return 'accepted';
  if (e.responseType === 'tentative') return 'tentative';
  return 'notResponded';
};

/** Where the meeting happens: the platform of its link, or "none" when it has no link at all. */
const platformOf = (e: CalendarEvent): StatsPlatform => (e.joinUrl ? e.platform : 'none');

function bump<K, V extends { hours: number; meetings: number }>(map: Map<K, V>, key: K, make: () => V, hours: number) {
  const row = map.get(key) ?? make();
  row.hours += hours;
  row.meetings += 1;
  map.set(key, row);
}

/**
 * Everything the statistics window shows, from the meetings of one period.
 *
 * What is left out: meetings that are cancelled (by the flag or by Exchange's "Отменено:" prefix)
 * and ones the person declined — they took no time. A meeting id that repeats (a cached list and a
 * fresh answer can both hold it) is counted once. All-day entries count as days, never as hours, so
 * a week of duty does not read as 168 hours in meetings. A meeting that crosses midnight or sticks
 * out of the period contributes only its overlapping part, and to each day only that day's share.
 */
export function meetingStats(events: readonly CalendarEvent[], period: StatsPeriod, workday: StatsWorkday): MeetingStats {
  const { days, bounds } = buildDays(period, workday);
  const seen = new Set<string>();
  const people = new Map<string, PersonStat>();
  const platforms = new Map<StatsPlatform, PlatformStat>();
  const responses = new Map<StatsResponse, ResponseStat>();
  /** Clipped spans of the counted meetings, for the back-to-back count and the occupied time. */
  const spans: Array<{ start: number; end: number }> = [];
  let meetings = 0;
  let hours = 0;
  let allDayMeetings = 0;
  let allDayDays = 0;
  let ownMeetings = 0;
  let ownHours = 0;

  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (isEffectivelyCancelled(e) || e.responseType === 'declined') continue;
    const s = Date.parse(e.start);
    const f = Date.parse(e.end);
    if (Number.isNaN(s) || Number.isNaN(f) || f <= s) continue;
    const from = Math.max(s, period.start);
    const to = Math.min(f, period.end);
    if (to <= from) continue;

    if (e.isAllDay) {
      allDayMeetings += 1;
      for (let i = dayAt(bounds, from); i < bounds.length && bounds[i].start < to; i++) {
        if (overlapMs(from, to, bounds[i].start, bounds[i].end) > 0) {
          days[i].allDay += 1;
          allDayDays += 1;
        }
      }
      continue;
    }

    const h = (to - from) / HOUR_MS;
    meetings += 1;
    hours += h;
    spans.push({ start: from, end: to });
    for (let i = dayAt(bounds, from); i < bounds.length && bounds[i].start < to; i++) {
      const ms = overlapMs(from, to, bounds[i].start, bounds[i].end);
      if (ms > 0) {
        days[i].hours += ms / HOUR_MS;
        days[i].meetings += 1;
      }
    }

    const platform = platformOf(e);
    const response = responseOf(e);
    bump(platforms, platform, () => ({ platform, hours: 0, meetings: 0 }), h);
    bump(responses, response, () => ({ response, hours: 0, meetings: 0 }), h);

    // The calendar view carries the organizer, not the attendees: a meeting of the person's own has
    // nobody else to credit, so it is counted apart rather than credited to themselves.
    if (response === 'organizer') {
      ownMeetings += 1;
      ownHours += h;
    } else {
      const name = oneLine(e.organizer ?? '', MAX_PERSON_NAME);
      const key = e.organizerEmail ? e.organizerEmail.toLowerCase() : name.toLowerCase();
      if (key) bump(people, key, () => ({ key, name: name || key, hours: 0, meetings: 0 }), h);
    }
  }

  // Occupied time: the spans merged, so two meetings in the same hour do not spend it twice.
  spans.sort((a, b) => a.start - b.start);
  let busyHours = 0;
  let busyWorkHours = 0;
  let runStart = -1;
  let runEnd = -1;
  const closeRun = () => {
    if (runStart < 0) return;
    busyHours += (runEnd - runStart) / HOUR_MS;
    for (let i = dayAt(bounds, runStart); i < bounds.length && bounds[i].start < runEnd; i++) {
      busyWorkHours += overlapMs(runStart, runEnd, bounds[i].workStart, bounds[i].workEnd) / HOUR_MS;
    }
  };
  for (const span of spans) {
    if (runStart < 0 || span.start > runEnd) {
      closeRun();
      runStart = span.start;
      runEnd = span.end;
    } else if (span.end > runEnd) {
      runEnd = span.end;
    }
  }
  closeRun();

  // A meeting that begins the moment another ends. The ends are looked up in a set, so neither the
  // order of the list nor meetings that overlap can hide a pair.
  const ends = new Set(spans.map((t) => t.end));
  const backToBack = spans.reduce((n, t) => n + (ends.has(t.start) ? 1 : 0), 0);

  const workHours = days.reduce((a, d) => a + d.workHours, 0);
  const longest = days.reduce<StatsDay | null>((best, d) => (d.hours > 0 && (!best || d.hours > best.hours) ? d : best), null);

  return {
    period,
    meetings,
    hours,
    busyHours,
    workHours,
    busyWorkHours,
    // An empty period divides by nothing: the share is simply zero.
    shareOfWork: workHours > 0 ? Math.min(1, busyWorkHours / workHours) : 0,
    freeWorkHours: Math.max(0, workHours - busyWorkHours),
    avgMinutes: meetings > 0 ? (hours * 60) / meetings : 0,
    longestDay: longest,
    backToBack,
    allDayMeetings,
    allDayDays,
    ownMeetings,
    ownHours,
    days,
    people: [...people.values()].sort((a, b) => b.hours - a.hours || b.meetings - a.meetings || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    platforms: [...platforms.values()].sort((a, b) => b.hours - a.hours || b.meetings - a.meetings || (a.platform < b.platform ? -1 : 1)),
    responses: [...responses.values()].sort((a, b) => b.hours - a.hours || b.meetings - a.meetings || (a.response < b.response ? -1 : 1)),
  };
}
