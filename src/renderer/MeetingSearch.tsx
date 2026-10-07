// The search field in the popup header and the list of results. The matching itself is in
// shared/search.ts; everything here happens in this window, nothing is sent anywhere.
import { useEffect, type RefObject } from 'react';
import type { CalendarEvent } from '../shared/types';
import { displayTitle, isEffectivelyCancelled, joinUrlForActions, startOfDay } from '../shared/events';
import { DEFAULT_LIMIT, MAX_QUERY_LENGTH } from '../shared/search';
import { range, shortDay } from './format';
import { eventColor, joinHost } from './hooks';
import type { Dict, Lang } from './i18n';
import { Icon } from './icons';
import { meetingMenuProps } from './meetingMenu';

const RESULTS_ID = 'search-results';
export const optionId = (i: number) => `search-option-${i}`;

interface BoxProps {
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  /** Arrow keys move the highlighted result, Enter opens it. */
  onStep: (delta: 1 | -1) => void;
  onEnter: () => void;
  activeIndex: number;
  hasResults: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  t: Dict;
}

/** Takes the place of the title in the popup header. */
export function SearchBox({ query, onQuery, onClose, onStep, onEnter, activeIndex, hasResults, inputRef, t }: BoxProps) {
  return (
    <div className="searchbox" role="search">
      <Icon name="search" size={15} color="var(--fg2)" />
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        role="combobox"
        aria-label={t.searchPlaceholder}
        aria-autocomplete="list"
        aria-controls={hasResults ? RESULTS_ID : undefined}
        aria-expanded={hasResults}
        aria-activedescendant={hasResults ? optionId(activeIndex) : undefined}
        placeholder={t.searchPlaceholder}
        value={query}
        maxLength={MAX_QUERY_LENGTH}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        onChange={(ev) => onQuery(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.nativeEvent.isComposing) return;
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            onStep(ev.key === 'ArrowDown' ? 1 : -1);
          } else if (ev.key === 'Enter') {
            ev.preventDefault();
            onEnter();
          }
        }}
      />
      <button className="icon-btn small" onClick={onClose} title={t.searchClose} aria-label={t.searchClose}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Сегодня", "Завтра", "Вчера", otherwise "Пт, 9 окт". */
function dayLabel(iso: string, today: Date, t: Dict, lang: Lang): string {
  const diff = Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(today).getTime()) / 86_400_000);
  if (diff === 0) return t.today;
  if (diff === 1) return t.tomorrow;
  if (diff === -1) return t.yesterday;
  return capFirst(shortDay(iso, lang).replace(/\.$/, ''));
}

interface ResultsProps {
  query: string;
  results: CalendarEvent[];
  activeIndex: number;
  now: Date;
  t: Dict;
  lang: Lang;
  onOpen: (e: CalendarEvent) => void;
  onJoin: (e: CalendarEvent) => void;
}

/** Fills the popup body while the search is open. Rows are in relevance order, so each one carries its own day. */
export function SearchResults({ query, results, activeIndex, now, t, lang, onOpen, onJoin }: ResultsProps) {
  const asking = query.trim().length > 0;

  // Arrow keys can move the highlight out of view. Not on every refresh of the list: the clock ticks
  // would pull it back while the person scrolls.
  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // One live region for all three states, kept in place so that a screen reader announces its changes.
  const status = !asking ? '' : results.length ? t.searchFound(results.length) : t.searchNothing;
  const live = (
    <div className="sr-only" role="status">
      {status}
    </div>
  );

  if (!asking) {
    return (
      <>
        {live}
        <div className="search-results">
          <div className="empty">{t.searchHint}</div>
        </div>
      </>
    );
  }
  if (!results.length) {
    return (
      <>
        {live}
        <div className="search-results">
          <div className="empty">{t.searchNothing}</div>
        </div>
      </>
    );
  }

  return (
    <>
      {live}
      {/* Keyed by the query: a new query starts at the top of its list. */}
      <div className="search-results scroll" key={query}>
        <div id={RESULTS_ID} role="listbox" aria-label={t.searchResults}>
          {results.map((e, i) => {
            const link = joinUrlForActions(e);
            const cancelled = isEffectivelyCancelled(e);
            const past = Date.parse(e.end) <= now.getTime();
            const when = e.isAllDay ? t.allDay : range(e.start, e.end, lang);
            const day = dayLabel(e.start, now, t, lang);
            const detail = [e.organizer, e.location].filter(Boolean).join(' · ');
            // A link to anything but a known service: its host is the only thing that tells an invitation
            // from a stranger apart from a real one, so it is shown before the link is opened.
            const host = joinHost(e.platform, link);
            const joinLabel = host ? `${t.join} · ${host}` : t.join;
            return (
              <div
                key={e.id}
                className={`sr-row${i === activeIndex ? ' active' : ''}${past ? ' past' : ''}${cancelled ? ' cancelled' : ''}${e.responseType === 'declined' ? ' declined' : ''}`}
                style={{ ['--c' as string]: eventColor(e) }}
                {...meetingMenuProps(e.id)}
              >
                <button
                  id={optionId(i)}
                  className="sr-main"
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === activeIndex}
                  aria-label={[displayTitle(e), `${day}, ${when}`, e.organizer, cancelled ? t.cancelled : ''].filter(Boolean).join(', ')}
                  onClick={() => onOpen(e)}
                >
                  <span className="sr-when tnum">
                    <span className="nowrap">{day}</span>
                    <span className="nowrap">{when}</span>
                  </span>
                  <span className="sr-what">
                    <span className="sr-title nowrap">{displayTitle(e)}</span>
                    <span className="sr-meta nowrap">
                      {cancelled && <span className="sr-cancelled">{t.cancelled}</span>}
                      {cancelled && (host || detail) ? ' · ' : ''}
                      {host && <span className="join-host">{host}</span>}
                      {host && detail ? ' · ' : ''}
                      {detail}
                    </span>
                  </span>
                </button>
                {link && (
                  <button className="sr-join" onClick={() => onJoin(e)} title={joinLabel} aria-label={`${joinLabel}: ${displayTitle(e)}`}>
                    <Icon name="joinCircle" size={20} color="currentColor" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {results.length >= DEFAULT_LIMIT && <div className="sr-note">{t.searchLimited(results.length)}</div>}
      </div>
    </>
  );
}
