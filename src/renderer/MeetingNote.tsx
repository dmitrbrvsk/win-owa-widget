import * as React from 'react';
// The person's own note on a meeting. It is saved by itself a moment after typing stops (and when the
// card is closed), and it is stored on this computer only: nothing here is sent to the server.
import { useCallback, useEffect, useRef, useState } from 'react';

import { type Dict } from '../shared/i18n';
import { MAX_NOTE } from '../shared/limits';

import { api } from './api';
import { ipcMessage } from './hooks';

const SAVE_DELAY_MS = 700;

interface Props {
    eventId: string;
    t: Dict;
}

export function MeetingNote(props: Props) {
    return <MeetingNoteEditor key={props.eventId} {...props} />;
}

// A separate editor per event keeps note loading and pending saves bound to that event.
function MeetingNoteEditor({ eventId, t }: Props) {
    const [text, setText] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [error, setError] = useState('');
    /** Unsaved text for the meeting the card shows; null when there is nothing waiting. */
    const waiting = useRef<{ id: string; text: string } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const flush = useCallback(async () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = undefined;
        const job = waiting.current;
        if (!job) return;
        waiting.current = null;
        setStatus('saving');
        try {
            await api.setNote(job.id, job.text);
            setStatus('saved');
            setError('');
        } catch (e) {
            setStatus('error');
            setError(ipcMessage(e));
        }
    }, []);

    // Load the note of the meeting on show; save what is waiting for the previous one first.
    useEffect(() => {
        let alive = true;
        api.getNote(eventId)
            .then((value) => {
                if (!alive) return;
                setText(value);
                setLoaded(true);
            })
            .catch(() => alive && setLoaded(true));
        return () => {
            alive = false;
            void flush();
        };
    }, [eventId, flush]);

    function change(value: string) {
        setText(value);
        setStatus('idle');
        waiting.current = { id: eventId, text: value };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            void flush();
        }, SAVE_DELAY_MS);
    }

    return (
        <React.Fragment>
            <div className='section-title note-title'>
                <span className='grow'>{t.noteTitle}</span>
                <span
                    className={`hint note-status${status === 'error' ? ' bad' : ''}`}
                    role='status'
                >
                    {
                        { idle: '', saving: t.noteSaving, saved: t.noteSaved, error: t.noteFailed }[
                            status
                        ]
                    }
                </span>
            </div>
            <textarea
                className='field wide note-text'
                value={text}
                maxLength={MAX_NOTE}
                rows={4}
                disabled={!loaded}
                placeholder={t.notePlaceholder}
                aria-label={t.noteTitle}
                onChange={(e) => change(e.target.value)}
                onBlur={() => {
                    void flush();
                }}
            />
            {status === 'error' && error && <div className='field-error'>{error}</div>}
        </React.Fragment>
    );
}
