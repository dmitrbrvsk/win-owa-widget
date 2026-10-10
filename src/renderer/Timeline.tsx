import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarEvent } from '../shared/types';
import { displayTitle, isEffectivelyCancelled, joinUrlForActions, sameDay } from '../shared/events';
import { layoutDay, visibleRange, type Workday } from '../shared/timeline';
import { Icon } from './icons';
import { range } from '../shared/format';
import { eventColor, joinHost } from './hooks';
import { meetingMenuProps } from './meetingMenu';
import type { Dict, Lang } from '../shared/i18n';

const HOUR = 64; // px per hour

interface Props {
  events: CalendarEvent[];
  day: Date;
  now: Date;
  workday: Workday;
  t: Dict;
  lang: Lang;
  onOpen: (e: CalendarEvent) => void;
  onJoin: (e: CalendarEvent) => void;
  /** Meetings the person has written a note on: they get a small pencil. */
  noteIds: string[];
}

export function Timeline({ events, day, now, workday, t, lang, onOpen, onJoin, noteIds }: Props) {
  const noted = useMemo(() => new Set(noteIds), [noteIds]);
  const ref = useRef<HTMLDivElement>(null);
  const isToday = sameDay(day, now);
  const blocks = useMemo(() => layoutDay(events, day), [events, day]);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // The working day, widened to keep every meeting (and "now", today) in view.
  const range0 = useMemo(() => visibleRange(blocks, workday, isToday ? nowMin : undefined), [blocks, workday, isToday, nowMin]);
  const y = (min: number) => ((min - range0.startMin) * HOUR) / 60;

  // Scroll to an hour before the first meeting (or an hour before now).
  const scrollTarget = useMemo(() => {
    const anchors = [...blocks.map((b) => b.startMin)];
    const first = isToday ? Math.min(nowMin, ...(anchors.length ? anchors.filter((m) => m + 60 >= nowMin) : [nowMin])) : (anchors[0] ?? range0.startMin);
    return Math.max(0, y(first - 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, isToday, nowMin, range0.startMin]);

  const dayKey = day.toDateString();
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = scrollTarget;
    // Only when switching day or when the content first arrives, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, blocks.length === 0]);

  useEffect(() => {
    // keep layout stable on resize
  }, []);

  const firstHour = range0.startMin / 60;
  const lastHour = range0.endMin / 60;
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const currentSlotStart = Math.floor(nowMin / 30) * 30;

  return (
    <div className="timeline scroll" ref={ref} role="list" aria-label="Meetings">
      {!blocks.length && <div className="empty" style={{ position: 'absolute', inset: 0 }}>{t.noMeetings}</div>}
      <div className="tl-inner" style={{ height: (lastHour - firstHour) * HOUR + 12, marginTop: 10 }}>
        {isToday && <div className="tl-slot" style={{ top: y(currentSlotStart), height: HOUR / 2 }} />}
        {hours.map((h) => (
          <div key={h}>
            <div className="tl-hour tnum" style={{ top: y(h * 60) }}>
              {String(h % 24).padStart(2, '0')}:00
            </div>
            <div className="tl-line" style={{ top: y(h * 60) }} />
            <div className="tl-line half" style={{ top: y(h * 60) + HOUR / 2 }} />
          </div>
        ))}
        {blocks.map((b) => {
          const e = b.event;
          const top = y(b.startMin) + 1;
          const height = Math.max(22, ((b.endMin - b.startMin) * HOUR) / 60 - 2);
          const colW = `calc((100% - 56px) / ${b.lanes})`;
          const link = joinUrlForActions(e);
          // A link to anything but a known service: its host is the only thing that tells an invitation
          // from a stranger apart from a real one, so it is shown before the link is opened.
          const host = joinHost(e.platform, link);
          const joinLabel = host ? `${t.join} · ${host}` : t.join;
          const past = isToday && b.endMin <= nowMin;
          const short = height < 40;
          return (
            <div
              key={e.id}
              className={`blk${past ? ' past' : ''}${isEffectivelyCancelled(e) ? ' cancelled' : ''}${e.responseType === 'tentative' ? ' tentative' : ''}${e.responseType === 'declined' ? ' declined' : ''}${b.lanes > 1 ? ' compact' : ''}`}
              style={{ top, height, left: `calc(56px + ${colW} * ${b.lane} + 1px)`, width: `calc(${colW} - 3px)`, ['--c' as string]: eventColor(e) }}
              role="listitem"
              {...meetingMenuProps(e.id)}
            >
              <button
                style={{ position: 'absolute', inset: 0, textAlign: 'left', padding: '3px 28px 0 11px', width: '100%' }}
                onClick={() => onOpen(e)}
                aria-label={`${displayTitle(e)}, ${range(e.start, e.end, lang)}`}
              >
                <div className="t nowrap">
                  {displayTitle(e)}
                  {noted.has(e.id) && (
                    <span className="note-mark" title={t.noteMarker} aria-label={t.noteMarker}>
                      <Icon name="pencil" size={11} color="currentColor" />
                    </span>
                  )}
                </div>
                <div className="m nowrap tnum">
                  {range(e.start, e.end, lang)}
                  {host && (
                    <>
                      {' · '}
                      <span className="join-host">{host}</span>
                    </>
                  )}
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
                <button className="join-dot" onClick={() => onJoin(e)} title={joinLabel} aria-label={`${joinLabel}: ${displayTitle(e)}`}>
                  <Icon name="joinCircle" size={18} color="currentColor" />
                </button>
              )}
            </div>
          );
        })}
        {isToday && <div className="tl-now" style={{ top: y(nowMin) }} />}
      </div>
    </div>
  );
}
