import { useLayoutEffect, useRef, useState } from 'react';

import { isEffectivelyCancelled, sameDay } from '../shared/events';
import { range } from '../shared/format';
import { MEETINGS_PER_PAGE } from '../shared/meetingPages';
import { privateEvent } from '../shared/privacy';
import { type Snapshot } from '../shared/types';

import { api } from './api';
import { ipcMessage, useI18n } from './hooks';
import { Icon } from './icons';
import { MeetingPager, useMeetingPage } from './MeetingPager';

/** A separate view unmounts detail panels, drafts, notes and suggestions in every open window. */
export function PrivateCalendar({ snap }: { snap: Snapshot }) {
    const { t, lang } = useI18n(snap);
    const [day, setDay] = useState(() => new Date());
    const [error, setError] = useState('');
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const events = snap.events
        .map((e) => privateEvent(e, lang))
        .filter(
            (e) =>
                sameDay(new Date(e.start), day) ||
                (Date.parse(e.start) < end && Date.parse(e.end) > start),
        )
        .toSorted(
            (a, b) => Number(b.isAllDay) - Number(a.isAllDay) || a.start.localeCompare(b.start),
        );
    const page = useMeetingPage(events);
    const rows = useRef<HTMLDivElement>(null);
    const dayKey = day.toDateString();
    useLayoutEffect(() => {
        if (rows.current) rows.current.scrollTop = 0;
    }, [page.page, dayKey]);
    const shift = (n: number) => {
        setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
        page.setPage(0);
    };
    return (
        <main className='private-calendar'>
            <header className='privacy-banner'>
                <Icon name='lock' size={22} />
                <div>
                    <strong>{t.privacyActive}</strong>
                    <p className='hint'>{t.privacyActiveHint}</p>
                </div>
                <button
                    type='button'
                    className='icon-btn'
                    aria-label={t.close}
                    title={t.close}
                    onClick={() => {
                        void api.closeWindow();
                    }}
                >
                    <Icon name='x' />
                </button>
            </header>
            <button
                type='button'
                className='btn'
                onClick={() => {
                    void api.setPrivacyMode(false).catch((e) => setError(ipcMessage(e)));
                }}
            >
                {t.privacyOff}
            </button>
            {error && (
                <p role='alert' className='msg bad'>
                    {error}
                </p>
            )}
            <nav className='privacy-nav' aria-label={t.today}>
                <button
                    type='button'
                    className='icon-btn'
                    aria-label={t.prevDay}
                    onClick={() => shift(-1)}
                >
                    <Icon name='chevL' />
                </button>
                <strong>
                    {day.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        weekday: 'short',
                    })}
                </strong>
                <button
                    type='button'
                    className='icon-btn'
                    aria-label={t.nextDay}
                    onClick={() => shift(1)}
                >
                    <Icon name='chevR' />
                </button>
            </nav>
            {events.length > MEETINGS_PER_PAGE && <MeetingPager {...page} t={t} />}
            <div className='private-events' role='list' aria-label={t.meetingList} ref={rows}>
                {events.length ? (
                    page.items.map((e, index) => (
                        <div
                            className={`private-event${isEffectivelyCancelled(e) ? ' cancelled' : ''}`}
                            key={e.id}
                            role='listitem'
                            aria-posinset={page.start + index}
                            aria-setsize={page.total}
                        >
                            <span className='tnum'>
                                {e.isAllDay ? t.allDay : range(e.start, e.end, lang)}
                            </span>
                            <strong>
                                {isEffectivelyCancelled(e)
                                    ? t.cancelled
                                    : e.responseType === 'declined'
                                      ? t.conflictDeclined
                                      : e.responseType === 'tentative'
                                        ? t.tentative
                                        : t.privacyBusy}
                            </strong>
                        </div>
                    ))
                ) : (
                    <div className='empty'>{t.noMeetings}</div>
                )}
            </div>
        </main>
    );
}
