// Date, time and recipient logic of the "Create meeting" form, kept apart from React so it is tested.
// The form holds local wall-clock text ("2026-10-07", "10:00"); the instants sent to the main
// process are made here, in the zone of this machine, the same zone the calendar is shown in.
import type { CalendarEvent, PersonSuggestion } from './types';
import { emailKey } from './email';

export interface Slot {
  /** `YYYY-MM-DD`, local. The meeting starts on this date. */
  date: string;
  /** `HH:MM`, local. */
  start: string;
  /** `HH:MM`, local. Earlier than `start` means the meeting ends on the next day. */
  end: string;
  /** Minutes the person last chose or got by editing the end: the end follows the start by this much. */
  duration: number;
}

export const DEFAULT_DURATION = 30;
export const QUICK_DURATIONS = [30, 45, 60] as const;
const DAY = 1440;

const pad = (n: number) => String(n).padStart(2, '0');

export const dateText = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeText = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A local date and time from the two texts, or null when either is missing or not a real moment. */
export function localDate(date: string, time: string, addDays = 0): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, day, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  const base = new Date(y, mo - 1, day);
  // "February 31" would silently become March 3: a date that does not exist is refused instead.
  if (base.getFullYear() !== y || base.getMonth() !== mo - 1 || base.getDate() !== day || h > 23 || mi > 59) return null;
  return new Date(y, mo - 1, day + addDays, h, mi);
}

/** Start and end as instants. An end before the start is on the next day; an end equal to the start is not a meeting. */
export function slotRange(slot: Pick<Slot, 'date' | 'start' | 'end'>): { start: Date; end: Date } | null {
  const start = localDate(slot.date, slot.start);
  const sameDay = localDate(slot.date, slot.end);
  if (!start || !sameDay) return null;
  if (sameDay > start) return { start, end: sameDay };
  const nextDay = localDate(slot.date, slot.end, 1);
  return nextDay && sameDay < start && nextDay > start ? { start, end: nextDay } : null;
}

export function slotMinutes(slot: Pick<Slot, 'date' | 'start' | 'end'>): number | null {
  const r = slotRange(slot);
  return r ? Math.round((r.end.getTime() - r.start.getTime()) / 60_000) : null;
}

/** True when the meeting ends on a later date than it starts. */
export function endsNextDay(slot: Pick<Slot, 'date' | 'start' | 'end'>): boolean {
  const r = slotRange(slot);
  return !!r && dateText(r.end) !== dateText(r.start);
}

/** `time` moved by `minutes`, wrapping around midnight ("23:30" + 60 → "00:30"). */
export function shiftTime(time: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const total = (((+m[1] * 60 + +m[2] + minutes) % DAY) + DAY) % DAY;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The first half hour after `now`; late in the evening, tomorrow at 09:00. */
export function defaultSlot(now: Date): Slot {
  const next = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30;
  if (next >= DAY) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { date: dateText(tomorrow), start: '09:00', end: shiftTime('09:00', DEFAULT_DURATION), duration: DEFAULT_DURATION };
  }
  const start = `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
  return { date: dateText(now), start, end: shiftTime(start, DEFAULT_DURATION), duration: DEFAULT_DURATION };
}

/** The slot a prefill describes (ISO instants); what it leaves out comes from the next free half hour. */
export function slotFromPrefill(prefill: { start?: string; end?: string }, now: Date): Slot {
  const start = prefill.start ? new Date(prefill.start) : null;
  if (!start || Number.isNaN(start.getTime())) return defaultSlot(now);
  const end = prefill.end ? new Date(prefill.end) : null;
  const minutes = end && !Number.isNaN(end.getTime()) ? Math.round((end.getTime() - start.getTime()) / 60_000) : DEFAULT_DURATION;
  // The form shows one date: a meeting of a day or more is shortened to fit, a reversed one gets the default.
  const duration = minutes > 0 ? Math.min(minutes, DAY - 1) : DEFAULT_DURATION;
  const startText = timeText(start);
  return { date: dateText(start), start: startText, end: shiftTime(startText, duration), duration };
}

/** The start moves and the end follows, keeping the length the person had. */
export function withStart(slot: Slot, start: string): Slot {
  const length = slotMinutes(slot) ?? slot.duration;
  return { ...slot, start, end: shiftTime(start, length) };
}

/** The end is set by hand: the length becomes whatever it now is. */
export function withEnd(slot: Slot, end: string): Slot {
  const next = { ...slot, end };
  return { ...next, duration: slotMinutes(next) ?? slot.duration };
}

export function withDuration(slot: Slot, minutes: number): Slot {
  return { ...slot, end: shiftTime(slot.start, minutes), duration: minutes };
}

// ---------- Recipients ----------

/** Organizers of the meetings already loaded, most frequent first: people this person works with. */
export function localPeople(events: readonly CalendarEvent[]): PersonSuggestion[] {
  const seen = new Map<string, { person: PersonSuggestion; count: number }>();
  for (const e of events) {
    if (!e.organizerEmail) continue;
    const key = emailKey(e.organizerEmail);
    const known = seen.get(key);
    if (known) known.count++;
    else seen.set(key, { person: { name: e.organizer || e.organizerEmail, email: e.organizerEmail }, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name)).map((x) => x.person);
}

/** The people whose name or address contains the typed text, minus the ones already added. */
export function matchPeople(list: readonly PersonSuggestion[], query: string, exclude: ReadonlySet<string>, max: number): PersonSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: PersonSuggestion[] = [];
  for (const p of list) {
    if (exclude.has(emailKey(p.email)) || !`${p.name} ${p.email}`.toLowerCase().includes(q)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/** Meetings seen first, then the directory; one entry per address; at most `max`. */
export function mergeSuggestions(local: readonly PersonSuggestion[], remote: readonly PersonSuggestion[], exclude: ReadonlySet<string>, max = 8): PersonSuggestion[] {
  const seen = new Set(exclude);
  const out: PersonSuggestion[] = [];
  for (const p of [...local, ...remote]) {
    const key = emailKey(p.email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
