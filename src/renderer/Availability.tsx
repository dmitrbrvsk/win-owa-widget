// Free time search: who is free, tentative, busy or away across a week, and the best times for a meeting.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AvailabilityRequest, AvailabilityResult, Snapshot } from '../shared/types';
import { dedupeEmails, emailKey } from '../shared/email';
import { localPeople } from '../shared/meetingForm';
import {
  availabilityFromEvents,
  bestOptions,
  buildGrid,
  DURATIONS,
  MAX_PEOPLE,
  weekStart,
  weekWindow,
  type AvailabilityGrid,
  type MeetingDuration,
  type TimeOption,
} from '../shared/availability';
import { api } from './api';
import { Alert } from './Alert';
import { PeopleField } from './PeopleField';
import { ipcMessage, useI18n, useNow } from './hooks';
import { Icon } from './icons';
import type { Dict, Lang } from './i18n';

/** Width of one 30-minute column and of the name column, in px (also written to the page as CSS variables). */
const CELL = 14;
const NAME_W = 190;

const STATUS_ORDER = ['free', 'tentative', 'busy', 'oof', 'nodata'] as const;

const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'ru-RU');
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function hhmm(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Чт 8 окт" */
function dayLabel(ms: number, lang: Lang): string {
  const d = new Date(ms);
  const wd = d.toLocaleDateString(locale(lang), { weekday: 'short' }).replace('.', '');
  const dm = d.toLocaleDateString(locale(lang), { day: 'numeric', month: 'short' }).replace('.', '');
  return `${capital(wd)} ${dm}`;
}

/** "5–11 окт 2026" */
function weekLabel(start: Date, lang: Lang): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const month = (d: Date) => d.toLocaleDateString(locale(lang), { month: 'short' }).replace('.', '');
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${month(end)} ${end.getFullYear()}`
    : `${start.getDate()} ${month(start)} – ${end.getDate()} ${month(end)} ${end.getFullYear()}`;
}

const optionText = (o: TimeOption, lang: Lang) => `${dayLabel(o.start, lang)}, ${hhmm(o.start, lang)}–${hhmm(o.end, lang)}`;

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="av-toggle">
      <button role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
      <span>{label}</span>
    </label>
  );
}

interface GridProps {
  grid: AvailabilityGrid;
  selected: TimeOption | null;
  now: number;
  t: Dict;
  lang: Lang;
  today: number;
}

function Grid({ grid, selected, now, t, lang, today }: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const { slots, days, people } = grid;

  const slotLabels = useMemo(() => slots.map((s) => `${dayLabel(s.start, lang)} ${hhmm(s.start, lang)}–${hhmm(s.end, lang)}`), [slots, lang]);
  const rows = useMemo(
    () =>
      people.map((p) => {
        const name = p.self ? t.availMe : p.email;
        return { name, titles: p.cells.map((c, i) => `${name} — ${t.availStatus[c]}${p.notes[i] ? `: ${p.notes[i]}` : ''} (${slotLabels[i]})`) };
      }),
    [people, t, slotLabels],
  );

  // The slots the picked option covers, as a column range.
  const band0 = useMemo(() => {
    if (!selected) return null;
    const from = slots.findIndex((s) => s.start >= selected.start);
    if (from < 0) return null;
    let to = from;
    while (to + 1 < slots.length && slots[to + 1].start < selected.end) to++;
    return { from, to };
  }, [selected, slots]);

  useEffect(() => {
    if (band.current) band.current.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [band0?.from, band0?.to]);

  // A new week: start at today's column when the week contains it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const day = days.find((d) => d.date === today);
    el.scrollLeft = day ? Math.max(0, day.first * CELL - CELL * 2) : 0;
  }, [grid.windowStart, days, today]);

  const rowCount = people.length;
  return (
    <div className="av-scroll scroll" ref={scroller} role="region" aria-label={t.availTitle}>
      <div className="av-grid" style={{ gridTemplateColumns: `${NAME_W}px repeat(${slots.length}, ${CELL}px)`, gridTemplateRows: `26px 20px repeat(${rowCount}, 28px)` }}>
        <div className="av-corner" style={{ gridRow: 1, gridColumn: 1 }} />
        <div className="av-corner two" style={{ gridRow: 2, gridColumn: 1 }} />
        {days.map((d) => (
          <div key={d.date} className={`av-day${d.weekend ? ' weekend' : ''}${d.date === today ? ' today' : ''}`} style={{ gridRow: 1, gridColumn: `${d.first + 2} / span ${d.count}` }}>
            <span className="av-daylabel">{dayLabel(d.date, lang)}</span>
          </div>
        ))}
        {slots.map((s, i) => (
          <div key={s.start} className={`av-hour${days[s.day].first === i ? ' day-start' : ''}`} style={{ gridRow: 2, gridColumn: i + 2 }} />
        ))}
        {slots.map((s, i) => {
          const d = new Date(s.start);
          if (d.getMinutes() !== 0 || d.getHours() % 2 !== 0) return null;
          // A label spans two hours, but never reaches into the next day's columns.
          const day = days[s.day];
          const span = Math.min(4, day.first + day.count - i);
          return (
            <div key={`h${s.start}`} className="av-hourlabel tnum" style={{ gridRow: 2, gridColumn: `${i + 2} / span ${span}` }}>
              {String(d.getHours()).padStart(2, '0')}:00
            </div>
          );
        })}

        {rows.map((r, k) => (
          <div key={`n${k}`} className={`av-name${people[k].self ? ' self' : ''}`} style={{ gridRow: k + 3, gridColumn: 1 }} title={people[k].failed ? t.availNoDataWho : r.name}>
            <span className="nowrap">{r.name}</span>
            {people[k].failed && <Icon name="warning" size={13} color="var(--warn)" />}
          </div>
        ))}
        {people.map((p, k) =>
          p.cells.map((c, i) => {
            const first = days[slots[i].day].first === i;
            return (
              <div
                key={`${k}-${i}`}
                className={`av-cell ${c}${first ? ' day-start' : ''}${slots[i].end <= now ? ' past' : ''}`}
                style={{ gridRow: k + 3, gridColumn: i + 2 }}
                title={rows[k].titles[i]}
              />
            );
          }),
        )}

        {band0 && (
          <div ref={band} className="av-band" style={{ gridRow: `1 / ${rowCount + 3}`, gridColumn: `${band0.from + 2} / ${band0.to + 3}` }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

function Legend({ t }: { t: Dict }) {
  return (
    <ul className="av-legend" aria-label="Legend">
      {STATUS_ORDER.map((s) => (
        <li key={s}>
          <span className={`av-swatch ${s}`} />
          {t.availStatus[s]}
        </li>
      ))}
    </ul>
  );
}

export function Availability({ snap }: { snap: Snapshot }) {
  const { t, lang } = useI18n(snap);
  const now = useNow(60_000);
  const nowMs = now.getTime();
  const todayMs = useMemo(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), [now]);

  const [emails, setEmails] = useState<string[]>([]);
  const [duration, setDuration] = useState<MeetingDuration>(60);
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [weekends, setWeekends] = useState(false);
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedStart, setPickedStart] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Typed but not yet a chip; and the names picked from the directory, shown as a chip's tooltip. */
  const [draft, setDraft] = useState('');
  const [pickedNames, setPickedNames] = useState<Record<string, string>>({});
  const local = useMemo(() => localPeople(snap.events), [snap.events]);
  const taken = useMemo(() => new Set(emails.map(emailKey)), [emails]);

  /** Adds addresses to the list; returns a message when there is no room for them. */
  function addPeople(list: string[], picked?: Record<string, string>): string | null {
    const next = dedupeEmails([...emails, ...list]);
    if (next.length > MAX_PEOPLE) return t.availTooMany(MAX_PEOPLE);
    setEmails(next);
    if (picked) setPickedNames((n) => ({ ...n, ...picked }));
    return null;
  }

  const request = useMemo<AvailabilityRequest>(() => {
    const w = weekWindow(week);
    return { emails, start: w.start.toISOString(), end: w.end.toISOString() };
  }, [emails, week]);

  // One request at a time (the main process allows no more); a newer one waits and replaces older ones in the queue.
  const running = useRef(false);
  const queued = useRef<AvailabilityRequest | null>(null);
  const run = useCallback(async (req: AvailabilityRequest) => {
    if (running.current) {
      queued.current = req;
      return;
    }
    running.current = true;
    setLoading(true);
    try {
      const r = await api.getAvailability(req);
      if (!queued.current) {
        setResult(r);
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
    const id = setTimeout(() => void run(request), 300);
    return () => clearTimeout(id);
  }, [request, run]);

  const window0 = useMemo(() => {
    if (result) return { start: Date.parse(result.start), end: Date.parse(result.end) };
    const w = weekWindow(week);
    return { start: w.start.getTime(), end: w.end.getTime() };
  }, [result, week]);

  const fromCalendar = !result?.self;
  const grid = useMemo(() => {
    const me = result?.self ?? availabilityFromEvents(snap.events, window0.start, window0.end, new Date(nowMs), 'me');
    const others = (result?.people ?? []).filter((p) => p.email !== result?.self?.email);
    return buildGrid(window0.start, window0.end, [{ ...me, self: true }, ...others], {
      workdayStartHour: snap.settings.workdayStartHour,
      workdayEndHour: snap.settings.workdayEndHour,
      showWeekends: weekends,
    });
  }, [result, snap.events, snap.settings.workdayStartHour, snap.settings.workdayEndHour, weekends, window0, nowMs]);

  const options = useMemo(() => bestOptions(grid, duration, new Date(nowMs), 5), [grid, duration, nowMs]);
  const selected = options.find((o) => o.start === pickedStart) ?? null;

  const names = (list: string[]) => {
    const label = (e: string) => (grid.people.find((p) => p.email === e)?.self ? t.availMe : e);
    const shown = list.slice(0, 3).map(label).join(', ');
    return list.length > 3 ? `${shown} ${t.availAndMore(list.length - 3)}` : shown;
  };
  const why = (o: TimeOption) => {
    if (o.kind === 'free' && !o.unknown.length) return t.availAllFree;
    return [o.tentative.length ? t.availSomeTentative(names(o.tentative)) : '', o.unknown.length ? t.availSomeUnknown(names(o.unknown)) : ''].filter(Boolean).join('; ') || t.availAllFree;
  };

  async function create() {
    if (!selected) return;
    setCreateError(null);
    try {
      await api.openCreateMeeting({ start: new Date(selected.start).toISOString(), end: new Date(selected.end).toISOString(), attendees: emails });
    } catch (e) {
      setCreateError(`${t.availCreateFailed}: ${ipcMessage(e)}`);
    }
  }

  const thisWeek = weekStart(now).getTime();
  const shiftWeek = (n: number) => setWeek((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7 * n));

  return (
    <div className="avail">
      <header className="av-head">
        <h1>{t.availTitle}</h1>
        <p className="sec">{t.availLead}</p>
      </header>

      {/* A failed request means the grid below is not the truth: say so at the top, not under the grid. */}
      {error && (
        <div className="av-alert">
          <Alert title={t.availFailed} action={{ label: t.retry, onClick: () => void run(request) }}>
            {error}
          </Alert>
        </div>
      )}

      <div className="av-bar">
        <div className="av-field">
          <div className="av-label">{t.availAttendees}</div>
          <PeopleField
            label={t.availAttendees}
            t={t}
            values={emails}
            draft={draft}
            onDraft={setDraft}
            onAdd={addPeople}
            onRemove={(e) => setEmails(emails.filter((x) => x !== e))}
            names={pickedNames}
            local={local}
            taken={taken}
          />
        </div>
        <div className="av-field">
          <div className="av-label">{t.availDuration}</div>
          <div className="av-seg" role="radiogroup" aria-label={t.availDuration}>
            {DURATIONS.map((d) => (
              <button key={d} role="radio" aria-checked={duration === d} className={`btn${duration === d ? ' on' : ''}`} onClick={() => setDuration(d)}>
                {t.availMinutes(d)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="av-nav">
        <button className="icon-btn" onClick={() => shiftWeek(-1)} aria-label={t.availPrevWeek} title={t.availPrevWeek}>
          <Icon name="chevL" size={16} />
        </button>
        <div className="av-week tnum">{weekLabel(week, lang)}</div>
        <button className="icon-btn" onClick={() => shiftWeek(1)} aria-label={t.availNextWeek} title={t.availNextWeek}>
          <Icon name="chevR" size={16} />
        </button>
        <button className="btn compact" disabled={week.getTime() === thisWeek} onClick={() => setWeek(new Date(thisWeek))}>
          {t.availThisWeek}
        </button>
        <Toggle checked={weekends} onChange={setWeekends} label={t.availWeekends} />
        <span className="grow" />
        {loading && (
          <span className="av-loading sec" role="status">
            <span className="spin" /> {t.availLoading}
          </span>
        )}
        <button className="icon-btn" onClick={() => void run(request)} aria-label={t.availReload} title={t.availReload}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      <div className="av-main">
        <section className={`av-gridbox${loading ? ' busy' : ''}`}>
          <Grid grid={grid} selected={selected} now={nowMs} t={t} lang={lang} today={todayMs} />
          <div className="av-foot">
            <Legend t={t} />
            {!error && fromCalendar && !loading && <div className="ter av-note">{t.availMeFromCalendar}</div>}
          </div>
        </section>

        <aside className="av-side" aria-label={t.availBest}>
          <h2>{t.availBest}</h2>
          {!emails.length && <div className="hint sec av-hint">{t.availNoPeople}</div>}
          {options.length === 0 ? (
            <div className="av-empty">
              <div>{t.availNoBest}</div>
              <div className="hint sec">{t.availNoBestHint}</div>
            </div>
          ) : (
            <ol className="av-opts">
              {options.map((o) => (
                <li key={o.start}>
                  <button className={`av-opt${selected?.start === o.start ? ' on' : ''}`} aria-pressed={selected?.start === o.start} onClick={() => setPickedStart(o.start)}>
                    <span className="when tnum">{optionText(o, lang)}</span>
                    <span className={`why ${o.kind === 'free' && !o.unknown.length ? 'ok' : 'warn'}`}>{why(o)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="av-create">
            {!selected && options.length > 0 && <div className="hint sec">{t.availPickHint}</div>}
            <button className="btn primary" disabled={!selected} onClick={() => void create()}>
              <Icon name="calendar" size={15} />
              {t.availCreate}
            </button>
            {createError && <Alert title={createError} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
