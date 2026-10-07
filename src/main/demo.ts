// Fictional meetings for `npm run dev:demo` and screenshots. No Exchange needed.
import type { AvailabilityEvent, AvailabilityRequest, AvailabilityResult, AvailabilityStatus, CalendarEvent, EventDetails, MeetingPlatform, PersonAvailability, PersonSuggestion, StatsRequest } from '../shared/types';
import { SLOT_MINUTES, digitOfStatus, slotCount } from '../shared/availability';

function at(dayOffset: number, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

let n = 0;
function ev(day: number, s: string, e: string, title: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  n += 1;
  return {
    id: `demo-${n}`,
    changeKey: `ck-${n}`,
    title,
    start: at(day, s),
    end: at(day, e),
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

const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0';
const zoom = 'https://example.zoom.us/j/1234567890';
const ktalk = 'https://demo.ktalk.ru/abcdef';

export function demoEvents(): CalendarEvent[] {
  n = 0;
  const now = new Date();
  const soon = new Date(now.getTime() + 12 * 60_000);
  soon.setSeconds(0, 0);
  const soonEnd = new Date(soon.getTime() + 45 * 60_000);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  return [
    { ...ev(0, '00:00', '23:59', 'Дежурство по релизу'), isAllDay: true, start: at(0, '00:00'), end: at(1, '00:00') },
    { ...ev(0, '00:00', '23:59', 'Отпуск: Павел Никитин'), isAllDay: true, start: at(0, '00:00'), end: at(3, '00:00') },
    ev(0, '09:00', '09:30', 'Стендап команды', { organizer: 'Мария Соколова', joinUrl: teams, platform: 'teams', isRecurring: true }),
    ev(0, '09:30', '10:30', 'Планирование спринта', { organizer: 'Алексей Петров', joinUrl: teams, platform: 'teams' }),
    ev(0, '10:00', '11:00', 'Архитектурный комитет', { organizer: 'Дмитрий Орлов', joinUrl: zoom, platform: 'zoom', responseType: 'tentative' }),
    ev(0, hhmm(soon), hhmm(soonEnd), 'Дизайн-ревью: новый онбординг', {
      organizer: 'Иван Иванов',
      joinUrl: teams,
      platform: 'teams',
      location: 'Переговорная «Байкал» / Teams',
      bodyPreview: 'Смотрим макеты нового онбординга, решаем по экрану выбора тарифа.',
    }),
    ev(0, '12:00', '13:00', 'Интервью: iOS-разработчик', { isOrganizer: true, responseType: 'organizer', joinUrl: ktalk, platform: 'ktalk' }),
    ev(0, '12:00', '12:30', 'Синк с мобильной командой', { organizer: 'Сергей Морозов', joinUrl: zoom, platform: 'zoom' }),
    ev(0, '13:30', '14:30', 'Демо релиза 1.2', { organizer: 'Павел Никитин', joinUrl: ktalk, platform: 'ktalk', categories: ['Красная категория'] }),
    ev(0, '14:30', '15:00', 'Кофе с Анной', { organizer: 'Анна Лебедева' }),
    ev(0, '16:00', '16:30', 'Отменено: Ретро', { organizer: 'Мария Соколова', isCancelled: true }),
    ev(1, '11:00', '12:00', 'Квартальное планирование', { organizer: 'Ольга Васильева', joinUrl: teams, platform: 'teams', responseType: 'notResponded' }),
    ev(2, '15:00', '15:45', 'Обзор метрик воронки', { organizer: 'Екатерина Белова', joinUrl: zoom, platform: 'zoom', responseType: 'notResponded' }),
    ev(1, '10:00', '10:15', 'Стендап команды', { organizer: 'Мария Соколова', joinUrl: teams, platform: 'teams', isRecurring: true }),
    ev(-1, '10:00', '10:15', 'Стендап команды', { organizer: 'Мария Соколова', joinUrl: teams, platform: 'teams', isRecurring: true }),
  ];
}

export function demoDetails(e: CalendarEvent): EventDetails {
  return {
    attendees: [
      { name: e.organizer ?? 'Дмитрий Боровский', kind: 'required', response: 'organizer' },
      { name: 'Мария Соколова', email: 'm.sokolova@example.com', kind: 'required', response: 'accepted' },
      { name: 'Алексей Петров', email: 'a.petrov@example.com', kind: 'required', response: 'tentative' },
      { name: 'Никита Фролов', email: 'n.frolov@example.com', kind: 'optional', response: 'notResponded' },
    ],
    bodyText:
      (e.bodyPreview ?? 'Повестка встречи.') +
      '\n\nПовестка:\n• Статус по задачам\n• Риски релиза\n• Следующие шаги\n\nСсылка: ' +
      (e.joinUrl ?? '—'),
  };
}

/** A fictional directory for the recipients field in the demo. */
const DEMO_PEOPLE: PersonSuggestion[] = [
  { name: 'Иван Иванов', email: 'i.ivanov@example.com' },
  { name: 'Иван Петров', email: 'ivan.petrov@example.com' },
  { name: 'Мария Соколова', email: 'm.sokolova@example.com' },
  { name: 'Алексей Петров', email: 'a.petrov@example.com' },
  { name: 'Никита Фролов', email: 'n.frolov@example.com' },
  { name: 'Ольга Васильева', email: 'o.vasilieva@example.com' },
  { name: 'Екатерина Белова', email: 'e.belova@example.com' },
  { name: 'Сергей Морозов', email: 's.morozov@example.com' },
  { name: 'Павел Никитин', email: 'p.nikitin@example.com' },
  { name: 'Анна Лебедева', email: 'a.lebedeva@example.com' },
  { name: 'Дмитрий Орлов', email: 'd.orlov@example.com' },
  { name: 'Игорь Иванченко', email: 'i.ivanchenko@example.com' },
];

/** The demo people whose name or address contains the query, at most 8. */
export function demoPeople(query: string): PersonSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return DEMO_PEOPLE.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q)).slice(0, 8);
}

// ---------- Free time search ----------

const SUBJECTS = ['Планёрка', 'Ревью дизайна', 'Созвон с заказчиком', 'Синк по релизу', 'Собеседование', 'Обучение', 'Демо', 'Бюджет', 'Ретроспектива', 'Разбор инцидента'];

/** FNV-1a: a small stable hash, so the same address always gets the same fictional calendar. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Addresses that start with "noaccess" or "nodata" play a mailbox the server has no free/busy for. */
const hasNoData = (email: string) => /^(noaccess|nodata)/.test(email);

function demoPerson(email: string, windowStart: number, windowEnd: number): PersonAvailability {
  const n = slotCount(windowStart, windowEnd);
  const slotMs = SLOT_MINUTES * 60_000;
  if (hasNoData(email)) return { email, digits: '4'.repeat(n), failed: true, error: 'ErrorNoFreeBusyAccess' };
  const digits: string[] = new Array(n).fill('0');
  const events: AvailabilityEvent[] = [];
  // About half of the people let the viewer see subjects, the others only free/busy.
  const withSubjects = fnv(email) % 2 === 0;
  const place = (from: number, to: number, status: AvailabilityStatus, subject: string) => {
    const a = Math.max(0, Math.floor((from - windowStart) / slotMs));
    const b = Math.min(n, Math.ceil((to - windowStart) / slotMs));
    for (let i = a; i < b; i++) if (digitOfStatus(status) > digits[i]) digits[i] = digitOfStatus(status);
    events.push({ start: new Date(from).toISOString(), end: new Date(to).toISOString(), status, subject: withSubjects ? subject : undefined });
  };
  const first = new Date(windowStart);
  for (let day = new Date(first.getFullYear(), first.getMonth(), first.getDate()); day.getTime() < windowEnd; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) continue;
    const key = `${email}|${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (weekday === 3 && fnv(`${email}|oof|${day.getMonth()}-${Math.floor(day.getDate() / 7)}`) % 7 === 0) {
      place(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0).getTime(), new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime(), 'oof', 'Отпуск');
      continue;
    }
    const blocks = 2 + (fnv(key) % 3);
    for (let j = 0; j < blocks; j++) {
      const h = fnv(`${key}|${j}`);
      const minute = 8 * 60 + (h % 20) * 30; // 08:00 … 17:30
      const length = 30 * (1 + ((h >>> 8) % 4)); // 30 … 120 minutes
      const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute).getTime();
      place(from, from + length * 60_000, h % 5 === 0 ? 'tentative' : 'busy', SUBJECTS[(h >>> 12) % SUBJECTS.length]);
    }
  }
  return { email, digits: digits.join(''), events };
}

/** Fictional free/busy for the demo mode and the browser mock: deterministic, no server. "Me" is left to the calendar. */
export function demoAvailability(req: AvailabilityRequest): AvailabilityResult {
  const start = Date.parse(req.start);
  const end = Date.parse(req.end);
  // The demo has a "signed-in user" too, so the grid shows the own row the way a real server's answer does.
  return { start: req.start, end: req.end, slotMinutes: SLOT_MINUTES, self: demoPerson('demo.me@example.com', start, end), people: req.emails.map((e) => demoPerson(e, start, end)) };
}

// ---------- Meeting statistics ----------

/** The fictional colleagues whose meetings fill the statistics period, with their platforms. */
const STATS_CAST: Array<{ who: PersonSuggestion; url?: string; platform: MeetingPlatform }> = [
  { who: { name: 'Мария Соколова', email: 'm.sokolova@example.com' }, url: teams, platform: 'teams' },
  { who: { name: 'Алексей Петров', email: 'a.petrov@example.com' }, url: teams, platform: 'teams' },
  { who: { name: 'Ольга Васильева', email: 'o.vasilieva@example.com' }, url: zoom, platform: 'zoom' },
  { who: { name: 'Сергей Морозов', email: 's.morozov@example.com' }, url: ktalk, platform: 'ktalk' },
  { who: { name: 'Екатерина Белова', email: 'e.belova@example.com' }, platform: 'generic' },
  { who: { name: 'Павел Никитин', email: 'p.nikitin@example.com' }, url: zoom, platform: 'zoom' },
];

const STATS_TITLES = ['Синк по релизу', 'Разбор инцидента', 'Ревью дизайна', 'Планирование спринта', 'Обзор метрик', 'Созвон с заказчиком', 'Бюджет направления', 'Архитектурный комитет'];
const STATS_LENGTHS = [30, 60, 45, 90];

/**
 * Fictional meetings for one statistics period: deterministic (the same period always gives the
 * same numbers), no Exchange and no network. The week holds what makes the window interesting —
 * meetings back to back, an all-day duty that must not turn into 24 hours, a cancelled and a
 * declined one that must not count, calls on several platforms and meetings of the person's own.
 */
export function demoStatsEvents(req: StatsRequest): CalendarEvent[] {
  const periodStart = Date.parse(req.start);
  const periodEnd = Date.parse(req.end);
  if (Number.isNaN(periodStart) || Number.isNaN(periodEnd) || periodEnd <= periodStart) return [];
  const out: CalendarEvent[] = [];
  let seq = 0;

  const add = (from: number, minutes: number, title: string, cast: number | null, extra: Partial<CalendarEvent> = {}) => {
    const to = from + minutes * 60_000;
    if (from >= periodEnd || to <= periodStart) return;
    const member = cast === null ? undefined : STATS_CAST[cast % STATS_CAST.length];
    seq += 1;
    out.push({
      id: `demo-stats-${seq}`,
      changeKey: `ck-stats-${seq}`,
      title,
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      isAllDay: false,
      organizer: member?.who.name,
      organizerEmail: member?.who.email,
      joinUrl: member?.url,
      platform: member?.url ? member.platform : 'generic',
      isCancelled: false,
      // No organizer in the cast means the person runs the meeting themselves.
      isOrganizer: !member,
      responseType: member ? 'accepted' : 'organizer',
      categories: [],
      isRecurring: false,
      ...extra,
    });
  };

  const first = new Date(periodStart);
  for (let day = new Date(first.getFullYear(), first.getMonth(), first.getDate()); day.getTime() < periodEnd; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) continue;
    const at = (minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime();
    const h = fnv(`stats|${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);

    add(at(9 * 60 + 30), 15, 'Стендап команды', 0, { isRecurring: true });
    // A chain from 11:00: some meetings begin the moment the previous one ends, which is what the
    // "back to back" number counts.
    let minute = 11 * 60;
    const blocks = 2 + (h % 3);
    for (let j = 0; j < blocks; j++) {
      const hj = h >>> (3 * j);
      const length = STATS_LENGTHS[hj % STATS_LENGTHS.length];
      if (j > 0) minute += ((hj >>> 2) % 3) * 30;
      if (minute + length > 19 * 60) break;
      add(at(minute), length, STATS_TITLES[(hj >>> 4) % STATS_TITLES.length], 1 + ((hj >>> 6) % (STATS_CAST.length - 1)));
      minute += length;
    }
    if (weekday === 2) add(at(16 * 60), 60, 'Интервью: фронтенд-разработчик', null, { joinUrl: ktalk, platform: 'ktalk' });
    if (weekday === 1) add(at(15 * 60), 45, 'Продуктовый комитет', 2, { responseType: 'tentative' });
    if (weekday === 3) add(at(17 * 60), 30, 'Обучение: доступность интерфейсов', 5, { responseType: 'notResponded' });
    if (weekday === 4) add(at(12 * 60), 30, 'Отменено: Ретроспектива', 3);
    if (weekday === 5) add(at(13 * 60), 60, 'Открытый разговор', 4, { responseType: 'declined' });
    // Duty is an all-day entry over two days: it counts as days, never as 48 hours.
    if (weekday === 1 && h % 2 === 0) {
      const from = at(0);
      seq += 1;
      out.push({
        id: `demo-stats-${seq}`,
        changeKey: `ck-stats-${seq}`,
        title: 'Дежурство по релизу',
        start: new Date(from).toISOString(),
        end: new Date(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 2).getTime()).toISOString(),
        isAllDay: true,
        platform: 'generic',
        isCancelled: false,
        isOrganizer: true,
        responseType: 'organizer',
        categories: [],
        isRecurring: false,
      });
    }
  }
  return out;
}
