import { useLayoutEffect, useRef, useState } from 'react';

import { type Dict } from '../shared/i18n';
import { meetingPage, meetingPageForId } from '../shared/meetingPages';

export function useMeetingPage<T extends { id: string }>(items: T[], selectedId?: string | null) {
    const [requestedPage, setPage] = useState(() => meetingPageForId(items, selectedId));
    const previousSelection = useRef(selectedId);
    useLayoutEffect(() => {
        if (previousSelection.current === selectedId) return;
        previousSelection.current = selectedId;
        setPage(meetingPageForId(items, selectedId));
    }, [items, selectedId]);
    return { ...meetingPage(items, requestedPage), setPage };
}

interface Props {
    total: number;
    start: number;
    end: number;
    page: number;
    pages: number;
    setPage: (page: number) => void;
    t: Dict;
    label?: string;
}

export function MeetingPager({ total, start, end, page, pages, setPage, t, label }: Props) {
    return (
        <div className='meeting-pages' role='group' aria-label={label ?? t.meetingList}>
            <div className='meeting-page-count tnum' role='status' aria-live='polite'>
                {t.meetingPageRange(start, end, total)}
                <span>{t.meetingPageNumber(page + 1, pages)}</span>
            </div>
            <button
                type='button'
                className='btn compact'
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
            >
                {t.meetingPreviousPage}
            </button>
            <button
                type='button'
                className='btn compact'
                disabled={page + 1 === pages}
                onClick={() => setPage(page + 1)}
            >
                {t.meetingNextPage}
            </button>
        </div>
    );
}
