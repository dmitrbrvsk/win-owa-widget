import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_STATS_DAYS, meetingStats, statsPeriod, STATS_PERIODS, type StatsPeriod, type StatsWorkday } from '../src/shared/stats';
import { parseStatsRequest } from '../src/shared/validate';
import { demoStatsEvents } from '../src/main/demo';
import type { CalendarEvent } from '../src/shared/types';

// Local times are made with the Date constructor, so the tests run in a fixed zone: the same
// answers on a developer machine and on CI. (Moscow has no daylight saving.)
const realTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Moscow';
});
afterAll(() => {
  if (realTZ === undefined) delete process.env.TZ;
  else process.env.TZ = realTZ;
});

const time = (fn: () => unknown) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

/** Wednesday 7 October 2026, 12:00; the week of the 5th (a Monday) is "this week". */
const NOW = new Date(2026, 9, 7, 12);
const WEEK = statsPeriod('thisWeek', NOW);
const WORKDAY: StatsWorkday = { workdayStartHour: 8, workdayEndHour: 20 };
/** 8:00–20:00 on five weekdays. */
const WEEK_WORK_HOURS = 60;

let seq = 0;
/** October 2026 as a local instant: `at(5, 10)` is Monday the 5th at 10:00. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

function ev(start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    title: 'Встреча',
    start,
    end,
    isAllDay: false,
    platform: 'generic',
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    categories: [],
    isRecurring: false,
    ...extra,
  };
}

const stats = (events: CalendarEvent[], period: StatsPeriod = WEEK, workday: StatsWorkday = WORKDAY) => meetingStats(events, period, workday);
const dayOf = (s: ReturnType<typeof stats>, day: number) => s.days[day - 5]; // the week starts on the 5th

// ---------- the periods ----------

describe('the periods the window offers', () => {
  it('are whole weeks, from Monday, and say which dates they are', () => {
    expect(new Date(WEEK.start).getDate()).toBe(5);
    expect(new Date(WEEK.end).getDate()).toBe(12);
    const last = statsPeriod('lastWeek', NOW);
    expect([new Date(last.start).getDate(), new Date(last.end).getDate()]).toEqual([28, 5]);
    const four = statsPeriod('last4Weeks', NOW);
    expect(new Date(four.start).getDate()).toBe(14); // 14 September: this week and the three before it
    expect(new Date(four.end).getDate()).toBe(12);
    expect(Math.round((four.end - four.start) / 86_400_000)).toBe(28);
    for (const kind of STATS_PERIODS) {
      const p = statsPeriod(kind, NOW);
      expect(p.kind).toBe(kind);
      expect((p.end - p.start) / 86_400_000).toBeLessThanOrEqual(MAX_STATS_DAYS);
    }
  });

  it('builds one day per calendar day, with the working hours from the settings', () => {
    const week = stats([]);
    expect(week.days).toHaveLength(7);
    expect(week.days.filter((d) => d.weekend).map((d) => new Date(d.date).getDate())).toEqual([10, 11]);
    expect(week.workHours).toBe(WEEK_WORK_HOURS);
    expect(stats([], statsPeriod('last4Weeks', NOW)).days).toHaveLength(28);
    // A shorter workday is fewer working hours, and so a bigger share for the same meetings.
    expect(stats([], WEEK, { workdayStartHour: 9, workdayEndHour: 18 }).workHours).toBe(45);
  });
});

// ---------- the headline numbers ----------

describe('hours and counts for a simple week', () => {
  const week = [
    ev(at(5, 10), at(5, 11)),
    ev(at(5, 14), at(5, 15, 30)),
    ev(at(6, 9), at(6, 10)),
    ev(at(7, 11), at(7, 12)),
  ];

  it('sums the hours, counts the meetings and averages their length', () => {
    const s = stats(week);
    expect(s.hours).toBeCloseTo(4.5);
    expect(s.busyHours).toBeCloseTo(4.5);
    expect(s.meetings).toBe(4);
    expect(s.avgMinutes).toBeCloseTo(67.5);
  });

  it('splits the hours over the days and names the busiest one', () => {
    const s = stats(week);
    expect(dayOf(s, 5).hours).toBeCloseTo(2.5);
    expect(dayOf(s, 5).meetings).toBe(2);
    expect(dayOf(s, 6).hours).toBeCloseTo(1);
    expect(dayOf(s, 8).hours).toBe(0);
    expect(s.longestDay?.date).toBe(new Date(2026, 9, 5).getTime());
    expect(s.longestDay?.hours).toBeCloseTo(2.5);
  });

  it('reports the share of working time and what is left free', () => {
    const s = stats(week);
    expect(s.busyWorkHours).toBeCloseTo(4.5);
    expect(s.shareOfWork).toBeCloseTo(4.5 / WEEK_WORK_HOURS);
    expect(s.freeWorkHours).toBeCloseTo(WEEK_WORK_HOURS - 4.5);
  });

  it('counts meetings outside working hours as hours, but not against the working day', () => {
    const s = stats([ev(at(5, 21), at(5, 22)), ev(at(10, 12), at(10, 13))]); // late evening and a Saturday
    expect(s.hours).toBeCloseTo(2);
    expect(s.busyWorkHours).toBe(0);
    expect(s.shareOfWork).toBe(0);
    expect(s.freeWorkHours).toBe(WEEK_WORK_HOURS);
  });

  it('counts time once when two meetings run at the same time, and the share with it', () => {
    const s = stats([ev(at(5, 10), at(5, 12)), ev(at(5, 11), at(5, 13))]);
    expect(s.hours).toBeCloseTo(4); // what the meetings add up to, as the day bar shows
    expect(s.busyHours).toBeCloseTo(3); // what they actually occupied
    expect(s.shareOfWork).toBeCloseTo(3 / WEEK_WORK_HOURS);
    expect(s.freeWorkHours).toBeCloseTo(WEEK_WORK_HOURS - 3);
  });
});

describe('meetings at the edges of the period', () => {
  it('splits a meeting that crosses midnight between the two days', () => {
    const s = stats([ev(at(5, 23), at(6, 1))]);
    expect(s.hours).toBeCloseTo(2);
    expect(s.meetings).toBe(1);
    expect(dayOf(s, 5).hours).toBeCloseTo(1);
    expect(dayOf(s, 6).hours).toBeCloseTo(1);
    // Both days show it, so a day's meeting count is "meetings that touch this day".
    expect([dayOf(s, 5).meetings, dayOf(s, 6).meetings]).toEqual([1, 1]);
    expect(s.busyWorkHours).toBe(0); // 23:00–01:00 is nobody's working time
  });

  it('counts only the part of a meeting that lies inside the period', () => {
    const before = ev(at(4, 22), at(5, 2)); // starts on Sunday, before the week
    const after = ev(at(11, 23), at(12, 1)); // ends on Monday, after the week
    const outside = ev(at(1, 10), at(1, 11));
    const s = stats([before, after, outside]);
    expect(s.meetings).toBe(2);
    expect(s.hours).toBeCloseTo(3); // 2 hours of the first, 1 of the second
    expect(dayOf(s, 5).hours).toBeCloseTo(2);
    expect(dayOf(s, 11).hours).toBeCloseTo(1);
    expect(s.days.reduce((a, d) => a + d.hours, 0)).toBeCloseTo(s.hours);
  });

  it('ignores a meeting that ends when the period starts, and one with no length', () => {
    expect(stats([ev(at(4, 20), at(5, 0))]).meetings).toBe(0);
    expect(stats([ev(at(5, 10), at(5, 10))]).meetings).toBe(0);
    expect(stats([ev(at(5, 11), at(5, 10))]).meetings).toBe(0);
    expect(stats([ev('not a date', at(5, 10))]).meetings).toBe(0);
  });
});

describe('all-day meetings', () => {
  const duty = ev(at(5, 0), at(7, 0), { isAllDay: true, title: 'Дежурство по релизу' });

  it('are counted as days, never as hours', () => {
    const s = stats([duty]);
    expect(s.hours).toBe(0);
    expect(s.meetings).toBe(0);
    expect(s.allDayMeetings).toBe(1);
    expect(s.allDayDays).toBe(2);
    expect(dayOf(s, 5).allDay).toBe(1);
    expect(dayOf(s, 6).allDay).toBe(1);
    expect(dayOf(s, 7).allDay).toBe(0);
    expect(s.longestDay).toBeNull();
    expect(s.shareOfWork).toBe(0);
  });

  it('do not inflate the hours of the timed meetings beside them', () => {
    const s = stats([duty, ev(at(5, 10), at(5, 11))]);
    expect(s.hours).toBeCloseTo(1);
    expect(s.meetings).toBe(1);
    expect(s.allDayDays).toBe(2);
    // An all-day entry has no organizer to credit and no platform to count.
    expect(s.platforms.reduce((a, p) => a + p.meetings, 0)).toBe(1);
  });

  it('count only the days of theirs that fall in the period', () => {
    const s = stats([ev(at(3, 0), at(6, 0), { isAllDay: true })]);
    expect(s.allDayDays).toBe(1);
  });
});

describe('what does not count', () => {
  it('leaves out cancelled meetings, by the flag and by the subject', () => {
    const s = stats([ev(at(5, 10), at(5, 11), { isCancelled: true }), ev(at(5, 12), at(5, 13), { title: 'Отменено: Ретро' }), ev(at(5, 14), at(5, 15), { title: 'Canceled: Sync' })]);
    expect(s.meetings).toBe(0);
    expect(s.hours).toBe(0);
    expect(s.people).toEqual([]);
  });

  it('leaves out meetings the person declined', () => {
    const s = stats([ev(at(5, 10), at(5, 11), { responseType: 'declined' }), ev(at(5, 12), at(5, 13))]);
    expect(s.meetings).toBe(1);
    expect(s.hours).toBeCloseTo(1);
    expect(s.responses.map((r) => r.response)).toEqual(['accepted']);
  });

  it('counts a repeated id once (a cached list and a fresh answer may both hold it)', () => {
    const one = ev(at(5, 10), at(5, 11));
    const same = { ...one, title: 'Та же встреча' };
    const s = stats([one, same, { ...one, start: at(5, 15), end: at(5, 17) }]);
    expect(s.meetings).toBe(1);
    expect(s.hours).toBeCloseTo(1);
    expect(dayOf(s, 5).meetings).toBe(1);
  });
});

describe('meetings back to back', () => {
  it('counts the ones that begin the moment another ends', () => {
    const s = stats([ev(at(5, 10), at(5, 11)), ev(at(5, 11), at(5, 12)), ev(at(5, 14), at(5, 15))]);
    expect(s.backToBack).toBe(1);
    expect(s.meetings).toBe(3);
  });

  it('counts a chain of three as two, whatever order the list comes in', () => {
    const chain = [ev(at(6, 11), at(6, 12)), ev(at(6, 12), at(6, 12, 30)), ev(at(6, 10), at(6, 11))];
    expect(stats(chain).backToBack).toBe(2);
    expect(stats([...chain].reverse()).backToBack).toBe(2);
  });

  it('is not fooled by a gap, by an overlap, or by a meeting on another day', () => {
    expect(stats([ev(at(5, 10), at(5, 11)), ev(at(5, 11, 15), at(5, 12))]).backToBack).toBe(0);
    expect(stats([ev(at(5, 10), at(5, 12)), ev(at(5, 11), at(5, 13))]).backToBack).toBe(0);
    expect(stats([ev(at(5, 10), at(5, 11)), ev(at(6, 11), at(6, 12))]).backToBack).toBe(0);
    // Three at once, two of which pick up exactly where a longer one ends.
    expect(stats([ev(at(5, 10), at(5, 12)), ev(at(5, 11), at(5, 12)), ev(at(5, 12), at(5, 13)), ev(at(5, 12), at(5, 12, 30))]).backToBack).toBe(2);
  });
});

describe('most often with', () => {
  const org = (name: string, email?: string) => ({ organizer: name, organizerEmail: email });

  it('ranks the organizers by hours, then by meetings, then by name', () => {
    const s = stats([
      ev(at(5, 10), at(5, 11), org('Мария Соколова', 'm.sokolova@example.com')),
      ev(at(6, 10), at(6, 11), org('Мария Соколова', 'm.sokolova@example.com')),
      ev(at(7, 10), at(7, 12), org('Алексей Петров', 'a.petrov@example.com')),
      ev(at(8, 10), at(8, 11), org('Ольга Васильева', 'o.vasilieva@example.com')),
      ev(at(9, 10), at(9, 11), org('Борис Жуков', 'b.zhukov@example.com')),
    ]);
    // Мария and Алексей both have two hours: more meetings wins. Ольга and Борис tie on both, so the name decides.
    expect(s.people.map((p) => [p.name, p.hours, p.meetings])).toEqual([
      ['Мария Соколова', 2, 2],
      ['Алексей Петров', 2, 1],
      ['Борис Жуков', 1, 1],
      ['Ольга Васильева', 1, 1],
    ]);
  });

  it('is one person even when the server spells the name differently, and falls back to the name with no address', () => {
    const s = stats([
      ev(at(5, 10), at(5, 11), org('Мария Соколова', 'M.Sokolova@example.com')),
      ev(at(5, 12), at(5, 13), org('Соколова Мария', 'm.sokolova@example.com')),
      ev(at(6, 10), at(6, 11), org('Павел Никитин')),
      ev(at(6, 12), at(6, 13), org('павел никитин')),
    ]);
    expect(s.people.map((p) => [p.key, p.meetings])).toEqual([
      ['m.sokolova@example.com', 2],
      ['павел никитин', 2],
    ]);
  });

  it('keeps the person’s own meetings apart: there is nobody else on them to count', () => {
    const s = stats([
      ev(at(5, 10), at(5, 11), { isOrganizer: true, responseType: 'organizer' }),
      ev(at(5, 14), at(5, 15, 30), { responseType: 'organizer' }),
      ev(at(6, 10), at(6, 11), org('Мария Соколова', 'm.sokolova@example.com')),
    ]);
    expect(s.ownMeetings).toBe(2);
    expect(s.ownHours).toBeCloseTo(2.5);
    expect(s.people.map((p) => p.name)).toEqual(['Мария Соколова']);
    expect(s.meetings).toBe(3); // they are still meetings, and still hours
  });

  it('skips a meeting whose organizer the server did not name', () => {
    const s = stats([ev(at(5, 10), at(5, 11)), ev(at(5, 12), at(5, 13), org('   '))]);
    expect(s.meetings).toBe(2);
    expect(s.people).toEqual([]);
  });
});

describe('where the meetings happen and what was answered', () => {
  it('groups by platform, with "no link" for a meeting that has none', () => {
    const s = stats([
      ev(at(5, 10), at(5, 11), { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x', platform: 'teams' }),
      ev(at(5, 12), at(5, 14), { joinUrl: 'https://a.zoom.us/j/1', platform: 'zoom' }),
      ev(at(6, 10), at(6, 11), { joinUrl: 'https://teams.microsoft.com/l/meetup-join/y', platform: 'teams' }),
      ev(at(6, 12), at(6, 13), { location: 'Переговорная «Байкал»' }),
    ]);
    expect(s.platforms.map((p) => [p.platform, p.hours, p.meetings])).toEqual([
      ['teams', 2, 2],
      ['zoom', 2, 1],
      ['none', 1, 1],
    ]);
  });

  it('groups by the response, counting a meeting of your own as "organizer"', () => {
    const s = stats([
      ev(at(5, 10), at(5, 11)),
      ev(at(5, 12), at(5, 13), { responseType: 'tentative' }),
      ev(at(6, 10), at(6, 11), { isOrganizer: true, responseType: 'notResponded' }),
      ev(at(6, 12), at(6, 13), { responseType: 'notResponded' }),
    ]);
    expect(s.responses.map((r) => [r.response, r.meetings]).sort()).toEqual([
      ['accepted', 1],
      ['notResponded', 1],
      ['organizer', 1],
      ['tentative', 1],
    ]);
  });
});

describe('a period with nothing in it', () => {
  it('answers zeros instead of dividing by zero', () => {
    const s = stats([]);
    expect([s.meetings, s.hours, s.busyHours, s.avgMinutes, s.backToBack, s.allDayDays, s.ownMeetings]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(s.shareOfWork).toBe(0);
    expect(s.freeWorkHours).toBe(WEEK_WORK_HOURS);
    expect(s.longestDay).toBeNull();
    expect(s.people).toEqual([]);
    expect(s.platforms).toEqual([]);
    expect(s.responses).toEqual([]);
    for (const n of [s.hours, s.shareOfWork, s.avgMinutes, s.freeWorkHours]) expect(Number.isFinite(n)).toBe(true);
  });

  it('answers zeros for a period with no working hours at all, and for an empty period', () => {
    const weekend: StatsPeriod = { kind: 'thisWeek', start: new Date(2026, 9, 10).getTime(), end: new Date(2026, 9, 12).getTime() };
    const s = stats([ev(at(10, 12), at(10, 13))], weekend);
    expect(s.workHours).toBe(0);
    expect(s.shareOfWork).toBe(0); // no division by zero
    expect(s.freeWorkHours).toBe(0);
    expect(s.hours).toBeCloseTo(1);
    const empty = stats([ev(at(5, 10), at(5, 11))], { kind: 'thisWeek', start: WEEK.start, end: WEEK.start });
    expect(empty.days).toEqual([]);
    expect(empty.meetings).toBe(0);
    expect(empty.shareOfWork).toBe(0);
  });
});

describe('a period packed with meetings', () => {
  it('stays fast on a few thousand of them', () => {
    const period = statsPeriod('last4Weeks', NOW);
    const day0 = new Date(period.start);
    const many: CalendarEvent[] = [];
    for (let i = 0; i < 4000; i++) {
      const start = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + (i % 28), 8 + (i % 10), (i % 2) * 30);
      many.push(ev(start.toISOString(), new Date(start.getTime() + 45 * 60_000).toISOString(), { organizer: `Человек ${i % 50}`, organizerEmail: `p${i % 50}@example.com` }));
    }
    // Repeats and meetings that cross midnight are the expensive shapes: they are in here too.
    for (let i = 0; i < 1000; i++) many.push(many[i], ev(at(5 + (i % 5), 23), at(6 + (i % 5), 1)));
    expect(time(() => meetingStats(many, period, WORKDAY))).toBeLessThan(500);
    const s = meetingStats(many, period, WORKDAY);
    expect(s.meetings).toBe(5000);
    expect(s.people).toHaveLength(50);
  });
});

// ---------- the IPC request ----------

describe('statistics request from the renderer', () => {
  const good = { start: new Date(2026, 9, 5).toISOString(), end: new Date(2026, 9, 12).toISOString() };

  it('accepts a normal period and normalizes the dates', () => {
    const r = parseStatsRequest(good, NOW);
    expect(r).toEqual(good);
    expect(parseStatsRequest({ start: '2026-10-05T00:00:00+03:00', end: good.end }, NOW).start).toBe('2026-10-04T21:00:00.000Z');
    // The longest period the window offers, and the longest one allowed.
    const four = statsPeriod('last4Weeks', NOW);
    expect(() => parseStatsRequest({ start: new Date(four.start).toISOString(), end: new Date(four.end).toISOString() }, NOW)).not.toThrow();
    expect(() => parseStatsRequest({ start: good.start, end: new Date(2026, 11, 4).toISOString() }, NOW)).not.toThrow(); // 60 days exactly
  });

  it('refuses a period that is reversed, empty, too long or too far from today', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'this week',
      [],
      { start: good.start },
      { end: good.end },
      { start: good.end, end: good.start },
      { start: good.start, end: good.start },
      { start: good.start, end: new Date(2026, 11, 5).toISOString() }, // 61 days
      { start: WEEK.start, end: WEEK.end }, // epoch milliseconds are not instants
      { start: '2026-10-05', end: '2026-10-12' },
      { start: '2026-10-05T00:00:00', end: good.end }, // no zone: the main process does not guess
      { start: '2026-13-45T00:00:00Z', end: good.end },
      { start: new Date(2029, 0, 1).toISOString(), end: new Date(2029, 0, 8).toISOString() },
      { start: new Date(2020, 0, 1).toISOString(), end: new Date(2020, 0, 8).toISOString() },
    ];
    for (const v of bad) expect(() => parseStatsRequest(v, NOW), JSON.stringify(v)?.slice(0, 50)).toThrow();
  });
});

// ---------- the demo ----------

describe('demo statistics', () => {
  it('fills the period with fictional meetings a statistics window can show', () => {
    const period = statsPeriod('thisWeek', NOW);
    const req = { start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString() };
    const events = demoStatsEvents(req);
    const s = meetingStats(events, period, WORKDAY);
    expect(s.meetings).toBeGreaterThan(10);
    expect(s.hours).toBeGreaterThan(5);
    expect(s.shareOfWork).toBeGreaterThan(0);
    expect(s.shareOfWork).toBeLessThanOrEqual(1);
    expect(s.people.length).toBeGreaterThan(1);
    expect(s.backToBack).toBeGreaterThan(0);
    expect(s.ownMeetings).toBeGreaterThan(0);
    // Every meeting lies inside the period, and the same period always gives the same numbers.
    for (const e of events) expect(Date.parse(e.end) > period.start && Date.parse(e.start) < period.end).toBe(true);
    expect(demoStatsEvents(req)).toEqual(events);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    // The demo cast is fictional; no real colleague's name is in it.
    for (const e of events) expect(e.organizer ?? '').not.toMatch(/Ирина|Ковал/);
  });

  it('answers nothing for a period that is not one', () => {
    expect(demoStatsEvents({ start: 'x', end: 'y' })).toEqual([]);
    expect(demoStatsEvents({ start: new Date(2026, 9, 12).toISOString(), end: new Date(2026, 9, 5).toISOString() })).toEqual([]);
  });
});
