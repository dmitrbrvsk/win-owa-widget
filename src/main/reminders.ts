// Decides when to show the "meeting starts in N minutes" window. Pure scheduling logic lives in
// `dueReminders` (unit-tested); the class wires it to a timer.
import type { CalendarEvent } from '../shared/types';
import { relevantTimed, startOf } from '../shared/events';

/** Meetings starting within 10 minutes of each other are shown in one reminder. */
const CLUSTER_WINDOW_MS = 10 * 60_000;
/** A reminder missed while asleep still shows if the meeting started less than this ago. */
const LATE_GRACE_MS = 5 * 60_000;

export const reminderKey = (e: CalendarEvent) => `${e.id}|${e.start}`;

export function dueReminders(events: CalendarEvent[], now: Date, leadMinutes: number, shown: Set<string>): CalendarEvent[] {
  if (leadMinutes < 0) return [];
  const lead = leadMinutes * 60_000;
  const due = relevantTimed(events)
    .filter((e) => !shown.has(reminderKey(e)))
    .filter((e) => {
      const start = startOf(e).getTime();
      return now.getTime() >= start - lead && now.getTime() < start + LATE_GRACE_MS;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!due.length) return [];
  const first = startOf(due[0]).getTime();
  // Fold in meetings that start soon after the first one, even if their own time has not come.
  const cluster = relevantTimed(events).filter((e) => {
    const s = startOf(e).getTime();
    return s >= first && s - first <= CLUSTER_WINDOW_MS && !shown.has(reminderKey(e)) && s > now.getTime() - LATE_GRACE_MS;
  });
  return cluster.sort((a, b) => a.start.localeCompare(b.start));
}

export class ReminderScheduler {
  private shown = new Set<string>();
  private snoozedUntil = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private getEvents: () => CalendarEvent[],
    private getLead: () => number,
    private show: (events: CalendarEvent[]) => void,
  ) {}

  start() {
    this.timer = setInterval(() => this.tick(), 10_000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  tick(now = new Date()) {
    for (const [key, until] of this.snoozedUntil) {
      if (now.getTime() >= until) {
        this.snoozedUntil.delete(key);
        this.shown.delete(key);
      }
    }
    const due = dueReminders(this.getEvents(), now, this.getLead(), this.shown).filter((e) => !this.snoozedUntil.has(reminderKey(e)));
    if (!due.length) return;
    due.forEach((e) => this.shown.add(reminderKey(e)));
    this.show(due);
  }

  /** Show these meetings again after `minutes` (but no later than their start). */
  snooze(events: CalendarEvent[], minutes: number, now = new Date()) {
    for (const e of events) {
      const until = Math.min(now.getTime() + minutes * 60_000, startOf(e).getTime());
      this.snoozedUntil.set(reminderKey(e), Math.max(until, now.getTime() + 30_000));
    }
  }
}
