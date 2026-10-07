import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, EventDetails, ResponseType, RsvpAction } from '../shared/types';
import { displayTitle, isEffectivelyCancelled, joinUrlForActions } from '../shared/events';
import { api } from './api';
import { Icon } from './icons';
import { duration, range, shortDay } from './format';
import { eventColor, PLATFORM_NAME } from './hooks';
import type { Dict, Lang } from './i18n';

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
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a
        key={i}
        href={p}
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

  async function respond(action: RsvpAction) {
    setBusy(true);
    try {
      await api.respond(event.id, action);
      toast(t.answered);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const copy = async (text: string) => {
    await api.copyText(text);
    toast(t.copied);
  };

  const respBtn = (action: RsvpAction, label: string, state: ResponseType) => (
    <button className={`btn${event.responseType === state ? ' on' : ''}`} disabled={busy} onClick={() => void respond(action)}>
      {event.responseType === state && <Icon name="check" size={14} />}
      {label}
    </button>
  );

  return (
    <div className="detail" role="dialog" aria-label={displayTitle(event)}>
      <div className="detail-head">
        <button className="icon-btn" onClick={onClose} aria-label={t.close} title={t.close}>
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
            <button className="btn primary" style={{ background: eventColor(event), color: '#fff' }} onClick={() => onJoin(event)}>
              <Icon name="video" size={16} />
              {t.join}
              {PLATFORM_NAME[event.platform] ? ` · ${PLATFORM_NAME[event.platform]}` : ''}
            </button>
          )}
          {link && (
            <button className="icon-btn" title={t.copyLink} aria-label={t.copyLink} onClick={() => void copy(link)}>
              <Icon name="link" size={16} />
            </button>
          )}
          <button
            className="icon-btn"
            title={t.copyAll}
            aria-label={t.copyAll}
            onClick={() => void copy([displayTitle(event), `${shortDay(event.start, lang)}, ${range(event.start, event.end, lang)}`, link].filter(Boolean).join('\n'))}
          >
            <Icon name="copy" size={16} />
          </button>
        </div>

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
            {optional.map((a, i) => (
              <div className="attendee" key={`${a.email ?? a.name}-${i}`}>
                <span className="avatar">{initials(a.name)}</span>
                <span className="grow nowrap" title={a.email}>
                  {a.name}
                </span>
                <span className="resp-dot" style={{ background: RESP_COLOR[a.response] }} />
              </div>
            ))}
          </>
        )}

        {details && (
          <>
            <div className="section-title">{t.agenda}</div>
            {details.bodyText ? <div className="body-text">{linkify(details.bodyText, (u) => void api.openUrl(u))}</div> : <div className="sec">{t.noAgenda}</div>}
          </>
        )}
      </div>
    </div>
  );
}
