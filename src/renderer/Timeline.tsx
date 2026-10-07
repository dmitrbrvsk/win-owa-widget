import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarEvent } from '../shared/types';
import { displayTitle, isEffectivelyCancelled, joinUrlForActions, sameDay } from '../shared/events';
import { layoutDay } from '../shared/timeline';
import { Icon } from './icons';
import { range } from './format';
import { eventColor } from './hooks';
import type { Dict, Lang } from './i18n';

const HOUR = 64; // px per hour

interface Props {
  events: CalendarEvent[];
  day: Date;
  now: Date;
  t: Dict;
  lang: Lang;
  onOpen: (e: CalendarEvent) => void;
  onJoin: (e: CalendarEvent) => void;
}

export function Timeline({ events, day, now, t, lang, onOpen, onJoin }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const isToday = sameDay(day, now);
  const blocks = useMemo(() => layoutDay(events, day), [events, day]);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Show from an hour before the first meeting (or an hour before now) down to the end of the day.
  const scrollTarget = useMemo(() => {
    const anchors = [...blocks.map((b) => b.startMin)];
    const first = isToday ? Math.min(nowMin, ...(anchors.length ? anchors.filter((m) => m + 60 >= nowMin) : [nowMin])) : (anchors[0] ?? 8 * 60);
    return Math.max(0, (first - 60) * (HOUR / 60));
  }, [blocks, isToday, nowMin]);

  const dayKey = day.toDateString();
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = scrollTarget;
    // Only when switching day or when the content first arrives, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, blocks.length === 0]);

  useEffect(() => {
    // keep layout stable on resize
  }, []);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const currentSlotStart = Math.floor(nowMin / 30) * 30;

  return (
    <div className="timeline scroll" ref={ref} role="list" aria-label="Meetings">
      {!blocks.length && <div className="empty" style={{ position: 'absolute', inset: 0 }}>{t.noMeetings}</div>}
      <div className="tl-inner" style={{ height: 24 * HOUR + 12, marginTop: 10 }}>
        {isToday && <div className="tl-slot" style={{ top: (currentSlotStart * HOUR) / 60, height: HOUR / 2 }} />}
        {hours.map((h) => (
          <div key={h}>
            <div className="tl-hour tnum" style={{ top: h * HOUR }}>
              {String(h).padStart(2, '0')}:00
            </div>
            <div className="tl-line" style={{ top: h * HOUR }} />
            <div className="tl-line half" style={{ top: h * HOUR + HOUR / 2 }} />
          </div>
        ))}
        {blocks.map((b) => {
          const e = b.event;
          const top = (b.startMin * HOUR) / 60 + 1;
          const height = Math.max(22, ((b.endMin - b.startMin) * HOUR) / 60 - 2);
          const colW = `calc((100% - 56px) / ${b.lanes})`;
          const link = joinUrlForActions(e);
          const past = isToday && b.endMin <= nowMin;
          const short = height < 40;
          return (
            <div
              key={e.id}
              className={`blk${past ? ' past' : ''}${isEffectivelyCancelled(e) ? ' cancelled' : ''}${e.responseType === 'tentative' ? ' tentative' : ''}${e.responseType === 'declined' ? ' declined' : ''}${b.lanes > 1 ? ' compact' : ''}`}
              style={{ top, height, left: `calc(56px + ${colW} * ${b.lane} + 1px)`, width: `calc(${colW} - 3px)`, ['--c' as string]: eventColor(e) }}
              role="listitem"
            >
              <button
                style={{ position: 'absolute', inset: 0, textAlign: 'left', padding: '3px 28px 0 11px', width: '100%' }}
                onClick={() => onOpen(e)}
                aria-label={`${displayTitle(e)}, ${range(e.start, e.end, lang)}`}
              >
                <div className="t nowrap">{displayTitle(e)}</div>
                <div className="m nowrap tnum">
                  {range(e.start, e.end, lang)}
                  {short ? '' : e.organizer ? ` · ${e.organizer}` : ''}
                  {e.isOrganizer && !short && b.lanes === 1 && (
                    <>
                      {' '}
                      <span className="badge">{t.organizerBadge}</span>
                    </>
                  )}
                </div>
              </button>
              {link && (
                <button className="join-dot" onClick={() => onJoin(e)} title={t.join} aria-label={`${t.join}: ${displayTitle(e)}`}>
                  <Icon name="joinCircle" size={18} color="currentColor" />
                </button>
              )}
            </div>
          );
        })}
        {isToday && <div className="tl-now" style={{ top: (nowMin * HOUR) / 60 }} />}
      </div>
    </div>
  );
}
