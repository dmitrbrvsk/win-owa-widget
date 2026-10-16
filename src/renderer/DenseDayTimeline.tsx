import { useLayoutEffect, useMemo, useRef } from 'react';

import { type Dict, type Lang } from '../shared/i18n';
import { type TimelineBlock } from '../shared/timeline';
import { type CalendarEvent } from '../shared/types';

import { MeetingPager, useMeetingPage } from './MeetingPager';
import { TimelineMeeting } from './TimelineMeeting';

interface Props {
    blocks: TimelineBlock[];
    nowMin?: number;
    noted: Set<string>;
    t: Dict;
    lang: Lang;
    onOpen: (event: CalendarEvent) => void;
    onJoin: (event: CalendarEvent) => void;
    selectedId?: string | null;
}

export function DenseDayTimeline({
    blocks,
    nowMin,
    noted,
    t,
    lang,
    onOpen,
    onJoin,
    selectedId,
}: Props) {
    const events = useMemo(() => blocks.map((block) => block.event), [blocks]);
    const page = useMeetingPage(events, selectedId);
    const rows = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!rows.current) return;
        const selected = rows.current.querySelector<HTMLElement>('.selected');
        rows.current.scrollTop = selected ? Math.max(0, selected.offsetTop - 8) : 0;
    }, [page.page, selectedId]);
    const offset = page.start - 1;

    return (
        <div className='timeline dense-day'>
            <p className='dense-day-hint'>{t.timelineDenseDay}</p>
            <MeetingPager {...page} t={t} />
            <div
                className='dense-day-rows scroll'
                role='list'
                aria-label={t.meetingList}
                ref={rows}
            >
                {page.items.map((event, index) => {
                    const block = blocks[offset + index];
                    return (
                        <TimelineMeeting
                            key={event.id}
                            block={block}
                            noted={noted}
                            t={t}
                            lang={lang}
                            onOpen={onOpen}
                            onJoin={onJoin}
                            selectedId={selectedId}
                            past={nowMin !== undefined && block.endMin <= nowMin}
                            dense={true}
                            position={offset + index + 1}
                            total={page.total}
                        />
                    );
                })}
            </div>
        </div>
    );
}
