import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Snapshot } from '../shared/types';
import {
  activeMeetings,
  addDays,
  displayTitle,
  eventsOnDay,
  joinUrlForActions,
  minutesBetween,
  nextMeetingGroup,
  pendingInvitations,
  sameDay,
  startOfDay,
} from '../shared/events';
import { urlHost } from '../shared/meetingUrl';
import { api } from './api';
import { Detail } from './Detail';
import { dayTitle, duration, hm, range, shortDay } from './format';
import { eventColor, PLATFORM_NAME, useI18n, useNow } from './hooks';
import { Icon } from './icons';
import { Timeline } from './Timeline';
import { trayStatus } from './trayIcon';

export function Popup({ snap }: { snap: Snapshot }) {
  const now = useNow(15_000);
  const { t, lang } = useI18n(snap);
  const today = startOfDay(now);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<CalendarEvent | null>(null);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // A new day starts: follow it if the user was looking at "today".
  const [lastToday, setLastToday] = useState(today.getTime());
  useEffect(() => {
    if (today.getTime() !== lastToday) {
      if (day.getTime() === lastToday) setDay(today);
      setLastToday(today.getTime());
    }
  }, [today, lastToday, day]);

  // Reopened from the tray: jump back to today and close any open card.
  useEffect(
    () =>
      api.onPopupShown(() => {
        setDay(startOfDay(new Date()));
        setOpen(null);
      }),
    [],
  );

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), 2200);
  }, []);

  const join = useCallback((e: CalendarEvent) => {
    const url = joinUrlForActions(e);
    if (url) void api.openUrl(url);
  }, []);

  // Tray icon + tooltip follow the clock, not the visible day.
  useEffect(() => {
    api.setTrayStatus(trayStatus(snap.events, now, snap.taskbarLight, t, lang));
  }, [snap.events, snap.taskbarLight, now, t, lang]);

  const dayEvents = useMemo(() => eventsOnDay(snap.events, day), [snap.events, day]);
  const allDay = dayEvents.filter((e) => e.isAllDay);
  const invites = useMemo(() => pendingInvitations(snap.events, now), [snap.events, now]);
  const isToday = sameDay(day, today);

  const live = activeMeetings(snap.events, now);
  const next = nextMeetingGroup(snap.events, now);
  const bannerEvent = live.find((e) => joinUrlForActions(e)) ?? live[0] ?? next.find((e) => joinUrlForActions(e)) ?? next[0];

  const sync = snap.sync;
  const ago = sync.lastSuccess ? Math.floor((now.getTime() - Date.parse(sync.lastSuccess)) / 60_000) : undefined;

  return (
    <div className="popup">
      <div className="popup-head">
        <h1>{t.appName}</h1>
        {snap.demo && <span className="demo-chip">{t.demo}</span>}
        <button className="icon-btn" title={t.refresh} aria-label={t.refresh} onClick={() => void api.syncNow()}>
          <Icon name="refresh" size={16} />
        </button>
        <button className="icon-btn" title={t.settings} aria-label={t.settings} onClick={() => void api.openSettings()}>
          <Icon name="gear" size={16} />
        </button>
        <button className="icon-btn" title={t.close} aria-label={t.close} onClick={() => void api.closeWindow()}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="datenav">
        <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} aria-label={t.prevDay} title={t.prevDay}>
          <Icon name="chevL" size={16} />
        </button>
        <button className="title" onClick={() => setDay(today)} title={t.backToToday}>
          {dayTitle(day, today, t, lang)}
        </button>
        <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} aria-label={t.nextDay} title={t.nextDay}>
          <Icon name="chevR" size={16} />
        </button>
      </div>

      <div className="popup-body">
        {invites.length > 0 && (
          <div className="invites">
            <button className="invites-head" onClick={() => setInvitesOpen((v) => !v)} aria-expanded={invitesOpen}>
              <Icon name="mail" size={16} color="var(--accent)" />
              <span className="grow">{t.invitations}</span>
              <span className="count tnum">{invites.length}</span>
              <Icon name={invitesOpen ? 'chevU' : 'chevD'} size={14} />
            </button>
            {invitesOpen &&
              invites.slice(0, 6).map((e) => (
                <button key={e.id} className="invite-item" onClick={() => setOpen(e)}>
                  <span className="when tnum nowrap">
                    {shortDay(e.start, lang)}, {hm(e.start, lang)}
                  </span>
                  <span className="grow nowrap">{displayTitle(e)}</span>
                </button>
              ))}
          </div>
        )}

        {bannerEvent && isToday && <Banner event={bannerEvent} now={now} t={t} lang={lang} onJoin={join} onOpen={setOpen} />}

        {allDay.length > 0 && (
          <div className="allday">
            <span className="gutter">{t.allDay}</span>
            <div className="pills">
              {allDay.map((e) => (
                <button key={e.id} className="pill nowrap" onClick={() => setOpen(e)} style={{ ['--c' as string]: eventColor(e) }}>
                  {displayTitle(e)}
                </button>
              ))}
            </div>
          </div>
        )}

        <Timeline events={dayEvents} day={day} now={now} t={t} lang={lang} onOpen={setOpen} onJoin={join} />

        <div className={`foot${sync.phase === 'error' ? ' err' : ''}`}>
          {sync.phase === 'syncing' && (
            <>
              <span className="spin" />
              <span>{t.syncing}</span>
            </>
          )}
          {sync.phase === 'notConfigured' && (
            <>
              <span className="grow">{t.notConfigured}</span>
              <button className="btn compact" onClick={() => void api.openSettings()}>
                {t.openSettings}
              </button>
            </>
          )}
          {sync.phase === 'error' && (
            <>
              <Icon name={sync.errorKind === 'network' ? 'wifiOff' : 'warning'} size={14} />
              <span className="grow nowrap" title={sync.error}>
                {sync.error}
              </span>
              {sync.errorKind === 'certificate' && sync.untrustedCert ? (
                <button className="btn compact" onClick={() => void api.trustCertificate(sync.untrustedCert!.fingerprint)}>
                  {t.trustCert}
                </button>
              ) : sync.errorKind === 'auth' ? (
                <button className="btn compact" onClick={() => void api.openSettings()}>
                  {t.openSettings}
                </button>
              ) : (
                <button className="btn compact" onClick={() => void api.syncNow()}>
                  {t.retry}
                </button>
              )}
            </>
          )}
          {(sync.phase === 'ok' || sync.phase === 'idle') && (
            <>
              <span className="grow">{ago === undefined || ago < 1 ? t.syncedJustNow : t.syncedAgo(duration(ago, t))}</span>
              <span className="ter">v{snap.version}</span>
            </>
          )}
        </div>
      </div>

      {open && <Detail event={snap.events.find((e) => e.id === open.id) ?? open} t={t} lang={lang} onClose={() => setOpen(null)} onJoin={join} toast={toast} />}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

function Banner({
  event,
  now,
  t,
  lang,
  onJoin,
  onOpen,
}: {
  event: CalendarEvent;
  now: Date;
  t: ReturnType<typeof useI18n>['t'];
  lang: ReturnType<typeof useI18n>['lang'];
  onJoin: (e: CalendarEvent) => void;
  onOpen: (e: CalendarEvent) => void;
}) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const running = start <= now;
  const link = joinUrlForActions(event);
  const untilStart = minutesBetween(now, start);
  const left = minutesBetween(now, end);
  const progress = running ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100)) : 0;
  // The Join button appears half an hour ahead and stays while the meeting runs.
  const showJoin = !!link && (running || untilStart <= 30);

  return (
    <div className={`banner${running ? ' live' : ''}`} style={{ ['--c' as string]: eventColor(event) }}>
      <div className="eyebrow">
        {running || untilStart <= 2 ? <span className="pulse" /> : <Icon name="clock" size={13} />}
        <span>{running ? t.goingOn(duration(left, t)) : untilStart === 0 ? t.startsNow : t.inMinutes(duration(untilStart, t))}</span>
      </div>
      <button className="name nowrap" style={{ display: 'block', textAlign: 'left', width: '100%' }} onClick={() => onOpen(event)}>
        {displayTitle(event)}
      </button>
      <div className="actions">
        <span className="sec tnum nowrap grow">
          {range(event.start, event.end, lang)}
          {event.organizer ? ` · ${event.organizer}` : ''}
        </span>
        {showJoin && (
          <button className="btn primary" title={urlHost(link)} style={{ background: eventColor(event), color: '#fff' }} onClick={() => onJoin(event)}>
            <Icon name="video" size={15} />
            {t.join}
            {` ${PLATFORM_NAME[event.platform] || urlHost(link) || ''}`}
          </button>
        )}
      </div>
      {running && (
        <div className="progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
