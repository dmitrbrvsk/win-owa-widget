import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, CalendarSelection, Snapshot } from '../shared/types';
import { addDays, displayTitle, eventsOnDay, joinUrlForActions, startOfDay } from '../shared/events';
import { calendarDateValue, calendarView, dateOfCalendarDay } from '../shared/calendar';
import { dayTitle } from '../shared/format';
import { searchEvents } from '../shared/search';
import { api } from './api';
import { Detail } from './Detail';
import { Timeline } from './Timeline';
import { SearchBox, SearchResults } from './MeetingSearch';
import { Icon } from './icons';
import { eventColor, ipcMessage, useI18n, useNow } from './hooks';
import { meetingMenuProps } from './meetingMenu';

export function Calendar({ snap }: { snap: Snapshot }) {
  const { t, lang } = useI18n(snap);
  const now = useNow(15_000);
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeHit, setActiveHit] = useState(0);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const liveEvents = useRef(snap.events);
  liveEvents.current = snap.events;

  useEffect(() => {
    let alive = true;
    const apply = (selection: CalendarSelection | null) => {
      if (!alive) return;
      const view = calendarView(selection, liveEvents.current, new Date());
      setDay(view.day); setSelectedId(view.eventId); setQuery('');
    };
    const off = api.onCalendarSelection(apply);
    void api.getCalendarSelection().then(apply).catch(e => alive && setMessage(ipcMessage(e)));
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyF') {
        event.preventDefault(); input.current?.focus(); input.current?.select();
      }
    };
    window.addEventListener('keydown', find);
    return () => window.removeEventListener('keydown', find);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const dayEvents = useMemo(() => eventsOnDay(snap.events, day), [snap.events, day]);
  const allDay = dayEvents.filter(event => event.isAllDay);
  const selected = dayEvents.find(event => event.id === selectedId);
  const results = useMemo(() => searchEvents(snap.events, query, now), [snap.events, query, now]);
  const activeIndex = Math.max(0, Math.min(activeHit, results.length - 1));
  const searching = !!query.trim();

  function chooseDay(next: Date) { setDay(next); setSelectedId(null); setQuery(''); }
  function open(event: CalendarEvent) { setDay(startOfDay(new Date(event.start))); setSelectedId(event.id); setQuery(''); }
  function join(event: CalendarEvent) {
    const url = joinUrlForActions(event);
    if (url) void api.openUrl(url).catch(e => setMessage(ipcMessage(e)));
  }

  return <main className="calendar-view">
    <header className="calendar-toolbar">
      <div className="calendar-brand"><Icon name="calendar" size={24} /><div><h1>{t.calendarTitle}</h1><span className="hint">OWA Widget{snap.demo ? ` · ${t.demo}` : ''}</span></div></div>
      <div className="calendar-search" onKeyDownCapture={event => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery(''); } }}>
        <SearchBox query={query} onQuery={value => { setQuery(value); setActiveHit(0); }} onClose={() => setQuery('')} onStep={delta => results.length && setActiveHit((activeIndex + delta + results.length) % results.length)} onEnter={() => results[activeIndex] && open(results[activeIndex])} activeIndex={activeIndex} hasResults={searching && results.length > 0} inputRef={input} t={t} />
      </div>
      <div className="calendar-actions">
        <button className="btn primary" onClick={() => { void api.openCreateMeeting().catch(e => setMessage(ipcMessage(e))); }}><Icon name="plus" />{t.createMeeting}</button>
        <button className="icon-btn" title={t.findTime} aria-label={t.findTime} onClick={() => { void api.openAvailability().catch(e => setMessage(ipcMessage(e))); }}><Icon name="findTime" /></button>
        <button className="icon-btn" title={t.privacyOn} aria-label={t.privacyOn} onClick={() => { void api.setPrivacyMode(true).catch(e => setMessage(ipcMessage(e))); }}><Icon name="lock" /></button>
        <button className="icon-btn" title={t.settings} aria-label={t.settings} onClick={() => { void api.openSettings().catch(e => setMessage(ipcMessage(e))); }}><Icon name="gear" /></button>
      </div>
    </header>
    <div className="calendar-datebar">
      <button className="icon-btn" title={t.prevDay} aria-label={t.prevDay} onClick={() => chooseDay(addDays(day, -1))}><Icon name="chevL" /></button>
      <button className="icon-btn" title={t.nextDay} aria-label={t.nextDay} onClick={() => chooseDay(addDays(day, 1))}><Icon name="chevR" /></button>
      <h2>{dayTitle(day, startOfDay(now), t, lang)}</h2>
      <input className="field calendar-date" type="date" min="1970-01-01" max="2200-12-31" value={calendarDateValue(day)} aria-label={t.calendarPickDay} onChange={event => { if (event.target.value && event.target.validity.valid) chooseDay(dateOfCalendarDay(event.target.value)); }} />
      <button className="btn compact" onClick={() => chooseDay(startOfDay(new Date()))}>{t.today}</button>
      <span className="grow" />
      <span className="hint calendar-count">{t.calendarDayCount(dayEvents.length)}</span>
    </div>
    <div className="calendar-columns">
      <section className="calendar-schedule" aria-label={searching ? t.searchResults : t.calendarTitle}>
        {searching ? <SearchResults query={query} results={results} activeIndex={activeIndex} now={now} t={t} lang={lang} onOpen={open} onJoin={join} /> : <>
          {allDay.length > 0 && <div className="allday"><span className="gutter">{t.allDay}</span><div className="pills">{allDay.map(event => <button key={event.id} className={`pill nowrap${selectedId === event.id ? ' selected' : ''}`} style={{ ['--c' as string]: eventColor(event) }} onClick={() => open(event)} {...meetingMenuProps(event.id)}>{displayTitle(event)}</button>)}</div></div>}
          <Timeline events={dayEvents} day={day} now={now} workday={{ startHour: snap.settings.workdayStartHour, endHour: snap.settings.workdayEndHour }} t={t} lang={lang} onOpen={open} onJoin={join} noteIds={snap.noteIds} emptyText={t.calendarEmptyDay} selectedId={selectedId} />
        </>}
      </section>
      <aside className="calendar-inspector" aria-label={selected ? displayTitle(selected) : t.calendarChooseMeeting}>
        {selected ? <Detail key={selected.id} event={selected} events={snap.events} t={t} lang={lang} onClose={() => setSelectedId(null)} onJoin={join} toast={setMessage} /> : <div className="calendar-placeholder"><Icon name="calendar" size={40} /><h2>{t.calendarChooseMeeting}</h2><p>{t.calendarChooseHint}</p></div>}
      </aside>
    </div>
    <footer className="calendar-footer"><span className="hint">{t.calendarLoadedHint}</span><span className="grow" />{snap.sync.phase === 'error' && <span className="msg bad" role="status">{snap.sync.error}</span>}{snap.sync.phase === 'syncing' && <span className="hint" role="status">{t.syncing}</span>}<button className="icon-btn small" title={t.refresh} aria-label={t.refresh} disabled={snap.sync.phase === 'syncing'} onClick={() => { void api.syncNow().catch(e => setMessage(ipcMessage(e))); }}><Icon name="refresh" /></button><span className="ter">v{snap.version}</span></footer>
    {message && <div className="toast" role="status">{message}</div>}
  </main>;
}
