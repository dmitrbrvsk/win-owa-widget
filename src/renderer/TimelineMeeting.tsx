import * as React from 'react';

import { displayTitle, isEffectivelyCancelled, joinUrlForActions } from '../shared/events';
import { range } from '../shared/format';
import { type Dict, type Lang } from '../shared/i18n';
import { type TimelineBlock } from '../shared/timeline';
import { type CalendarEvent } from '../shared/types';

import { eventColor, joinHost } from './hooks';
import { Icon } from './icons';
import { meetingMenuProps } from './meetingMenu';

interface Props {
    block: TimelineBlock;
    noted: Set<string>;
    t: Dict;
    lang: Lang;
    onOpen: (event: CalendarEvent) => void;
    onJoin: (event: CalendarEvent) => void;
    selectedId?: string | null;
    past: boolean;
    height?: number;
    style?: React.CSSProperties;
    dense?: boolean;
    position?: number;
    total?: number;
}

function meetingClasses({
    block,
    dense,
    selectedId,
    past,
}: Pick<Props, 'block' | 'dense' | 'selectedId' | 'past'>): string {
    const e = block.event;
    return [
        'blk',
        dense ? 'dense-day-row' : '',
        selectedId === e.id ? 'selected' : '',
        past ? 'past' : '',
        isEffectivelyCancelled(e) ? 'cancelled' : '',
        e.responseType === 'tentative' ? 'tentative' : '',
        e.responseType === 'declined' ? 'declined' : '',
        !dense && block.lanes > 1 ? 'compact' : '',
    ]
        .filter(Boolean)
        .join(' ');
}

export function TimelineMeeting({
    block,
    noted,
    t,
    lang,
    onOpen,
    onJoin,
    selectedId,
    past,
    height = 60,
    style,
    dense = false,
    position,
    total,
}: Props) {
    const e = block.event;
    const when = range(e.start, e.end, lang);
    const link = joinUrlForActions(e);
    // Show an unfamiliar host before opening it, as in the timeline grid.
    const host = joinHost(e.platform, link);
    const joinLabel = host ? `${t.join} · ${host}` : t.join;
    const short = height < 40;
    return (
        <div
            className={meetingClasses({ block, dense, selectedId, past })}
            style={{ ...style, ['--c' as string]: eventColor(e) }}
            role='listitem'
            aria-posinset={position}
            aria-setsize={total}
            {...meetingMenuProps(e.id)}
        >
            <button
                type='button'
                className={dense ? 'dense-day-main' : undefined}
                style={
                    dense
                        ? undefined
                        : {
                              position: 'absolute',
                              inset: 0,
                              textAlign: 'left',
                              padding: '3px 28px 0 11px',
                              width: '100%',
                          }
                }
                onClick={() => onOpen(e)}
                aria-label={`${displayTitle(e)}, ${when}`}
            >
                <div className='t nowrap'>
                    {displayTitle(e)}
                    {noted.has(e.id) && (
                        <span className='note-mark' title={t.noteMarker} aria-label={t.noteMarker}>
                            <Icon name='pencil' size={11} color='currentColor' />
                        </span>
                    )}
                </div>
                <div className='m nowrap tnum'>
                    {when}
                    {host && (
                        <React.Fragment>
                            {' · '}
                            <span className='join-host'>{host}</span>
                        </React.Fragment>
                    )}
                    {short ? '' : e.organizer ? ` · ${e.organizer}` : ''}
                    {e.isOrganizer && !short && (dense || block.lanes === 1) && (
                        <React.Fragment>
                            {' '}
                            <span className='badge'>{t.organizerBadge}</span>
                        </React.Fragment>
                    )}
                </div>
            </button>
            {link && (
                <button
                    type='button'
                    className='join-dot'
                    onClick={() => onJoin(e)}
                    title={joinLabel}
                    aria-label={`${joinLabel}: ${displayTitle(e)}`}
                >
                    <Icon name='joinCircle' size={18} color='currentColor' />
                </button>
            )}
        </div>
    );
}
