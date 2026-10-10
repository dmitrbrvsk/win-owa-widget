// "This overlaps your other meeting": shown on a meeting's card, before the person answers it.
// It reads only the calendar the widget already holds. Declining the other meeting is one more
// answer to its organizer, so it asks twice, in the button itself, before it goes.
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '../shared/types';
import { canDecline, conflictsOf, MAX_CONFLICTS_SHOWN } from '../shared/conflicts';
import { displayTitle } from '../shared/events';
import { range } from '../shared/format';
import { api } from './api';
import { Icon } from './icons';
import { ipcMessage } from './hooks';
import type { Dict, Lang } from '../shared/i18n';

interface Props {
  event: CalendarEvent;
  events: CalendarEvent[];
  t: Dict;
  lang: Lang;
  toast: (msg: string) => void;
  /** Collisions to show instead of computing them: the proposed time of a reply uses the same list. */
  conflicts?: CalendarEvent[];
  title?: string;
  /** No "Decline" buttons: the list only informs (the proposed time of a reply). */
  readonly?: boolean;
}

export function ConflictNote({ event, events, t, lang, toast, conflicts, title, readonly }: Props) {
  const found = useMemo(() => conflicts ?? conflictsOf(event, events), [conflicts, event, events]);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The second press has to follow the first closely: an armed button disarms itself.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!found.length) return null;
  const shown = found.slice(0, MAX_CONFLICTS_SHOWN);

  async function decline(other: CalendarEvent) {
    if (armed !== other.id) {
      setArmed(other.id);
      return;
    }
    setArmed(null);
    setBusy(true);
    try {
      await api.respond(other.id, 'decline');
      toast(t.conflictDeclined);
    } catch (e) {
      toast(ipcMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="conflict" role="note">
      <Icon name="warning" size={16} color="var(--warn)" />
      <div className="grow">
        <div className="conflict-title">{title ?? t.conflictTitle(found.length)}</div>
        {shown.map((c) => (
          <div className="conflict-row" key={c.id}>
            <span className="tnum conflict-when">{range(c.start, c.end, lang)}</span>
            <span className="grow nowrap" title={displayTitle(c)}>
              {displayTitle(c)}
            </span>
            {!readonly && canDecline(c) && (
              <button className={`btn compact${armed === c.id ? ' danger' : ''}`} disabled={busy} onClick={() => void decline(c)}>
                {armed === c.id ? t.conflictDeclineSure : t.conflictDecline}
              </button>
            )}
          </div>
        ))}
        {found.length > shown.length && <div className="sec">{t.conflictMore(found.length - shown.length)}</div>}
      </div>
    </div>
  );
}
