// Fictional meetings for `npm run dev:demo` and screenshots. No Exchange needed.
import type { CalendarEvent, EventDetails } from '../shared/types';

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
