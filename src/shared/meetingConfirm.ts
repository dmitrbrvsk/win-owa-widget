// The text of the native confirmation shown before invitations are sent. It is built here, in the
// main process's hands, from the already validated meeting, never from anything the window wrote
// separately: what the person reads is exactly what will be sent.
import type { CreateMeetingInput } from './types';
import { oneLine } from './text';

export type ConfirmLang = 'ru' | 'en';

/** How many recipients the dialog lists before "and N more". */
export const MAX_LISTED_RECIPIENTS = 15;
/** How many characters of the description the dialog shows. */
export const MAX_BODY_SHOWN = 200;
/** How many characters of the subject and the place the dialog shows. */
export const MAX_FIELD_SHOWN = 120;

/**
 * One line of at most `max` characters, and when there was more, it says so instead of ending
 * quietly: a subject padded with spaces (or with characters `clean` removes) must not be able to
 * look empty or short while a much longer one is sent.
 */
function shown(text: string, max: number, ru: boolean): string {
  const line = oneLine(text, max);
  const rest = [...text.trim()].length - [...line].length;
  return rest > 0 ? `${line}… ${ru ? `(всего ${[...text.trim()].length} символов)` : `(${[...text.trim()].length} characters in all)`}` : line;
}

export interface ConfirmText {
  message: string;
  detail: string;
  /** [cancel, send]: cancel is the default and the answer to Esc. */
  buttons: [string, string];
}

/** Russian dative for "N участникам": 1 → участнику, others → участникам. */
function attendeesRu(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'участнику' : 'участникам';
}

/** "вт, 7 октября 2026 г., 10:00–11:00" (a meeting that crosses midnight shows both ends in full). */
export function formatWhen(startIso: string, endIso: string, lang: ConfirmLang, timeZone?: string): string {
  const locale = lang === 'en' ? 'en-GB' : 'ru-RU';
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone };
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone };
  const dayOf = (d: Date) => d.toLocaleDateString(locale, day);
  const timeOf = (d: Date) => d.toLocaleTimeString(locale, time);
  if (dayOf(start) === dayOf(end)) return `${dayOf(start)}, ${timeOf(start)}–${timeOf(end)}`;
  return `${dayOf(start)}, ${timeOf(start)} – ${dayOf(end)}, ${timeOf(end)}`;
}

export function meetingConfirmText(m: CreateMeetingInput, lang: ConfirmLang, timeZone?: string): ConfirmText {
  const ru = lang !== 'en';
  const recipients = [...m.requiredAttendees.map((a) => ({ a, optional: false })), ...m.optionalAttendees.map((a) => ({ a, optional: true }))];
  const n = recipients.length;
  const listed = recipients.slice(0, MAX_LISTED_RECIPIENTS).map(({ a, optional }) => `• ${a}${optional ? (ru ? ' (необязательный)' : ' (optional)') : ''}`);
  const rest = n - listed.length;
  const lines = [
    `${ru ? 'Тема' : 'Subject'}: ${shown(m.title, MAX_FIELD_SHOWN, ru)}`,
    `${ru ? 'Когда' : 'When'}: ${formatWhen(m.start, m.end, lang, timeZone)}`,
    ...(m.location ? [`${ru ? 'Место' : 'Location'}: ${shown(m.location, MAX_FIELD_SHOWN, ru)}`] : []),
    // The description goes out with the invitation too, so its beginning is shown (one line, clipped).
    ...(m.body.trim() ? [`${ru ? 'Описание' : 'Description'}: ${shown(m.body, MAX_BODY_SHOWN, ru)}`] : []),
    '',
    ru ? `Получат приглашение (${n}):` : `Will be invited (${n}):`,
    ...listed,
    ...(rest > 0 ? [ru ? `… и ещё ${rest}` : `… and ${rest} more`] : []),
    '',
    ru
      ? 'Приглашения уйдут от вашего имени сразу после нажатия «Отправить». Если вы не создавали эту встречу, нажмите «Отмена».'
      : 'The invitations go out in your name as soon as you press Send. If you did not create this meeting, press Cancel.',
  ];
  return {
    message: ru ? `Отправить приглашение ${n} ${attendeesRu(n)}?` : `Send an invitation to ${n} ${n === 1 ? 'attendee' : 'attendees'}?`,
    detail: lines.join('\n'),
    buttons: ru ? ['Отмена', 'Отправить'] : ['Cancel', 'Send'],
  };
}
