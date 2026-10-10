// An answer to an invitation with words: a comment for the organizer, and/or another time.
// What is typed here is only a request: the main process validates it, builds the message itself and
// asks the person in a Windows dialog before anything is mailed.
import { useMemo, useState } from 'react';
import type { CalendarEvent, MeetingReplyInput, RsvpAction } from '../shared/types';
import { conflictsInRange } from '../shared/conflicts';
import { MAX_REPLY_COMMENT } from '../shared/limits';
import { api } from './api';
import { ConflictNote } from './ConflictNote';
import { Icon } from './icons';
import { ipcMessage } from './hooks';
import type { Dict, Lang } from '../shared/i18n';

export type ReplyMode = 'comment' | 'propose';

interface Props {
  event: CalendarEvent;
  events: CalendarEvent[];
  mode: ReplyMode;
  t: Dict;
  lang: Lang;
  onClose: () => void;
  toast: (msg: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** A local date and time from the two fields, or null while one of them is empty or wrong. */
const parseLocal = (date: string, time: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function ReplyPanel({ event, events, mode, t, lang, onClose, toast }: Props) {
  const propose = mode === 'propose';
  const first = new Date(event.start);
  const last = new Date(event.end);
  const [action, setAction] = useState<RsvpAction>(propose ? 'tentative' : event.responseType === 'declined' ? 'decline' : event.responseType === 'tentative' ? 'tentative' : 'accept');
  const [comment, setComment] = useState('');
  const [date, setDate] = useState(dateValue(first));
  const [from, setFrom] = useState(timeValue(first));
  const [to, setTo] = useState(timeValue(last));
  const [busy, setBusy] = useState(false);

  const start = propose ? parseLocal(date, from) : null;
  const end = propose ? parseLocal(date, to) : null;
  const sameAsNow = !!start && !!end && start.getTime() === first.getTime() && end.getTime() === last.getTime();
  const timeProblem = !propose
    ? ''
    : !start || !end
      ? t.replyBadTime
      : end <= start
        ? t.replyBadTime
        : start.getTime() < Date.now() - 5 * 60_000
          ? t.replyPastTime
          : sameAsNow
            ? t.replySameTime
            : '';
  const busyThen = useMemo(() => (start && end && !timeProblem ? conflictsInRange(start, end, events, event.id) : []), [start, end, timeProblem, events, event.id]);
  const needsText = !propose && !comment.trim();
  const canSend = !busy && !timeProblem && !needsText;

  async function send() {
    const input: MeetingReplyInput = { eventId: event.id, action, comment: comment.trim() };
    if (propose && start && end) input.proposal = { start: start.toISOString(), end: end.toISOString() };
    setBusy(true);
    try {
      const res = await api.replyToMeeting(input);
      if (res.status === 'replied') {
        toast(t.replySent);
        onClose();
      } else toast(t.replyNotSent);
    } catch (e) {
      toast(`${t.replyFailed}: ${ipcMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const choices: Array<[RsvpAction, string]> = propose
    ? [
        ['tentative', t.tentative],
        ['decline', t.decline],
      ]
    : [
        ['accept', t.accept],
        ['tentative', t.tentative],
        ['decline', t.decline],
      ];

  return (
    <div className="reply-panel" role="group" aria-label={propose ? t.replyTitlePropose : t.replyTitleComment}>
      <div className="reply-head">
        <Icon name={propose ? 'clock' : 'mail'} size={16} color="var(--accent)" />
        <strong className="grow">{propose ? t.replyTitlePropose : t.replyTitleComment}</strong>
        <button className="icon-btn" onClick={onClose} aria-label={t.replyBack} title={t.replyBack}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="rsvp" role="radiogroup" aria-label={t.yourAnswer}>
        {choices.map(([value, label]) => (
          <button key={value} className={`btn${action === value ? ' on' : ''}`} role="radio" aria-checked={action === value} onClick={() => setAction(value)}>
            {action === value && <Icon name="check" size={14} />}
            {label}
          </button>
        ))}
      </div>

      {propose && (
        <>
          <div className="section-title">{t.replyNewTime}</div>
          <div className="when-inputs">
            <input className="field date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t.replyNewTime} />
            <input className="field time" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t.replyNewTime} />
            <span>–</span>
            <input className="field time" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t.replyNewTime} />
          </div>
          {timeProblem && <div className="field-error">{timeProblem}</div>}
          {busyThen.length > 0 && <ConflictNote event={event} events={events} conflicts={busyThen} title={t.replyBusyThen} t={t} lang={lang} toast={toast} readonly />}
          <div className="hint" style={{ margin: '6px 0' }}>
            {t.replyProposeNote}
          </div>
        </>
      )}

      <div className="section-title">{t.replyComment}</div>
      <textarea
        className="field wide reply-text"
        value={comment}
        maxLength={MAX_REPLY_COMMENT}
        rows={3}
        onChange={(e) => setComment(e.target.value)}
        aria-label={t.replyComment}
      />
      <div className="hint reply-count tnum">{t.replyCount(comment.length, MAX_REPLY_COMMENT)}</div>

      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn primary" disabled={!canSend} onClick={() => void send()} title={needsText ? t.replyNeedText : undefined}>
          <Icon name="mail" size={15} />
          {t.replySend}
        </button>
        <button className="btn" onClick={onClose}>
          {t.replyBack}
        </button>
      </div>
    </div>
  );
}
