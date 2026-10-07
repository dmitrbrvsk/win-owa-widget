import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, EventDetails, ResponseType, RsvpAction } from '../shared/types';
import { displayTitle, isEffectivelyCancelled, joinUrlForActions } from '../shared/events';
import { meetingCopy } from '../shared/meetingMenu';
import { isHttpLink, safeUrl, splitByLinks, urlHost } from '../shared/meetingUrl';
import { api } from './api';
import { Icon } from './icons';
import { duration, range, shortDay } from '../shared/format';
import { eventColor, ipcMessage, joinHost } from './hooks';
import { meetingMenuProps } from './meetingMenu';
import type { Dict, Lang } from '../shared/i18n';

const RESP_COLOR: Record<ResponseType, string> = {
  accepted: 'var(--ok)',
  tentative: 'var(--warn)',
  declined: 'var(--danger)',
  organizer: 'var(--accent)',
  notResponded: 'var(--fg3)',
};

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** Turns bare https links in plain text into anchors, without touching anything else. */
function linkify(text: string, onOpen: (url: string) => void) {
  const parts = splitByLinks(text);
  return parts.map((p, i) =>
    isHttpLink(p) ? (
      <a
        key={i}
        href={safeUrl(p) ?? undefined}
        title={urlHost(p)}
        onClick={(ev) => {
          ev.preventDefault();
          onOpen(p);
        }}
      >
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/**
 * How much of a description becomes clickable. Every link in it is a React node of its own, so a body
 * of `"http://a "` repeated — and a description can be 100 000 characters from whoever sent the
 * invitation — would be tens of thousands of nodes in a 400 px window. The rest is still shown, as
 * plain text: nothing disappears without the person seeing it.
 */
const LINKIFY_LIMIT = 5_000;

/** Where to stop linkifying: at the limit, but never inside a word, so no link is cut in half. */
function linkifyCut(text: string): number {
  if (text.length <= LINKIFY_LIMIT) return text.length;
  // A link is at most 2048 characters: looking further only walks a run that holds no link at all.
  const space = text.slice(LINKIFY_LIMIT, LINKIFY_LIMIT + 2048).search(/\s/);
  return space < 0 ? LINKIFY_LIMIT : LINKIFY_LIMIT + space;
}

interface Props {
  event: CalendarEvent;
  t: Dict;
  lang: Lang;
  onClose: () => void;
  onJoin: (e: CalendarEvent) => void;
  toast: (msg: string) => void;
}

export function Detail({ event, t, lang, onClose, onJoin, toast }: Props) {
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showAllOptional, setShowAllOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = joinUrlForActions(event);
  const cancelled = isEffectivelyCancelled(event);
  const canRespond = !!event.changeKey && !event.isOrganizer && !cancelled;

  useEffect(() => {
    let alive = true;
    setDetails(null);
    setFailed(false);
    api
      .getDetails(event.id)
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [event.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const minutes = Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000);
  const required = details?.attendees.filter((a) => a.kind === 'required') ?? [];
  const optional = details?.attendees.filter((a) => a.kind === 'optional') ?? [];
  const COLLAPSE = 6;
  const visible = useMemo(() => (showAll ? required : required.slice(0, COLLAPSE)), [required, showAll]);
  const visibleOptional = useMemo(() => (showAllOptional ? optional : optional.slice(0, COLLAPSE)), [optional, showAllOptional]);
  const body = details?.bodyText ?? '';
  const bodyCut = useMemo(() => linkifyCut(body), [body]);

  /** Calls the meeting off. The question itself is a Windows dialog the main process opens. */
  async function callOff() {
    setBusy(true);
    try {
      const res = await api.cancelMeeting(event.id);
      toast(res.status === 'cancelled' ? t.cancelMeetingNote : t.cancelMeetingDone);
      if (res.status !== 'cancelled') onClose();
    } catch (e) {
      toast(`${t.cancelMeetingFailed}: ${ipcMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function respond(action: RsvpAction) {
    setBusy(true);
    try {
      await api.respond(event.id, action);
      toast(t.answered);
    } catch (e) {
      toast(ipcMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const copy = async (text: string) => {
    await api.copyText(text);
    toast(t.copied);
  };

  // Exactly what the native "Copy…" menu puts on the clipboard: a title kept as it came, with its
  // tabs and newlines, is pasted into a chat as several separate messages.
  const { link: clipLink, all: clipAll } = meetingCopy(event, lang);

  const respBtn = (action: RsvpAction, label: string, state: ResponseType) => (
    <button className={`btn${event.responseType === state ? ' on' : ''}`} disabled={busy} onClick={() => void respond(action)}>
      {event.responseType === state && <Icon name="check" size={14} />}
      {label}
    </button>
  );

  return (
    <div className="detail" role="dialog" aria-label={displayTitle(event)}>
      <div className="detail-head" {...meetingMenuProps(event.id)}>
        <button className="icon-btn" onClick={onClose} aria-label={t.back} title={t.back}>
          <Icon name="chevL" size={18} />
        </button>
        <h2 className={`grow${cancelled ? ' cancelled' : ''}`}>{displayTitle(event)}</h2>
      </div>

      <div className="detail-body scroll">
        <div className="facts">
          <Icon name="clock" size={16} color="var(--fg2)" />
          <div>
            <span className="tnum">
              {shortDay(event.start, lang)}, {range(event.start, event.end, lang)}
            </span>
            <span className="sec"> · {duration(minutes, t)}</span>
            {event.isRecurring && (
              <span className="sec">
                {' '}
                · <Icon name="repeat" size={12} /> {t.recurring}
              </span>
            )}
            {cancelled && <span style={{ color: 'var(--danger)' }}> · {t.cancelled}</span>}
          </div>

          {event.organizer && (
            <>
              <Icon name="person" size={16} color="var(--fg2)" />
              <div>
                {event.organizer} <span className="sec">· {t.organizer.toLowerCase()}</span>
              </div>
            </>
          )}
          {event.location && (
            <>
              <Icon name="pin" size={16} color="var(--fg2)" />
              <div>{linkify(event.location, (u) => void api.openUrl(u))}</div>
            </>
          )}
        </div>

        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          {link && (
            <button className="btn primary" title={urlHost(link)} style={{ background: eventColor(event), color: '#fff' }} onClick={() => onJoin(event)}>
              <Icon name="video" size={16} />
              {t.join}
              {joinHost(event.platform, link) && ` · ${joinHost(event.platform, link)}`}
            </button>
          )}
          {clipLink && (
            <button className="icon-btn" title={t.copyLink} aria-label={t.copyLink} onClick={() => void copy(clipLink)}>
              <Icon name="link" size={16} />
            </button>
          )}
          <button className="icon-btn" title={t.copyAll} aria-label={t.copyAll} onClick={() => void copy(clipAll)}>
            <Icon name="copy" size={16} />
          </button>
        </div>

        {/* Only the organizer can change or call a meeting off, and only one that is still standing;
            both ask in a Windows dialog first, because both put mail in other people's mailboxes. */}
        {event.isOrganizer && !isEffectivelyCancelled(event) && (
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <button className="btn" disabled={busy} onClick={() => void api.openEditMeeting(event.id)}>
              <Icon name="pencil" size={15} />
              {t.editMeeting}
            </button>
            <button className="btn danger" disabled={busy} onClick={() => void callOff()}>
              <Icon name="x" size={15} />
              {t.cancelMeeting}
            </button>
          </div>
        )}

        {canRespond && (
          <>
            <div className="section-title" style={{ marginTop: 4 }}>
              {t.yourAnswer}
            </div>
            <div className="rsvp">
              {respBtn('accept', t.accept, 'accepted')}
              {respBtn('tentative', t.tentative, 'tentative')}
              {respBtn('decline', t.decline, 'declined')}
            </div>
          </>
        )}

        {failed && <div className="sec">—</div>}
        {!details && !failed && <div className="sec">{t.loading}</div>}

        {details && required.length > 0 && (
          <>
            <div className="section-title">
              {t.required} · {required.length}
            </div>
            {visible.map((a, i) => (
              <div className="attendee" key={`${a.email ?? a.name}-${i}`}>
                <span className="avatar">{initials(a.name)}</span>
                <span className="grow nowrap" title={a.email}>
                  {a.name}
                </span>
                <span className="resp-dot" style={{ background: RESP_COLOR[a.response] }} />
              </div>
            ))}
            {required.length > COLLAPSE && (
              <button className="btn compact" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t.close : t.showAll(required.length)}
              </button>
            )}
          </>
        )}
        {details && optional.length > 0 && (
          <>
            <div className="section-title">
              {t.optional} · {optional.length}
            </div>
            {visibleOptional.map((a, i) => (
              <div className="attendee" key={`${a.email ?? a.name}-${i}`}>
                <span className="avatar">{initials(a.name)}</span>
                <span className="grow nowrap" title={a.email}>
                  {a.name}
                </span>
                <span className="resp-dot" style={{ background: RESP_COLOR[a.response] }} />
              </div>
            ))}
            {optional.length > COLLAPSE && (
              <button className="btn compact" onClick={() => setShowAllOptional((v) => !v)}>
                {showAllOptional ? t.close : t.showAll(optional.length)}
              </button>
            )}
          </>
        )}

        {details && (
          <>
            <div className="section-title">{t.agenda}</div>
            {body ? (
              <div className="body-text">
                {linkify(body.slice(0, bodyCut), (u) => void api.openUrl(u))}
                {body.slice(bodyCut)}
              </div>
            ) : (
              <div className="sec">{t.noAgenda}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
