import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalendarEvent, ReminderPayload, Snapshot } from '../shared/types';
import { displayTitle, joinUrlForActions, minutesBetween } from '../shared/events';
import { api } from './api';
import { range } from './format';
import { eventColor, PLATFORM_NAME, useI18n, useNow } from './hooks';
import { Icon } from './icons';

export function Reminder({ snap }: { snap: Snapshot }) {
  const { t, lang } = useI18n(snap);
  const now = useNow(5_000);
  const [payload, setPayload] = useState<ReminderPayload | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getReminder().then(setPayload);
    return api.onReminder(setPayload);
  }, []);

  // The window grows with its content, bottom edge pinned above the taskbar.
  useLayoutEffect(() => {
    if (root.current) api.resizePopup(root.current.scrollHeight);
  }, [payload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void api.closeWindow();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!payload) return null;
  const events = payload.events;
  const first = events[0];
  const until = minutesBetween(now, new Date(first.start));

  const join = (e: CalendarEvent) => {
    const url = joinUrlForActions(e);
    if (url) void api.openUrl(url).then(() => api.closeWindow());
  };

  return (
    <div className="reminder" ref={root} role="alertdialog" aria-label={t.reminderTitle(until)}>
      <div className="reminder-head">
        <Icon name="bell" size={16} color="var(--accent)" />
        <span className="grow">{events.length > 1 ? `${t.reminderTitle(until)} · ${t.reminderMany(events.length)}` : t.reminderTitle(until)}</span>
        <button className="icon-btn small" onClick={() => void api.closeWindow()} aria-label={t.dismiss} title={t.dismiss}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {events.map((e) => (
        <div className={`item${events.length > 1 ? ' stack' : ''}`} key={e.id} style={{ ['--c' as string]: eventColor(e) }}>
          <div>
            <div className="name">{displayTitle(e)}</div>
            <div className="sec tnum nowrap">
              {range(e.start, e.end, lang)}
              {e.organizer ? ` · ${e.organizer}` : ''}
            </div>
          </div>
          {joinUrlForActions(e) && (
            <button className="btn primary" style={{ background: eventColor(e), color: '#fff' }} onClick={() => join(e)}>
              <Icon name="video" size={15} />
              {t.join}
              {PLATFORM_NAME[e.platform] ? ` ${PLATFORM_NAME[e.platform]}` : ''}
            </button>
          )}
        </div>
      ))}
      <div className="btns">
        <button className="btn compact" onClick={() => void api.snoozeReminder(5)}>
          {t.snooze}
        </button>
      </div>
    </div>
  );
}
