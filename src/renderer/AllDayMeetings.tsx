import { useLayoutEffect, useRef } from 'react';

import { displayTitle } from '../shared/events';
import { type Dict } from '../shared/i18n';
import { MEETINGS_PER_PAGE } from '../shared/meetingPages';
import { type CalendarEvent } from '../shared/types';

import { eventColor } from './hooks';
import { meetingMenuProps } from './meetingMenu';
import { MeetingPager, useMeetingPage } from './MeetingPager';

interface Props {
    events: CalendarEvent[];
    t: Dict;
    onOpen: (event: CalendarEvent) => void;
    selectedId?: string | null;
}

export function AllDayMeetings({ events, t, onOpen, selectedId }: Props) {
    const page = useMeetingPage(events, selectedId);
    const rows = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!rows.current) return;
        const selected = rows.current.querySelector<HTMLElement>('.selected');
        rows.current.scrollTop = selected ? Math.max(0, selected.offsetTop - 4) : 0;
    }, [page.page, selectedId]);
    if (!events.length) return null;
    const paged = events.length > MEETINGS_PER_PAGE;
    const pills = (
        <div className='pills'>
            {page.items.map((event) => (
                <button
                    type='button'
                    key={event.id}
                    className={`pill nowrap${selectedId === event.id ? ' selected' : ''}`}
                    style={{ ['--c' as string]: eventColor(event) }}
                    onClick={() => onOpen(event)}
                    {...meetingMenuProps(event.id)}
                >
                    {displayTitle(event)}
                </button>
            ))}
        </div>
    );
    return (
        <div className={`allday${paged ? ' allday-paged' : ''}`}>
            <span className='gutter'>{t.allDay}</span>
            {paged ? (
                <div className='allday-pages'>
                    <MeetingPager {...page} t={t} label={t.allDay} />
                    <div className='allday-pills scroll' ref={rows}>
                        {pills}
                    </div>
                </div>
            ) : (
                pills
            )}
        </div>
    );
}
