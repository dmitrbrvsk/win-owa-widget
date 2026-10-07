// Free time search: the week grid (people x 30-minute slots) and the "best options" ranking.
// Pure functions shared by the window and the tests; every loop is bounded by the slot and people
// counts, which the main process caps (20 people, a window of at most 14 days).
import type { AvailabilityEvent, AvailabilityStatus, CalendarEvent, PersonAvailability } from './types';
import { displayTitle, isEffectivelyCancelled } from './events';
import { oneLine } from './text';

export const SLOT_MINUTES = 30;
const SLOT_MS = SLOT_MINUTES * 60_000;
const DAY_MS = 86_400_000;

export const MAX_PEOPLE = 20;
/** A week at 30 minutes is 336 characters; this is the most a server answer may carry per person. */
export const MAX_DIGITS = 20_000;
export const MAX_RANGE_DAYS = 14;
export const MAX_EVENTS_PER_PERSON = 500;
export const MAX_SUBJECT = 120;
export const DURATIONS = [30, 45, 60, 90] as const;
export type MeetingDuration = (typeof DURATIONS)[number];

/** The cached calendar covers this much around today (see syncRange in calendarService): beyond it "me" is unknown, not free. */
export const LOCAL_DAYS_BACK = 7;
export const LOCAL_DAYS_AHEAD = 30;

/** Lunch is avoided, slightly: the hour in which most people eat. */
export const LUNCH = { startMin: 12 * 60, endMin: 13 * 60 };

// ---------- Digits ----------

const STATUSES: readonly AvailabilityStatus[] = ['free', 'tentative', 'busy', 'oof', 'nodata'];

/** Exchange's MergedFreeBusy digits: 0 free, 1 tentative, 2 busy, 3 out of office, 4 no data. Anything else is no data. */
export function statusOfDigit(c: string | undefined): AvailabilityStatus {
  if (c === undefined || c.length !== 1) return 'nodata';
  const i = c.charCodeAt(0) - 48;
  return i >= 0 && i < STATUSES.length ? STATUSES[i] : 'nodata';
}

export function digitOfStatus(s: AvailabilityStatus): string {
  return String(STATUSES.indexOf(s));
}

// ---------- Weeks ----------

/** Monday 00:00 (local) of the week that contains `d`. */
export function weekStart(d: Date): Date {
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** The week as a request window: Monday 00:00 up to the next Monday 00:00 (a DST week is 167 or 169 hours long). */
export function weekWindow(d: Date): { start: Date; end: Date } {
  const start = weekStart(d);
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
}

/** Number of characters a window carries at the slot length. */
export function slotCount(windowStart: number, windowEnd: number, slotMinutes = SLOT_MINUTES): number {
  const n = Math.ceil((windowEnd - windowStart) / (slotMinutes * 60_000));
  const most = Math.ceil((MAX_RANGE_DAYS * 24 * 60) / slotMinutes) + 2; // two extra for the hour a DST switch adds
  return Number.isFinite(n) ? Math.max(0, Math.min(n, most)) : 0;
}

// ---------- The grid ----------

export interface GridSlot {
  /** Local start and end, ms since the epoch. */
  start: number;
  end: number;
  /** Position of this slot's character in the digit strings of the answer. */
  digit: number;
  /** Index into `days`. */
  day: number;
}

export interface GridDay {
  /** Local midnight, ms. */
  date: number;
  weekend: boolean;
  /** The slots of this day are `slots[first .. first + count)`. */
  first: number;
  count: number;
}

export interface GridPerson {
  email: string;
  self: boolean;
  failed: boolean;
  /** One status per slot of the grid. */
  cells: AvailabilityStatus[];
  /** The subject of the meeting that makes the slot busy, when the server told. */
  notes: Array<string | undefined>;
}

export interface AvailabilityGrid {
  windowStart: number;
  windowEnd: number;
  slotMinutes: number;
  slots: GridSlot[];
  days: GridDay[];
  people: GridPerson[];
}

export interface GridPersonInput extends PersonAvailability {
  self?: boolean;
}

export interface GridOptions {
  /** Hours the grid shows (the workday): 0–23 and 1–24, start before end. */
  workdayStartHour: number;
  workdayEndHour: number;
  /** Saturday and Sunday are left out unless asked for. */
  showWeekends: boolean;
}

const rank = (s: AvailabilityStatus) => ({ free: 0, tentative: 1, busy: 2, oof: 3, nodata: 4 })[s];

/**
 * The subject to show for each character of the answer: of the meetings that cover it, the one
 * that decides its status (the highest-ranking one) and has a subject.
 */
function subjectsByDigit(events: readonly AvailabilityEvent[] | undefined, windowStart: number, n: number, slotMs: number): Array<string | undefined> {
  const out: Array<string | undefined> = new Array(n);
  if (!events) return out;
  const best: number[] = new Array(n).fill(-1);
  for (const e of events.slice(0, MAX_EVENTS_PER_PERSON)) {
    if (!e.subject || e.status === 'free' || e.status === 'nodata') continue;
    const s = Date.parse(e.start);
    const f = Date.parse(e.end);
    if (Number.isNaN(s) || Number.isNaN(f) || f <= s) continue;
    const from = Math.max(0, Math.floor((s - windowStart) / slotMs));
    const to = Math.min(n, Math.ceil((f - windowStart) / slotMs));
    const r = rank(e.status);
    for (let i = from; i < to; i++) {
      if (r > best[i]) {
        best[i] = r;
        out[i] = e.subject;
      }
    }
  }
  return out;
}

/**
 * The slots of the window that fall in the workday (and on a weekday, unless weekends are shown),
 * grouped by day, and each person's status in each of them.
 */
export function buildGrid(windowStart: number, windowEnd: number, people: readonly GridPersonInput[], opts: GridOptions, slotMinutes = SLOT_MINUTES): AvailabilityGrid {
  const slotMs = slotMinutes * 60_000;
  const n = slotCount(windowStart, windowEnd, slotMinutes);
  const fromMin = Math.max(0, Math.min(23, Math.round(opts.workdayStartHour))) * 60;
  const toMin = Math.max(fromMin + 60, Math.min(24, Math.round(opts.workdayEndHour)) * 60);

  const slots: GridSlot[] = [];
  const days: GridDay[] = [];
  for (let i = 0; i < n; i++) {
    const start = windowStart + i * slotMs;
    const d = new Date(start);
    const weekday = d.getDay();
    const weekend = weekday === 0 || weekday === 6;
    if (weekend && !opts.showWeekends) continue;
    const minutes = d.getHours() * 60 + d.getMinutes();
    if (minutes < fromMin || minutes >= toMin) continue;
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let day = days.length - 1;
    if (day < 0 || days[day].date !== midnight) {
      days.push({ date: midnight, weekend, first: slots.length, count: 0 });
      day = days.length - 1;
    }
    days[day].count += 1;
    slots.push({ start, end: start + slotMs, digit: i, day });
  }

  const grid: GridPerson[] = people.map((p) => {
    const subjects = subjectsByDigit(p.events, windowStart, n, slotMs);
    const failed = p.failed === true;
    const cells = slots.map((s) => (failed ? 'nodata' : statusOfDigit(p.digits[s.digit])));
    const notes = slots.map((s, k) => (cells[k] === 'free' || cells[k] === 'nodata' ? undefined : subjects[s.digit]));
    return { email: p.email, self: p.self === true, failed, cells, notes };
  });
  return { windowStart, windowEnd, slotMinutes, slots, days, people: grid };
}

// ---------- Best options ----------

export interface TimeOption {
  /** Start and end as ms since the epoch; the end is the start plus the wanted duration. */
  start: number;
  end: number;
  /** "free": nobody is busy or unsure. "tentative": nobody is busy, but somebody has it as tentative. */
  kind: 'free' | 'tentative';
  /** People (their addresses) with a tentative meeting in the way. */
  tentative: string[];
  /** People the server had no data for in this time: they do not block the option, but it is less certain. */
  unknown: string[];
  score: number;
}

const MAX_PER_DAY = 2;

/**
 * Start times at which nobody is busy or out of office for `durationMinutes`, best first.
 *
 * - Everyone free scores highest; tentative meetings of some people cost 20 points plus 5 per person.
 * - People without data do not block, but cost 10 points each (up to 30), and the option says so.
 * - Earlier is better (a point per six hours, up to 25), a start on the hour is slightly better
 *   than on the half hour, and a meeting over lunch (12:00-13:00) loses up to 10 points.
 * - Weekends (only when the grid shows them) lose 40 points.
 * - Starts in the past are never offered; a slot already begun is not offered either.
 * - The list holds distinct, non-overlapping times, at most two per day while other days have some.
 *
 * Linear in slots x people: every person's blocked/tentative/unknown slots are summed up once.
 */
export function bestOptions(grid: AvailabilityGrid, durationMinutes: number, now: Date, limit = 5): TimeOption[] {
  const { slots, people } = grid;
  const need = Math.max(1, Math.ceil(durationMinutes / grid.slotMinutes));
  if (limit <= 0 || !people.length || slots.length < need) return [];

  // prefix[k][i]: how many of the first i slots are blocking / tentative / without data for person k.
  const blocked: Int32Array[] = [];
  const tentative: Int32Array[] = [];
  const unknown: Int32Array[] = [];
  for (const p of people) {
    const b = new Int32Array(slots.length + 1);
    const t = new Int32Array(slots.length + 1);
    const u = new Int32Array(slots.length + 1);
    for (let i = 0; i < slots.length; i++) {
      const c = p.cells[i];
      b[i + 1] = b[i] + (c === 'busy' || c === 'oof' ? 1 : 0);
      t[i + 1] = t[i] + (c === 'tentative' ? 1 : 0);
      u[i + 1] = u[i] + (c === 'nodata' ? 1 : 0);
    }
    blocked.push(b);
    tentative.push(t);
    unknown.push(u);
  }

  // run[i]: how many slots in a row, without a gap, begin at slot i (a meeting cannot jump over the night).
  const run = new Int32Array(slots.length + 1);
  for (let i = slots.length - 1; i >= 0; i--) {
    run[i] = i + 1 < slots.length && slots[i + 1].start === slots[i].end && slots[i + 1].day === slots[i].day ? run[i + 1] + 1 : 1;
  }

  const nowMs = now.getTime();
  const candidates: TimeOption[] = [];
  const dayOf: number[] = [];
  for (let s = 0; s + need <= slots.length; s++) {
    if (run[s] < need || slots[s].start < nowMs) continue;
    let ok = true;
    const tent: string[] = [];
    const unk: string[] = [];
    for (let k = 0; k < people.length && ok; k++) {
      if (blocked[k][s + need] - blocked[k][s] > 0) ok = false;
      else {
        if (tentative[k][s + need] - tentative[k][s] > 0) tent.push(people[k].email);
        if (unknown[k][s + need] - unknown[k][s] > 0) unk.push(people[k].email);
      }
    }
    // Nobody's calendar could be read: there is nothing to base a suggestion on.
    if (!ok || unk.length === people.length) continue;

    const start = slots[s].start;
    const d = new Date(start);
    const startMin = d.getHours() * 60 + d.getMinutes();
    const lunch = Math.max(0, Math.min(startMin + durationMinutes, LUNCH.endMin) - Math.max(startMin, LUNCH.startMin));
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    let score = 100;
    if (tent.length) score -= 20 + 5 * tent.length;
    score -= Math.min(30, 10 * unk.length);
    score -= Math.round((10 * lunch) / 60);
    if (startMin % 60 !== 0) score -= 2;
    score -= Math.min(25, Math.floor(Math.max(0, start - nowMs) / (6 * 3_600_000)));
    if (weekend) score -= 40;
    candidates.push({ start, end: start + durationMinutes * 60_000, kind: tent.length ? 'tentative' : 'free', tentative: tent, unknown: unk, score });
    dayOf.push(slots[s].day);
  }

  const order = candidates.map((_, i) => i).sort((a, b) => candidates[b].score - candidates[a].score || candidates[a].start - candidates[b].start);
  const chosen: number[] = [];
  const overlaps = (i: number) => chosen.some((j) => candidates[i].start < candidates[j].end && candidates[j].start < candidates[i].end);
  const perDay = new Map<number, number>();
  for (const cap of [MAX_PER_DAY, Infinity]) {
    for (const i of order) {
      if (chosen.length >= limit) break;
      if (chosen.includes(i) || overlaps(i) || (perDay.get(dayOf[i]) ?? 0) >= cap) continue;
      chosen.push(i);
      perDay.set(dayOf[i], (perDay.get(dayOf[i]) ?? 0) + 1);
    }
  }
  return chosen.map((i) => candidates[i]);
}

// ---------- "Me" from the calendar the widget already has ----------

/**
 * The signed-in user's own availability read from the meetings the widget synced, for when the
 * server's free/busy for the own mailbox is not available (the address is not known). Accepted and
 * organised meetings are busy; tentative and unanswered ones are tentative; declined, cancelled and
 * all-day meetings do not block (Exchange shows all-day entries as free by default). Outside the
 * synced range nothing is known.
 */
export function availabilityFromEvents(events: readonly CalendarEvent[], windowStart: number, windowEnd: number, now: Date, email: string): PersonAvailability {
  const n = slotCount(windowStart, windowEnd);
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const coverFrom = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() - LOCAL_DAYS_BACK).getTime();
  const coverTo = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + LOCAL_DAYS_AHEAD + 1).getTime();
  const rankOf = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = windowStart + i * SLOT_MS;
    rankOf[i] = s >= coverFrom && s + SLOT_MS <= coverTo ? 0 : 4;
  }
  const out: AvailabilityEvent[] = [];
  for (const e of events) {
    if (e.isAllDay || isEffectivelyCancelled(e) || e.responseType === 'declined') continue;
    const s = Date.parse(e.start);
    const f = Date.parse(e.end);
    if (Number.isNaN(s) || Number.isNaN(f) || f <= s || f <= windowStart || s >= windowEnd) continue;
    const status: AvailabilityStatus = e.responseType === 'accepted' || e.responseType === 'organizer' ? 'busy' : 'tentative';
    const r = rank(status);
    const from = Math.max(0, Math.floor((s - windowStart) / SLOT_MS));
    const to = Math.min(n, Math.ceil((f - windowStart) / SLOT_MS));
    for (let i = from; i < to; i++) if (rankOf[i] !== 4 && r > rankOf[i]) rankOf[i] = r;
    if (out.length < MAX_EVENTS_PER_PERSON) out.push({ start: new Date(s).toISOString(), end: new Date(f).toISOString(), status, subject: oneLine(displayTitle(e), MAX_SUBJECT) || undefined });
  }
  return { email, digits: Array.from(rankOf, String).join(''), events: out };
}

/** The window one request covers must stay within what the main process accepts. */
export function windowIsSane(start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= MAX_RANGE_DAYS * DAY_MS;
}
