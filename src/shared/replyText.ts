// The words of an answer to an invitation: the message the organizer receives, and the native
// confirmation the person reads before it goes. Both are built here from the validated reply and
// from the meeting the main process looked up itself, never from text the window wrote separately:
// what the person reads in the dialog is the text that is sent.
import type { CalendarEvent, MeetingReplyInput, RsvpAction } from './types';
import { displayTitle } from './events';
import { formatWhen, type ConfirmLang, type ConfirmText } from './meetingConfirm';
import { oneLine } from './text';

/** How much of the message the dialog shows; a longer one says so. */
export const MAX_REPLY_SHOWN = 700;

const ACTION_RU: Record<RsvpAction, string> = { accept: 'Принять', tentative: 'Под вопросом', decline: 'Отклонить' };
const ACTION_EN: Record<RsvpAction, string> = { accept: 'Accept', tentative: 'Tentative', decline: 'Decline' };

export const actionLabel = (a: RsvpAction, lang: ConfirmLang) => (lang === 'en' ? ACTION_EN : ACTION_RU)[a];

/** "GMT+3": which clock the proposed time is on, so the organizer in another city reads it right. */
export function zoneLabel(at: Date, lang: ConfirmLang, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ru-RU', { timeZone, timeZoneName: 'short' }).formatToParts(at);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** The text of the message to the organizer: the comment, then the other time when there is one. */
export function replyBody(event: CalendarEvent, reply: MeetingReplyInput, lang: ConfirmLang, timeZone?: string): string {
  const ru = lang !== 'en';
  const parts: string[] = [];
  if (reply.comment) parts.push(reply.comment);
  if (reply.proposal) {
    const zone = zoneLabel(new Date(reply.proposal.start), lang, timeZone);
    parts.push(
      `${ru ? 'Предлагаю другое время' : 'I would like to propose another time'}: ${formatWhen(reply.proposal.start, reply.proposal.end, lang, timeZone)}${zone ? ` (${zone})` : ''}.\n` +
        `${ru ? 'Сейчас' : 'Now'}: ${formatWhen(event.start, event.end, lang, timeZone)}.`,
    );
  }
  return parts.join('\n\n');
}

export function replyConfirmText(event: CalendarEvent, reply: MeetingReplyInput, lang: ConfirmLang, timeZone?: string): ConfirmText {
  const ru = lang !== 'en';
  const body = replyBody(event, reply, lang, timeZone);
  const shown = body.length > MAX_REPLY_SHOWN ? `${body.slice(0, MAX_REPLY_SHOWN)}… ${ru ? `(всего ${body.length} символов)` : `(${body.length} characters in all)`}` : body;
  const who = event.organizer ? oneLine(event.organizer, 120) + (event.organizerEmail ? ` <${oneLine(event.organizerEmail, 120)}>` : '') : event.organizerEmail ? oneLine(event.organizerEmail, 120) : ru ? 'организатор' : 'the organizer';
  return {
    message: reply.proposal ? (ru ? 'Предложить организатору другое время?' : 'Propose another time to the organizer?') : ru ? 'Отправить организатору ответ с комментарием?' : 'Send the organizer a reply with a comment?',
    detail: [
      `${ru ? 'Встреча' : 'Meeting'}: ${oneLine(displayTitle(event), 120)}`,
      `${ru ? 'Организатор' : 'Organizer'}: ${who}`,
      `${ru ? 'Ваш ответ' : 'Your answer'}: ${actionLabel(reply.action, lang)}`,
      '',
      ru ? 'Организатор получит письмо с таким текстом:' : 'The organizer will receive a message with this text:',
      '',
      shown,
      '',
      ru ? 'Если вы не писали этот ответ, нажмите «Отмена».' : 'If you did not write this reply, press Cancel.',
    ].join('\n'),
    buttons: ru ? ['Отмена', 'Отправить'] : ['Cancel', 'Send'],
  };
}
