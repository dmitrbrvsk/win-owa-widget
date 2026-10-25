// Free windows and long runs of meetings on the day view. Computed from the meetings already loaded,
// in the window itself: nothing is asked of the server.
import * as React from 'react';
import { useMemo } from 'react';

import { duration, range } from '../shared/format';
import { freeWindows, longStretch, type Span, spanMinutes } from '../shared/freeTime';
import { type Dict, type Lang } from '../shared/i18n';
import { type Workday } from '../shared/timeline';
import { type CalendarEvent } from '../shared/types';

import { api } from './api';
import { Icon } from './icons';

const iso = (ms: number) => new Date(ms).toISOString();

/** A free window becomes a meeting of at most an hour from its start: a long gap is not a long meeting. */
export function createInWindow(w: Span): void {
    void api.openCreateMeeting({
        start: iso(w.start),
        end: iso(Math.min(w.end, w.start + 3_600_000)),
    });
}

export function useFreeTime(
    enabled: boolean,
    events: CalendarEvent[],
    day: Date,
    workday: Workday,
    now: Date,
): { free: Span[]; stretch?: Span } {
    // Recomputed once a minute at most: the clock moves the start of today's first window.
    const minute = Math.floor(now.getTime() / 60_000);
    const dayKey = day.getTime();
    const { startHour, endHour } = workday;
    return useMemo(() => {
        if (!enabled) return { free: [] };
        const at = new Date(minute * 60_000);
        const d = new Date(dayKey);
        const work = { startHour, endHour };
        return { free: freeWindows(events, d, work, at), stretch: longStretch(events, d, at) };
    }, [enabled, events, dayKey, startHour, endHour, minute]);
}

/** The line above the timeline: the next free window today, and a warning about a long run. */
export function DayFree({
    free,
    stretch,
    isToday,
    workdayOver,
    t,
    lang,
}: {
    free: Span[];
    stretch?: Span;
    isToday: boolean;
    workdayOver: boolean;
    t: Dict;
    lang: Lang;
}) {
    const showNext = isToday && !workdayOver;
    if (!stretch && !showNext) return null;
    const next = free[0];
    return (
        <div className='dayfree'>
            {stretch && (
                <div className='dayfree-row warn' role='note'>
                    <Icon name='warning' size={14} />
                    <span className='grow'>
                        {t.longStretch(
                            duration(spanMinutes(stretch), t),
                            range(iso(stretch.start), iso(stretch.end), lang),
                        )}
                    </span>
                </div>
            )}
            {showNext && (
                <div className='dayfree-row'>
                    <Icon name='clock' size={14} />
                    {next ? (
                        <React.Fragment>
                            <span className='grow tnum'>
                                {t.freeNext(
                                    range(iso(next.start), iso(next.end), lang),
                                    duration(spanMinutes(next), t),
                                )}
                            </span>
                            <button
                                type='button'
                                className='icon-btn'
                                title={t.freeCreate}
                                aria-label={t.freeCreate}
                                onClick={() => createInWindow(next)}
                            >
                                <Icon name='plus' size={14} />
                            </button>
                        </React.Fragment>
                    ) : (
                        <span className='grow ter'>{t.freeNoneLeft}</span>
                    )}
                </div>
            )}
        </div>
    );
}

/** Free windows drawn on the timeline, under the meetings; a click starts a meeting there. */
export function FreeBlocks({
    free,
    day,
    y,
    hourPx,
    t,
    lang,
}: {
    free: Span[];
    day: Date;
    y: (min: number) => number;
    hourPx: number;
    t: Dict;
    lang: Lang;
}) {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    return (
        <React.Fragment>
            {free.map((w) => {
                const minutes = spanMinutes(w);
                const height = Math.max(16, (minutes * hourPx) / 60 - 2);
                const text = `${t.freeBlock} · ${duration(minutes, t)}`;
                return (
                    <button
                        type='button'
                        key={w.start}
                        className='free-blk'
                        style={{ top: y((w.start - dayStart) / 60_000) + 1, height }}
                        title={`${text}. ${t.freeCreate}`}
                        aria-label={`${text}, ${range(iso(w.start), iso(w.end), lang)}. ${t.freeCreate}`}
                        onClick={() => createInWindow(w)}
                    >
                        {height >= 22 && <span className='nowrap'>{text}</span>}
                    </button>
                );
            })}
        </React.Fragment>
    );
}
