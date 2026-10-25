import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { sameDay } from '../shared/events';
import { type Span } from '../shared/freeTime';
import { type Dict, type Lang } from '../shared/i18n';
import { usesMeetingPages } from '../shared/meetingPages';
import { layoutDay, visibleRange, type Workday } from '../shared/timeline';
import { type CalendarEvent } from '../shared/types';

import { DenseDayTimeline } from './DenseDayTimeline';
import { FreeBlocks } from './FreeTime';
import { TimelineMeeting } from './TimelineMeeting';

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
    emptyText?: string;
    selectedId?: string | null;
    /** Free windows of this day (empty when the setting is off); a click starts a meeting there. */
    free?: Span[];
}

export function Timeline({
    events,
    day,
    now,
    workday,
    t,
    lang,
    onOpen,
    onJoin,
    noteIds,
    emptyText,
    selectedId,
    free = [],
}: Props) {
    const noted = useMemo(() => new Set(noteIds), [noteIds]);
    const ref = useRef<HTMLDivElement>(null);
    const isToday = sameDay(day, now);
    const blocks = useMemo(() => layoutDay(events, day), [events, day]);
    const paged = usesMeetingPages(blocks);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    // The working day, widened to keep every meeting (and "now", today) in view.
    const range0 = useMemo(
        () => visibleRange(blocks, workday, isToday ? nowMin : undefined),
        [blocks, workday, isToday, nowMin],
    );
    const y = (min: number) => ((min - range0.startMin) * HOUR) / 60;

    // Scroll to an hour before the first meeting (or an hour before now).
    const scrollTarget = useMemo(() => {
        const anchors = [...blocks.map((b) => b.startMin)];
        const first = isToday
            ? Math.min(
                  nowMin,
                  ...(anchors.length ? anchors.filter((m) => m + 60 >= nowMin) : [nowMin]),
              )
            : (anchors[0] ?? range0.startMin);
        return Math.max(0, y(first - 60));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Reposition only when the selected meeting changes, preserving manual scrolling.
    }, [blocks, isToday, nowMin, range0.startMin]);

    const dayKey = day.toDateString();
    useLayoutEffect(() => {
        if (ref.current) ref.current.scrollTop = scrollTarget;
        // Only when switching day or when the content first arrives, not on every tick.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Reposition only when the selected meeting changes, preserving manual scrolling.
    }, [dayKey, blocks.length === 0, paged]);

    useLayoutEffect(() => {
        const block = blocks.find((item) => item.event.id === selectedId);
        if (block && ref.current) ref.current.scrollTop = Math.max(0, y(block.startMin - 60));
        // A selection scrolls once; background sync and clock ticks preserve the person's scroll position.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Reposition only when the selected meeting changes, preserving manual scrolling.
    }, [selectedId, dayKey, paged]);

    useEffect(() => {
        // keep layout stable on resize
    }, []);

    if (paged) {
        return (
            <DenseDayTimeline
                key={dayKey}
                blocks={blocks}
                nowMin={isToday ? nowMin : undefined}
                noted={noted}
                t={t}
                lang={lang}
                onOpen={onOpen}
                onJoin={onJoin}
                selectedId={selectedId}
            />
        );
    }

    const firstHour = range0.startMin / 60;
    const lastHour = range0.endMin / 60;
    const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
    const currentSlotStart = Math.floor(nowMin / 30) * 30;

    return (
        <div className='timeline scroll' ref={ref} role='list' aria-label={t.meetingList}>
            {!blocks.length && (
                <div className='empty' style={{ position: 'absolute', inset: 0 }}>
                    {emptyText ?? t.noMeetings}
                </div>
            )}
            <div
                className='tl-inner'
                style={{ height: (lastHour - firstHour) * HOUR + 12, marginTop: 10 }}
            >
                {isToday && (
                    <div
                        className='tl-slot'
                        style={{ top: y(currentSlotStart), height: HOUR / 2 }}
                    />
                )}
                {hours.map((h) => (
                    <div key={h}>
                        <div className='tl-hour tnum' style={{ top: y(h * 60) }}>
                            {String(h % 24).padStart(2, '0')}:00
                        </div>
                        <div className='tl-line' style={{ top: y(h * 60) }} />
                        <div className='tl-line half' style={{ top: y(h * 60) + HOUR / 2 }} />
                    </div>
                ))}
                <FreeBlocks free={free} day={day} y={y} hourPx={HOUR} t={t} lang={lang} />
                {blocks.map((b) => {
                    const height = Math.max(22, ((b.endMin - b.startMin) * HOUR) / 60 - 2);
                    const colW = `calc((100% - 56px) / ${b.lanes})`;
                    return (
                        <TimelineMeeting
                            key={b.event.id}
                            block={b}
                            noted={noted}
                            t={t}
                            lang={lang}
                            onOpen={onOpen}
                            onJoin={onJoin}
                            selectedId={selectedId}
                            past={isToday && b.endMin <= nowMin}
                            height={height}
                            style={{
                                top: y(b.startMin) + 1,
                                height,
                                left: `calc(56px + ${colW} * ${b.lane} + 1px)`,
                                width: `calc(${colW} - 3px)`,
                            }}
                        />
                    );
                })}
                {isToday && <div className='tl-now' style={{ top: y(nowMin) }} />}
            </div>
        </div>
    );
}
