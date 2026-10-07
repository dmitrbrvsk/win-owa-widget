// What changed in the calendar between two syncs, and how to say it in a notification.
// Pure functions: the main process shows the result with a Windows notification.
import type { CalendarEvent } from './types';
import { isEffectivelyCancelled, displayTitle } from './events';
import { oneLine } from './text';

export type ChangeKind = 'moved' | 'cancelled' | 'invited';

export interface EventChange {
  kind: ChangeKind;
  event: CalendarEvent;
  /** The meeting as it was, for "moved" and "cancelled". */
  was?: CalendarEvent;
}

/**
 * Compares the meetings the widget showed with the ones the server just returned. A meeting that is
 * over is not worth a notification, and neither is anything when there was nothing to compare with
 * (the first sync of an account).
 */
export function diffEvents(before: CalendarEvent[], after: CalendarEvent[], now: Date): EventChange[] {
  if (before.length === 0) return [];
  const old = new Map(before.map((e) => [e.id, e]));
  const changes: EventChange[] = [];
  for (const e of after) {
    if (new Date(e.end) <= now) continue;
    const was = old.get(e.id);
    if (!was) {
      // Something new that is waiting for an answer: an invitation from someone else.
      if (e.responseType === 'notResponded' && !e.isOrganizer && !isEffectivelyCancelled(e)) changes.push({ kind: 'invited', event: e });
      continue;
    }
    if (!isEffectivelyCancelled(was) && isEffectivelyCancelled(e)) {
      changes.push({ kind: 'cancelled', event: e, was });
    } else if (!isEffectivelyCancelled(e) && (was.start !== e.start || was.end !== e.end)) {
      changes.push({ kind: 'moved', event: e, was });
    }
  }
  return changes;
}

export interface Note {
  title: string;
  body: string;
  /** The meeting a click opens; none for a summary. */
  eventId?: string;
  /** A new invitation: the notification offers an Accept button. */
  accept?: boolean;
}

type Lang = 'ru' | 'en';

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB' };

const WORDS = {
  ru: {
    moved: 'Встречу перенесли',
    cancelled: 'Встречу отменили',
    invited: 'Новое приглашение',
    summary: 'Изменения в календаре',
    today: 'сегодня',
    tomorrow: 'завтра',
    now: 'Теперь',
    was: 'было',
    invites: (who: string | undefined, title: string) => (who ? `${who} приглашает на «${title}»` : `Приглашают на «${title}»`),
    counts: (m: number, c: number, i: number) =>
      [m && `перенесено: ${m}`, c && `отменено: ${c}`, i && `новых приглашений: ${i}`].filter(Boolean).join(' · '),
  },
  en: {
    moved: 'Meeting rescheduled',
    cancelled: 'Meeting cancelled',
    invited: 'New invitation',
    summary: 'Calendar changes',
    today: 'today',
    tomorrow: 'tomorrow',
    now: 'Now',
    was: 'was',
    invites: (who: string | undefined, title: string) => (who ? `${who} invites you to “${title}”` : `You are invited to “${title}”`),
    counts: (m: number, c: number, i: number) =>
      [m && `rescheduled: ${m}`, c && `cancelled: ${c}`, i && `new invitations: ${i}`].filter(Boolean).join(' · '),
  },
} as const;

const clock = (d: Date, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const dayLabel = (d: Date, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short' }).format(d);

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "today 16:00–16:45", "tomorrow 11:00–12:00", "Fri, 9 Oct, 16:00–16:45"; all-day meetings give just the day. */
export function whenText(e: Pick<CalendarEvent, 'start' | 'end' | 'isAllDay'>, now: Date, lang: Lang): string {
  const s = new Date(e.start);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const w = WORDS[lang];
  const day = sameDay(s, now) ? w.today : sameDay(s, tomorrow) ? w.tomorrow : dayLabel(s, lang);
  return e.isAllDay ? day : `${day} ${clock(s, lang)}–${clock(new Date(e.end), lang)}`;
}

/** Foreign text (a stranger's subject line) goes into a notification as one short clean line. */
const title = (e: CalendarEvent) => oneLine(displayTitle(e), 100);

export function describeChange(c: EventChange, now: Date, lang: Lang): Note {
  const w = WORDS[lang];
  const name = title(c.event);
  switch (c.kind) {
    case 'moved': {
      const was = c.was!;
      const before = sameDay(new Date(was.start), new Date(c.event.start)) ? clock(new Date(was.start), lang) : whenText(was, now, lang);
      return { title: w.moved, body: `${name}\n${w.now} ${whenText(c.event, now, lang)} (${w.was} ${before})`, eventId: c.event.id };
    }
    case 'cancelled':
      return { title: w.cancelled, body: `${name}\n${whenText(c.was ?? c.event, now, lang)}`, eventId: c.event.id };
    case 'invited':
      return { title: w.invited, body: `${w.invites(c.event.organizer ? oneLine(c.event.organizer, 60) : undefined, name)}\n${whenText(c.event, now, lang)}`, eventId: c.event.id, accept: true };
  }
}

/** Individual notifications up to this many per sync; more than that becomes one summary (a series edited at once changes dozens of meetings). */
export const MAX_INDIVIDUAL = 3;

export function describeChanges(changes: EventChange[], now: Date, lang: Lang): Note[] {
  if (changes.length === 0) return [];
  if (changes.length <= MAX_INDIVIDUAL) return changes.map((c) => describeChange(c, now, lang));
  const count = (k: ChangeKind) => changes.filter((c) => c.kind === k).length;
  return [{ title: WORDS[lang].summary, body: WORDS[lang].counts(count('moved'), count('cancelled'), count('invited')) }];
}
