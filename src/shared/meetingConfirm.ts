// The text of the native confirmation shown before invitations are sent. It is built here, in the
// main process's hands, from the already validated meeting, never from anything the window wrote
// separately: what the person reads is exactly what will be sent.
import type { CreateMeetingInput, EditMeetingInput, MeetingBefore } from './types';
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
    // A series puts the meeting in every attendee's calendar many times: it is said before the list of them.
    ...(recurrenceText(m, lang, timeZone) ? [`${ru ? 'Повторяется' : 'Repeats'}: ${recurrenceText(m, lang, timeZone)}`] : []),
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

// ---------- Changing and calling off a meeting ----------

const WEEKDAY_RU = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];
const WEEKDAY_EN = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** Russian for "N повторений": 1 → повторение, 2-4 → повторения, else повторений. */
function timesRu(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return `${n} повторение`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return `${n} повторения`;
  return `${n} повторений`;
}

/**
 * The repetition in words, for the dialog: "Каждую неделю по вторникам, 10 повторений". A person must
 * be able to see that pressing Send puts the meeting in other people's calendars ten times, not once.
 */
export function recurrenceText(m: CreateMeetingInput, lang: ConfirmLang, timeZone?: string): string {
  const ru = lang !== 'en';
  const r = m.recurrence;
  if (!r || r.kind === 'none' || !r.end) return '';
  const day = new Date(m.start).getDay();
  const how = ru
    ? { daily: 'Каждый день', weekdays: 'Каждый будний день', weekly: `Каждую неделю по ${WEEKDAY_RU[day]}`, biweekly: `Каждые две недели по ${WEEKDAY_RU[day]}` }
    : { daily: 'Every day', weekdays: 'Every weekday', weekly: `Every week on ${WEEKDAY_EN[day]}`, biweekly: `Every two weeks on ${WEEKDAY_EN[day]}` };
  const until =
    r.end.kind === 'count'
      ? ru
        ? timesRu(r.end.count)
        : `${r.end.count} ${r.end.count === 1 ? 'time' : 'times'}`
      : `${ru ? 'до' : 'until'} ${new Date(`${r.end.date}T12:00:00Z`).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone ?? 'UTC' })}`;
  return `${how[r.kind as 'daily' | 'weekdays' | 'weekly' | 'biweekly']}, ${until}`;
}

/** One field as it changes: "Тема: Синк → Синк по релизу". Both sides are cleaned and clipped. */
function changeLine(label: string, from: string, to: string, ru: boolean): string {
  const left = oneLine(from, 60) || (ru ? '(пусто)' : '(empty)');
  const right = oneLine(to, 60) || (ru ? '(пусто)' : '(empty)');
  return `${label}: ${left} → ${right}`;
}

/**
 * "Send the change?" — built, like every other dialog here, from what will actually be sent: the
 * fields that differ, the old and the new time when it moved, and how many people are told.
 */
export function meetingChangeText(before: MeetingBefore, after: EditMeetingInput, fields: readonly string[], lang: ConfirmLang, timeZone?: string): ConfirmText {
  const ru = lang !== 'en';
  const count = after.requiredAttendees.length + after.optionalAttendees.length;
  const lines: string[] = [`${ru ? 'Встреча' : 'Meeting'}: ${shown(before.title, MAX_FIELD_SHOWN, ru)}`];
  if (fields.includes('title')) lines.push(changeLine(ru ? 'Новая тема' : 'New subject', before.title, after.title, ru));
  if (fields.includes('start')) {
    lines.push(`${ru ? 'Было' : 'Was'}: ${formatWhen(before.start, before.end, lang, timeZone)}`);
    lines.push(`${ru ? 'Станет' : 'Becomes'}: ${formatWhen(after.start, after.end, lang, timeZone)}`);
  }
  if (fields.includes('location')) lines.push(changeLine(ru ? 'Место' : 'Location', before.location, after.location, ru));
  if (fields.includes('body')) lines.push(ru ? 'Описание изменено' : 'The description has changed');
  const added = after.requiredAttendees.concat(after.optionalAttendees).filter((a) => !before.requiredAttendees.concat(before.optionalAttendees).some((b) => b.toLowerCase() === a.toLowerCase()));
  const removed = before.requiredAttendees.concat(before.optionalAttendees).filter((b) => !after.requiredAttendees.concat(after.optionalAttendees).some((a) => a.toLowerCase() === b.toLowerCase()));
  if (added.length) lines.push(`${ru ? 'Добавлены' : 'Added'}: ${added.slice(0, MAX_LISTED_RECIPIENTS).join(', ')}${added.length > MAX_LISTED_RECIPIENTS ? (ru ? ` и ещё ${added.length - MAX_LISTED_RECIPIENTS}` : ` and ${added.length - MAX_LISTED_RECIPIENTS} more`) : ''}`);
  if (removed.length)
    lines.push(
      `${ru ? 'Больше не приглашены' : 'No longer invited'}: ${removed.slice(0, MAX_LISTED_RECIPIENTS).join(', ')}${removed.length > MAX_LISTED_RECIPIENTS ? (ru ? ` и ещё ${removed.length - MAX_LISTED_RECIPIENTS}` : ` and ${removed.length - MAX_LISTED_RECIPIENTS} more`) : ''}`,
    );
  lines.push('');
  lines.push(
    count > 0
      ? ru
        ? `Об изменении узнают все приглашённые (${count}), включая тех, кого вы только что добавили или убрали. Если вы не меняли эту встречу, нажмите «Отмена».`
        : `Everyone invited (${count}) is told about the change, including anyone just added or removed. If you did not change this meeting, press Cancel.`
      : ru
        ? 'Участников нет: изменение останется в вашем календаре.'
        : 'There are no attendees: the change stays in your own calendar.',
  );
  return {
    message: ru ? 'Сохранить изменения встречи?' : 'Save the changes to the meeting?',
    detail: lines.join('\n'),
    buttons: ru ? ['Отмена', 'Сохранить'] : ['Cancel', 'Save'],
  };
}

/** "Call the meeting off?" — the one dialog where pressing the second button mails everybody at once. */
export function meetingCancelText(before: MeetingBefore, count: number, lang: ConfirmLang, timeZone?: string): ConfirmText {
  const ru = lang !== 'en';
  const lines = [
    `${ru ? 'Встреча' : 'Meeting'}: ${shown(before.title, MAX_FIELD_SHOWN, ru)}`,
    `${ru ? 'Когда' : 'When'}: ${formatWhen(before.start, before.end, lang, timeZone)}`,
    ...(before.location ? [`${ru ? 'Место' : 'Location'}: ${shown(before.location, MAX_FIELD_SHOWN, ru)}`] : []),
    '',
    count > 0
      ? ru
        ? `Встреча будет отменена, и ${count} ${attendeesRu(count)} придёт уведомление об отмене. Вернуть её будет нельзя — только создать заново.`
        : `The meeting is called off and ${count} ${count === 1 ? 'attendee' : 'attendees'} are told. It cannot be brought back — only created again.`
      : ru
        ? 'Участников нет: встреча просто исчезнет из вашего календаря.'
        : 'There are no attendees: the meeting simply leaves your calendar.',
  ];
  return {
    message: ru ? 'Отменить встречу?' : 'Call the meeting off?',
    detail: lines.join('\n'),
    buttons: ru ? ['Не отменять', 'Отменить встречу'] : ['Keep it', 'Cancel the meeting'],
  };
}
