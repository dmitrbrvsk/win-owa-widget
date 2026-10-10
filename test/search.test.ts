import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/shared/types';
import { fold, MAX_QUERY_LENGTH, MAX_QUERY_WORDS, queryWords, searchEvents } from '../src/shared/search';

const NOW = new Date(2026, 9, 7, 12, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
let n = 0;
const ev = (title: string, extra: Partial<CalendarEvent> = {}, day = 8, h = 10): CalendarEvent => ({
  id: `s${++n}`,
  changeKey: 'ck',
  title,
  start: at(day, h),
  end: at(day, h + 1),
  isAllDay: false,
  platform: 'generic',
  isCancelled: false,
  isOrganizer: false,
  responseType: 'accepted',
  categories: [],
  isRecurring: false,
  ...extra,
});
const titles = (list: CalendarEvent[]) => list.map((e) => e.title);
const find = (events: CalendarEvent[], q: string, limit?: number) => titles(searchEvents(events, q, NOW, limit));

describe('search: matching', () => {
  it('is case-insensitive and finds a part of a word', () => {
    const events = [ev('Архитектурный комитет'), ev('Стендап')];
    expect(find(events, 'АРХИТЕКТУР')).toEqual(['Архитектурный комитет']);
    expect(find(events, 'тет')).toEqual(['Архитектурный комитет']);
    expect(find(events, 'standup')).toEqual([]);
  });

  it('treats ё and е as the same letter, in the query and in the meeting', () => {
    const events = [ev('Планёрка команды'), ev('Совещание про берёзы')];
    expect(find(events, 'планерка')).toEqual(['Планёрка команды']);
    expect(find(events, 'ПЛАНЁРКА')).toEqual(['Планёрка команды']);
    expect(find(events, 'березы')).toEqual(['Совещание про берёзы']);
    expect(find([ev('Планерка')], 'планёрка')).toEqual(['Планерка']);
    // ё typed as е + combining diaeresis (a decomposed form) is the same letter too.
    expect(find(events, 'план\u0435\u0308рка')).toEqual(['Планёрка команды']);
    expect(fold('ЁЖ Ёлка')).toBe('еж елка');
  });

  it('does not mix up й and и', () => {
    expect(find([ev('Мой план')], 'мои')).toEqual([]);
    expect(find([ev('Мой план')], 'мой')).toEqual(['Мой план']);
  });

  it('requires every word (AND), in any order and in different fields', () => {
    const events = [
      ev('Ретро команды'),
      ev('Ретро платформы'),
      ev('Планёрка', { organizer: 'Иван Иванов', location: 'Байкал' }),
      ev('Демо', { bodyPreview: 'Покажем итоги ретро для команды' }),
    ];
    expect(find(events, 'ретро команды').sort()).toEqual(['Демо', 'Ретро команды'].sort());
    expect(find(events, 'команды ретро').sort()).toEqual(['Демо', 'Ретро команды'].sort());
    expect(find(events, 'планерка иванов')).toEqual(['Планёрка']);
    expect(find(events, 'планерка байкал иванов')).toEqual(['Планёрка']);
    expect(find(events, 'планерка петров')).toEqual([]);
    expect(find(events, 'ретро   \t команды')).toContain('Ретро команды');
  });

  it('searches the title, organizer, location, categories and preview, nothing else', () => {
    const e = ev('Встреча', {
      organizer: 'Мария Соколова',
      location: 'Переговорная «Байкал»',
      categories: ['Красная категория'],
      bodyPreview: 'Обсудим бюджет',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/secret-room',
    });
    for (const q of ['встреча', 'соколова', 'байкал', 'красная', 'бюджет']) expect(searchEvents([e], q, NOW)).toHaveLength(1);
    // The join link is not searched, and neither is the id.
    expect(searchEvents([e], 'secret-room', NOW)).toEqual([]);
    expect(searchEvents([e], e.id, NOW)).toEqual([]);
  });

  it('copes with meetings that lack optional fields', () => {
    const bare = { ...ev('Голая'), organizer: undefined, location: undefined, bodyPreview: undefined } as CalendarEvent;
    const odd = { ...ev('Странная'), categories: undefined } as unknown as CalendarEvent;
    expect(find([bare, odd], 'ая').sort()).toEqual(['Голая', 'Странная']);
  });

  it('returns nothing for an empty or blank query', () => {
    const events = [ev('Что угодно')];
    expect(find(events, '')).toEqual([]);
    expect(find(events, '   \t\n ')).toEqual([]);
    expect(searchEvents(events, undefined as unknown as string, NOW)).toEqual([]);
    expect(searchEvents(events, 42 as unknown as string, NOW)).toEqual([]);
  });
});

describe('search: order', () => {
  it('puts a title match above organizer, location/category and preview matches', () => {
    const events = [
      ev('Другое', { bodyPreview: 'про бюджет' }, 8, 9),
      ev('Другое2', { location: 'Бюджетный зал' }, 8, 9),
      ev('Другое3', { organizer: 'Бюджетов' }, 8, 9),
      ev('Бюджет 2027', {}, 9, 9),
    ];
    expect(find(events, 'бюджет')).toEqual(['Бюджет 2027', 'Другое3', 'Другое2', 'Другое']);
  });

  it('lists upcoming and running meetings soonest first, then past ones latest first', () => {
    const events = [
      ev('Стендап', {}, 5, 10), // past
      ev('Стендап', {}, 9, 10), // upcoming
      ev('Стендап', {}, 6, 10), // past, more recent
      ev('Стендап', {}, 8, 10), // upcoming, sooner
      ev('Стендап', { start: at(7, 11), end: at(7, 13) }), // running now
      ev('Стендап', { start: at(7, 9), end: at(7, 12) }), // ended exactly now: past
    ];
    const hits = searchEvents(events, 'стендап', NOW);
    expect(hits.map((h) => h.start)).toEqual([at(7, 11), at(8, 10), at(9, 10), at(7, 9), at(6, 10), at(5, 10)]);
  });

  it('ranks title relevance above time', () => {
    const past = ev('Ретро', {}, 3, 10);
    const soonByOrganizer = ev('Другое', { organizer: 'Ретров' }, 8, 10);
    expect(searchEvents([soonByOrganizer, past], 'ретро', NOW)).toEqual([past, soonByOrganizer]);
  });

  it('keeps cancelled meetings, marked, after live ones of the same relevance', () => {
    const cancelled = ev('Ретро', { isCancelled: true }, 8, 9);
    const prefixed = ev('Отменено: Ретро', {}, 8, 8);
    const live = ev('Ретро', {}, 9, 9);
    const hits = searchEvents([cancelled, prefixed, live], 'ретро', NOW);
    expect(hits).toEqual([live, prefixed, cancelled]);
  });

  it('is stable for equal meetings and does not change its input', () => {
    const events = [ev('Одинаковая'), ev('Одинаковая'), ev('Одинаковая')];
    const copy = [...events];
    expect(searchEvents(events, 'одинаковая', NOW)).toEqual(events);
    expect(events).toEqual(copy);
  });

  it('caps the number of results', () => {
    const many = Array.from({ length: 80 }, (_, i) => ev('Стендап', {}, 8, 8 + (i % 10)));
    expect(searchEvents(many, 'стендап', NOW)).toHaveLength(50);
    expect(searchEvents(many, 'стендап', NOW, 5)).toHaveLength(5);
    expect(searchEvents(many, 'стендап', NOW, 0)).toEqual([]);
    expect(searchEvents(many, 'стендап', NOW, -3)).toEqual([]);
    expect(searchEvents(many, 'стендап', NOW, NaN)).toHaveLength(50);
    expect(searchEvents(many, 'стендап', NOW, 1e9)).toHaveLength(80);
  });
});

describe('search: hostile input', () => {
  it('cuts the query to its length limit and the words to their number', () => {
    expect(queryWords('a'.repeat(10_000))).toEqual(['a'.repeat(MAX_QUERY_LENGTH)]);
    expect(queryWords('один два три четыре пять шесть семь восемь')).toHaveLength(MAX_QUERY_WORDS);
    expect(queryWords('Слово слово СЛОВО')).toEqual(['слово']);
    expect(queryWords('x '.repeat(5000))).toEqual(['x']);
  });

  it('ignores the words after the sixth', () => {
    const e = ev('а б в г д е');
    expect(searchEvents([e], 'а б в г д е ж з и', NOW)).toEqual([e]);
  });

  it('copes with a 10 000-character query over thousands of meetings, and stays fast', () => {
    const events = Array.from({ length: 3000 }, (_, i) => ev(`Встреча ${i} ` + 'ы'.repeat(400), { organizer: 'Иван Иванов', bodyPreview: 'ф'.repeat(600) }));
    const started = Date.now();
    expect(searchEvents(events, 'q'.repeat(10_000), NOW)).toEqual([]);
    expect(searchEvents(events, 'ы'.repeat(10_000), NOW)).toHaveLength(50); // cut to 100 "ы"; every title has 400
    expect(searchEvents(events, ('ы'.repeat(99) + ' ').repeat(500), NOW)).toHaveLength(50);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('takes regular-expression characters literally', () => {
    const events = [ev('C++ (черновик)'), ev('Отчёт [Q3] $100 ^ a|b'), ev('Обычная')];
    for (const hostile of ['(((', ')', '[', ']', '\\', '(?<=', '*', '+', '?', '.*', '^', '$', '|', '{', '}', '(a+)+$', '[a-', '\\u', '(?P<x>']) {
      expect(() => searchEvents(events, hostile, NOW)).not.toThrow();
    }
    expect(find(events, '(((')).toEqual([]);
    expect(find(events, '.*')).toEqual([]);
    expect(find(events, '(черновик)')).toEqual(['C++ (черновик)']);
    expect(find(events, 'c++')).toEqual(['C++ (черновик)']);
    expect(find(events, '[q3] $100')).toEqual(['Отчёт [Q3] $100 ^ a|b']);
    expect(find(events, 'a|b')).toEqual(['Отчёт [Q3] $100 ^ a|b']);
  });

  it('survives control characters, lone surrogates and odd Unicode', () => {
    const events = [ev('Встреча')];
    for (const q of ['\u0000', '‮‭', '\ud800', '😀'.repeat(300), 'İ'.repeat(200), '\u0000встреча']) {
      expect(() => searchEvents(events, q, NOW)).not.toThrow();
    }
    expect(find(events, '\u0000встреча')).toEqual([]);
  });

  it('does not stall on huge fields either', () => {
    const e = ev('x'.repeat(2_000_000), { bodyPreview: 'y'.repeat(2_000_000), organizer: 'z'.repeat(2_000_000) });
    const started = Date.now();
    expect(searchEvents([e], 'x y z', NOW)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
