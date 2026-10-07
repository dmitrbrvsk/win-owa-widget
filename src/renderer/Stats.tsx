// Meeting statistics: how much time the meetings of a period take and with whom it is spent. The
// window asks the main process for the meetings of the period (one calendar view) and leaves every
// number to src/shared/stats.ts, so what is here is layout only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, Snapshot, StatsRequest } from '../shared/types';
import { meetingStats, statsPeriod, STATS_PERIODS, type MeetingStats, type StatsDay, type StatsPeriodKind } from '../shared/stats';
import { api } from './api';
import { Alert } from './Alert';
import { duration } from '../shared/format';
import { ipcMessage, useI18n, useNow } from './hooks';
import { Icon } from './icons';
import type { Dict, Lang } from '../shared/i18n';

const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'ru-RU');
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Hours as the app writes durations everywhere else: "3 ч 30 мин". */
const hoursText = (hours: number, t: Dict) => duration(Math.round(hours * 60), t);

/** "Чт 8 окт" */
function dayLabel(ms: number, lang: Lang): string {
  const d = new Date(ms);
  const wd = d.toLocaleDateString(locale(lang), { weekday: 'short' }).replace('.', '');
  const dm = d.toLocaleDateString(locale(lang), { day: 'numeric', month: 'short' }).replace('.', '');
  return `${capital(wd)} ${dm}`;
}

/** "5–11 окт 2026": the period's own dates, so it is clear what the numbers are about. The end is exclusive. */
function periodLabel(start: number, end: number, lang: Lang): string {
  const from = new Date(start);
  const to = new Date(end - 1);
  const month = (d: Date) => d.toLocaleDateString(locale(lang), { month: 'short' }).replace('.', '');
  return from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
    ? `${from.getDate()}–${to.getDate()} ${month(to)} ${to.getFullYear()}`
    : `${from.getDate()} ${month(from)} – ${to.getDate()} ${month(to)} ${to.getFullYear()}`;
}

const periodName = (p: StatsPeriodKind, t: Dict) => (p === 'lastWeek' ? t.statsLastWeek : p === 'last4Weeks' ? t.statsLast4Weeks : t.statsThisWeek);

function Metric({ label, value, hint, title }: { label: string; value: string; hint?: string; title?: string }) {
  return (
    <div className="st-metric" title={title}>
      <div className="st-value tnum">{value}</div>
      <div className="st-mlabel">{label}</div>
      {hint ? <div className="st-mhint ter">{hint}</div> : null}
    </div>
  );
}

/** Hours of meetings per day, as plain bars: no chart library, so nothing is drawn that the page cannot style. */
function DayChart({ days, t, lang, today }: { days: readonly StatsDay[]; t: Dict; lang: Lang; today: number }) {
  // The tallest bar sets the scale; a period with no hours in it must not divide by zero.
  const max = days.reduce((m, d) => Math.max(m, d.hours), 0) || 1;
  return (
    <div className={`st-chart${days.length > 14 ? ' dense' : ''}`} role="list">
      {days.map((d) => {
        const parts = [`${dayLabel(d.date, lang)}: ${d.hours > 0 ? hoursText(d.hours, t) : t.statsNothing}`];
        if (d.meetings) parts.push(t.statsMeetingsN(d.meetings));
        if (d.allDay) parts.push(t.statsAllDay);
        return (
          <div key={d.date} className={`st-col2${d.weekend ? ' weekend' : ''}${d.date === today ? ' today' : ''}`} role="listitem" aria-label={parts.join(', ')} title={parts.join(', ')}>
            <div className="st-slot">
              {/* A day with a few minutes in it still gets a visible sliver, not a bar rounded away to nothing. */}
              <div className="st-bar" style={{ height: `${d.hours > 0 ? Math.max(2, Math.round((d.hours / max) * 100)) : 0}%` }} />
            </div>
            {/* An all-day entry has no hours to draw, so the day is marked under the bar instead. */}
            <div className={`st-allday${d.allDay ? ' on' : ''}`} />
            <div className="st-dayh tnum">{d.hours >= 0.05 ? d.hours.toFixed(1) : ''}</div>
            <div className="st-dayd tnum">{new Date(d.date).getDate()}</div>
          </div>
        );
      })}
    </div>
  );
}

interface Row {
  key: string;
  name: string;
  hours: number;
  meetings: number;
}

/** A list of "name — share of the hours — hours and count": the people, the platforms, the responses. */
function Breakdown({ rows, t }: { rows: readonly Row[]; t: Dict }) {
  const max = rows.reduce((m, r) => Math.max(m, r.hours), 0) || 1;
  return (
    <ul className="st-rows">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="st-rname nowrap" title={r.name}>
            {r.name}
          </span>
          <span className="st-track" aria-hidden="true">
            <span className="st-fill" style={{ width: `${Math.round((r.hours / max) * 100)}%` }} />
          </span>
          <span className="st-rval tnum">{hoursText(r.hours, t)}</span>
          <span className="st-rcount tnum ter">{r.meetings}</span>
        </li>
      ))}
    </ul>
  );
}

export function Stats({ snap }: { snap: Snapshot }) {
  const { t, lang } = useI18n(snap);
  const now = useNow(60_000);
  const todayMs = useMemo(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), [now]);

  const [kind, setKind] = useState<StatsPeriodKind>('thisWeek');
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => statsPeriod(kind, new Date(todayMs)), [kind, todayMs]);
  const request = useMemo<StatsRequest>(() => ({ start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString() }), [period]);

  // One request at a time (the main process allows no more); a newer period waits and replaces
  // older ones in the queue, so clicking through the periods cannot pile requests on the server.
  const running = useRef(false);
  const queued = useRef<StatsRequest | null>(null);
  const run = useCallback(async (req: StatsRequest) => {
    if (running.current) {
      queued.current = req;
      return;
    }
    running.current = true;
    setLoading(true);
    try {
      const list = await api.getStatsEvents(req);
      if (!queued.current) {
        setEvents(list);
        setError(null);
      }
    } catch (e) {
      setError(ipcMessage(e));
    } finally {
      running.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) void run(next);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void run(request), 150);
    return () => clearTimeout(id);
  }, [request, run]);

  const stats: MeetingStats = useMemo(
    () => meetingStats(events ?? [], period, { workdayStartHour: snap.settings.workdayStartHour, workdayEndHour: snap.settings.workdayEndHour }),
    [events, period, snap.settings.workdayStartHour, snap.settings.workdayEndHour],
  );

  const people = useMemo<Row[]>(() => stats.people.slice(0, 8).map((p) => ({ key: p.key, name: p.name, hours: p.hours, meetings: p.meetings })), [stats.people]);
  const platforms = useMemo<Row[]>(() => stats.platforms.map((p) => ({ key: p.platform, name: t.statsPlatform[p.platform] ?? p.platform, hours: p.hours, meetings: p.meetings })), [stats.platforms, t]);
  const answers = useMemo<Row[]>(() => stats.responses.map((r) => ({ key: r.response, name: t.statsAnswerName[r.response] ?? r.response, hours: r.hours, meetings: r.meetings })), [stats.responses, t]);

  // Nothing counted at all: the breakdowns would be empty boxes, so one explanation stands instead.
  const nothing = stats.meetings === 0 && stats.allDayMeetings === 0;

  return (
    <div className="stats">
      <header className="st-head">
        <h1>{t.statsTitle}</h1>
        <p className="sec">{t.statsLead}</p>
      </header>

      {/* A failed request means the numbers below are not the truth: say so at the top. */}
      {error && (
        <div className="st-alert">
          <Alert title={t.statsFailed} action={{ label: t.retry, onClick: () => void run(request) }}>
            {error}
          </Alert>
        </div>
      )}

      <div className="st-nav">
        <div className="st-seg" role="radiogroup" aria-label={t.statsPeriod}>
          {STATS_PERIODS.map((p) => (
            <button key={p} role="radio" aria-checked={kind === p} className={`btn${kind === p ? ' on' : ''}`} onClick={() => setKind(p)}>
              {periodName(p, t)}
            </button>
          ))}
        </div>
        <div className="st-range tnum">{periodLabel(period.start, period.end, lang)}</div>
        <span className="grow" />
        {loading && (
          <span className="st-loading sec" role="status">
            <span className="spin" /> {t.statsLoading}
          </span>
        )}
        <button className="icon-btn" onClick={() => void run(request)} aria-label={t.statsReload} title={t.statsReload}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      <div className={`st-scroll scroll${loading ? ' busy' : ''}`}>
        <section className="st-metrics" aria-label={t.statsTitle}>
          <Metric label={t.statsTotal} value={hoursText(stats.hours, t)} hint={t.statsTotalHint(hoursText(stats.busyHours, t))} />
          <Metric label={t.statsShare} value={t.statsPercent(Math.round(stats.shareOfWork * 100))} hint={t.statsShareHint(hoursText(stats.workHours, t))} />
          <Metric label={t.statsCount} value={String(stats.meetings)} />
          <Metric label={t.statsAvg} value={stats.meetings ? hoursText(stats.avgMinutes / 60, t) : t.statsNothing} />
          <Metric
            label={t.statsLongest}
            value={stats.longestDay ? hoursText(stats.longestDay.hours, t) : t.statsNothing}
            hint={stats.longestDay ? dayLabel(stats.longestDay.date, lang) : undefined}
          />
          <Metric label={t.statsBackToBack} value={String(stats.backToBack)} hint={t.statsBackToBackHint} />
          <Metric label={t.statsFree} value={hoursText(stats.freeWorkHours, t)} />
          <Metric label={t.statsAllDay} value={stats.allDayDays ? t.statsDaysN(stats.allDayDays) : t.statsNothing} hint={t.statsAllDayHint(stats.allDayMeetings)} />
        </section>

        {nothing ? (
          <section className="st-card st-empty">
            <div>{t.statsEmpty}</div>
            <div className="hint sec">{t.statsEmptyHint}</div>
          </section>
        ) : (
          <>
            <section className="st-card">
              <h2>{t.statsPerDay}</h2>
              <DayChart days={stats.days} t={t} lang={lang} today={todayMs} />
            </section>

            <div className="st-cols">
              <section className="st-card">
                <h2>{t.statsWho}</h2>
                {people.length ? <Breakdown rows={people} t={t} /> : <div className="hint sec">{t.statsWhoEmpty}</div>}
                {stats.ownMeetings > 0 && (
                  <div className="st-own">
                    <span className="grow">{t.statsOwn}</span>
                    <span className="tnum">{hoursText(stats.ownHours, t)}</span>
                    <span className="tnum ter">{stats.ownMeetings}</span>
                  </div>
                )}
                <div className="st-note ter">{t.statsWhoHint}</div>
              </section>

              <div className="st-col">
                <section className="st-card">
                  <h2>{t.statsWhere}</h2>
                  <Breakdown rows={platforms} t={t} />
                </section>
                <section className="st-card">
                  <h2>{t.statsAnswer}</h2>
                  <Breakdown rows={answers} t={t} />
                </section>
              </div>
            </div>
          </>
        )}

        <div className="st-note ter">{t.statsCancelledNote}</div>
      </div>
    </div>
  );
}
