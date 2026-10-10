// The person's own note on a meeting. It is saved by itself a moment after typing stops (and when the
// card is closed), and it is stored on this computer only: nothing here is sent to the server.
import { useEffect, useRef, useState } from 'react';
import { MAX_NOTE } from '../shared/limits';
import { api } from './api';
import { ipcMessage } from './hooks';
import type { Dict } from '../shared/i18n';

const SAVE_DELAY_MS = 700;

interface Props {
  eventId: string;
  t: Dict;
}

export function MeetingNote({ eventId, t }: Props) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  /** Unsaved text for the meeting the card shows; null when there is nothing waiting. */
  const waiting = useRef<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function flush() {
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
  }

  // Load the note of the meeting on show; save what is waiting for the previous one first.
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setStatus('idle');
    setError('');
    api
      .getNote(eventId)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function change(value: string) {
    setText(value);
    setStatus('idle');
    waiting.current = { id: eventId, text: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  return (
    <>
      <div className="section-title note-title">
        <span className="grow">{t.noteTitle}</span>
        <span className={`hint note-status${status === 'error' ? ' bad' : ''}`} role="status">
          {status === 'saving' ? t.noteSaving : status === 'saved' ? t.noteSaved : status === 'error' ? t.noteFailed : ''}
        </span>
      </div>
      <textarea
        className="field wide note-text"
        value={text}
        maxLength={MAX_NOTE}
        rows={4}
        disabled={!loaded}
        placeholder={t.notePlaceholder}
        aria-label={t.noteTitle}
        onChange={(e) => change(e.target.value)}
        onBlur={() => void flush()}
      />
      {status === 'error' && error && <div className="field-error">{error}</div>}
    </>
  );
}
