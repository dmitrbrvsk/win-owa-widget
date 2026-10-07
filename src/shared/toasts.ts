// What a Windows notification with buttons says and which button does what. Pure functions: the
// main process shows the result, runs the chosen action and keeps all state itself, so a toast
// carries no data that could be replayed from outside.
import type { CalendarEvent } from './types';
import type { Note } from './changes';
import { displayTitle, joinUrlForActions, minutesBetween } from './events';
import { urlHost } from './meetingUrl';
import { oneLine } from './text';

export type Lang = 'ru' | 'en';
export type ToastActionId = 'join' | 'snooze' | 'open' | 'accept';

export interface ToastDef {
  title: string;
  body: string;
  /** A drop-down above the buttons, used for "how long to snooze". */
  selection?: { items: string[]; minutes: number[] };
  buttons: Array<{ id: ToastActionId; text: string }>;
  /** The meeting a click on the notification itself opens in the widget. */
  eventId?: string;
}

const SNOOZE_MINUTES = [5, 10, 15];

const W = {
  ru: {
    starting: 'Встреча начинается',
    inMin: (m: number) => `Встреча через ${m} мин`,
    many: (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'встреча' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'встречи' : 'встреч'}`,
    more: (n: number) => `…и ещё ${n}`,
    join: 'Подключиться',
    snooze: 'Отложить',
    open: 'Открыть',
    accept: 'Принять',
    minutes: (m: number) => `Отложить на ${m} мин`,
    accepted: 'Приглашение принято',
    acceptFailed: 'Не удалось принять приглашение',
  },
  en: {
    starting: 'Meeting is starting',
    inMin: (m: number) => `Meeting in ${m} min`,
    many: (n: number) => `${n} meetings`,
    more: (n: number) => `…and ${n} more`,
    join: 'Join',
    snooze: 'Snooze',
    open: 'Open',
    accept: 'Accept',
    minutes: (m: number) => `Snooze for ${m} min`,
    accepted: 'Invitation accepted',
    acceptFailed: 'Could not accept the invitation',
  },
} as const;

const clock = (iso: string, lang: Lang) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });

/** The button that joins: just "Join" for a known service, and the real host of a link to an unfamiliar site. */
function joinButtonText(e: CalendarEvent, lang: Lang): string {
  const url = joinUrlForActions(e);
  const where = e.platform === 'generic' ? oneLine(urlHost(url) ?? '', 40) : '';
  return where ? `${W[lang].join} · ${where}` : W[lang].join;
}

/** "Meeting in 5 min" with Join and Snooze; several meetings at once get Open instead of a guess about which to join. */
export function reminderToast(events: CalendarEvent[], now: Date, lang: Lang): ToastDef {
  const w = W[lang];
  const first = events[0];
  const until = minutesBetween(now, new Date(first.start));
  const heading = until <= 0 ? w.starting : w.inMin(until);
  const selection = { items: SNOOZE_MINUTES.map((m) => w.minutes(m)), minutes: SNOOZE_MINUTES };

  if (events.length === 1) {
    const organizer = first.organizer ? ` · ${oneLine(first.organizer, 60)}` : '';
    const buttons: ToastDef['buttons'] = [];
    if (joinUrlForActions(first)) buttons.push({ id: 'join', text: joinButtonText(first, lang) });
    buttons.push({ id: 'snooze', text: w.snooze });
    return {
      title: heading,
      body: `${oneLine(displayTitle(first), 100)}\n${clock(first.start, lang)}–${clock(first.end, lang)}${organizer}`,
      selection,
      buttons,
      eventId: first.id,
    };
  }

  const shown = events.slice(0, 3).map((e) => `${clock(e.start, lang)} ${oneLine(displayTitle(e), 60)}`);
  if (events.length > 3) shown.push(w.more(events.length - 3));
  return {
    title: `${heading} · ${w.many(events.length)}`,
    body: shown.join('\n'),
    selection,
    buttons: [
      { id: 'open', text: w.open },
      { id: 'snooze', text: w.snooze },
    ],
  };
}

/** An invitation: one tap to accept, a click on the text opens the meeting. */
export function inviteToast(title: string, body: string, eventId: string, lang: Lang): ToastDef {
  return { title, body, buttons: [{ id: 'accept', text: W[lang].accept }], eventId };
}

/** A notification about a change: a new invitation gets Accept, anything else is just text that opens the meeting when clicked. */
export function noteToast(note: Note, lang: Lang): ToastDef {
  if (note.accept && note.eventId) return inviteToast(note.title, note.body, note.eventId, lang);
  return { title: note.title, body: note.body, buttons: [], eventId: note.eventId };
}

export const doneText = (lang: Lang) => ({ accepted: W[lang].accepted, failed: W[lang].acceptFailed });

// ---------- Which button was pressed ----------

type Slot = 'selection' | ToastActionId;

export interface ToastLayout {
  /** In the form Electron's Notification takes. The drop-down goes first; Windows draws it above the buttons. */
  actions: Array<{ type: 'selection'; items: string[] } | { type: 'button'; text: string }>;
  /** What each entry of `actions` is, by index: the index Windows reports is the index in this list. */
  slots: Slot[];
}

export function layoutToast(def: ToastDef): ToastLayout {
  const actions: ToastLayout['actions'] = [];
  const slots: Slot[] = [];
  if (def.selection) {
    actions.push({ type: 'selection', items: def.selection.items });
    slots.push('selection');
  }
  for (const b of def.buttons) {
    actions.push({ type: 'button', text: b.text });
    slots.push(b.id);
  }
  return { actions, slots };
}

/** Maps what Windows reports (the pressed entry and the drop-down choice, -1 when untouched) to an action and snooze length. */
export function resolveAction(def: ToastDef, layout: ToastLayout, actionIndex: number, selectionIndex: number): { id: ToastActionId; minutes: number } | null {
  const slot = layout.slots[actionIndex];
  if (!slot || slot === 'selection') return null;
  const minutes = def.selection?.minutes ?? [];
  const chosen = Number.isInteger(selectionIndex) && selectionIndex >= 0 && selectionIndex < minutes.length ? minutes[selectionIndex] : (minutes[0] ?? 5);
  return { id: slot, minutes: chosen };
}
