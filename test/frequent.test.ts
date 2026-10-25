import { describe, expect, it } from 'vitest';

import {
    frequentPeople,
    frequentPlaces,
    MAX_RECENT_PEOPLE,
    placeText,
    RECENT_KEEP_MS,
    RecentBook,
} from '../src/shared/frequent';
import { type CalendarEvent } from '../src/shared/types';

const now = new Date('2026-10-26T12:00:00Z');
let n = 0;
function ev(extra: Partial<CalendarEvent> = {}): CalendarEvent {
    n += 1;
    return {
        id: `e${n}`,
        title: 'Встреча',
        start: new Date(now.getTime() - n * 3_600_000).toISOString(),
        end: new Date(now.getTime() - n * 3_600_000 + 1_800_000).toISOString(),
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

describe('places worth offering', () => {
    it('rooms and addresses, not call links or Outlook boilerplate', () => {
        expect(placeText('Переговорная «Байкал», 5 этаж')).toBe('Переговорная «Байкал», 5 этаж');
        expect(placeText('  Кофепоинт\n у лифтов ')).toBe('Кофепоинт у лифтов');
        for (const bad of [
            'https://teams.microsoft.com/l/x',
            'www.zoom.us',
            'Microsoft Teams Meeting',
            'Собрание Microsoft Teams',
            'room@corp.ru',
            'x',
            '',
            undefined,
            'а'.repeat(121),
        ])
            expect(placeText(bad), String(bad)).toBeNull();
    });
    it('drops characters a reader cannot see', () => {
        expect(placeText('Перегов‮орная')).toBe('Переговорная');
    });
});

describe('remembered people and places', () => {
    it('records the meetings the app created and ranks by how often', () => {
        const book = new RecentBook();
        book.record(
            [{ email: 'A.Petrov@corp.ru', name: 'Алексей Петров' }, { email: 'm@corp.ru' }],
            'Переговорная «Ладога»',
            now,
        );
        book.record([{ email: 'a.petrov@corp.ru' }], 'переговорная  «ладога»', now);
        const people = book.listPeople();
        expect(people.find((p) => p.email === 'a.petrov@corp.ru')).toMatchObject({
            count: 2,
            name: 'Алексей Петров',
        });
        expect(book.listPlaces()).toEqual([expect.objectContaining({ count: 2 })]);
        expect(frequentPeople(people, [])[0]).toEqual({
            name: 'Алексей Петров',
            email: 'a.petrov@corp.ru',
        });
    });

    it('ignores what is not an address, and links in the place', () => {
        const book = new RecentBook();
        book.record([{ email: 'not an address' }, { email: 'a@b' }], 'https://zoom.us/j/1', now);
        expect(book.size).toBe(0);
    });

    it('reads the file strictly and forgets what was not used for half a year', () => {
        const old = new Date(now.getTime() - RECENT_KEEP_MS - 1000).toISOString();
        const raw = {
            people: [
                { email: 'ok@corp.ru', name: 'Ок‮', count: 3, last: now.toISOString() },
                { email: 'old@corp.ru', name: 'Old', count: 50, last: old },
                { email: 'bad', name: 'x', count: 1, last: now.toISOString() },
                { email: 'neg@corp.ru', count: -1, last: now.toISOString() },
                { email: 'nan@corp.ru', count: 1.5, last: now.toISOString() },
                'junk',
            ],
            places: [
                { text: 'Комната 1', count: 2, last: now.toISOString() },
                { text: 'https://evil', count: 9, last: now.toISOString() },
                { text: 'Старая', count: 2, last: old },
            ],
        };
        const book = RecentBook.parse(raw, now);
        expect(book.listPeople().map((p) => p.email)).toEqual(['ok@corp.ru']);
        expect(book.listPeople()[0].name).toBe('Ок');
        expect(book.listPlaces().map((p) => p.text)).toEqual(['Комната 1']);
        for (const junk of [null, 'x', [], { people: 'x' }])
            expect(RecentBook.parse(junk, now).size).toBe(0);
    });

    it('keeps at most the limit, the most used first', () => {
        const book = new RecentBook();
        for (let i = 0; i < MAX_RECENT_PEOPLE + 30; i++)
            book.record([{ email: `p${i}@corp.ru` }], '', now);
        book.record([{ email: 'p0@corp.ru' }], '', now);
        expect(book.listPeople().length).toBe(MAX_RECENT_PEOPLE);
        expect(book.listPeople().some((p) => p.email === 'p0@corp.ru')).toBe(true);
    });

    it('round-trips through JSON and can be cleared', () => {
        const book = new RecentBook();
        book.record([{ email: 'a@corp.ru', name: 'A' }], 'Комната', now);
        // Through the same text the file holds (toJSON), not a structural copy of the object.
        const fileText = JSON.stringify(book);
        const again = RecentBook.parse(JSON.parse(fileText), now);
        expect(again.listPeople()).toEqual(book.listPeople());
        expect(again.clear()).toBe(2);
        expect(again.size).toBe(0);
    });
});

describe('suggestions for the form', () => {
    it('people the app sent meetings to come before organizers seen in the calendar; the person’s own meetings are left out', () => {
        const recent = [
            { email: 'mine@corp.ru', name: 'Выбранный', count: 1, last: now.toISOString() },
        ];
        const events = [
            ev({ organizer: 'Часто', organizerEmail: 'often@corp.ru' }),
            ev({ organizer: 'Часто', organizerEmail: 'often@corp.ru' }),
            ev({ organizer: 'Редко', organizerEmail: 'rare@corp.ru' }),
            ev({ organizer: 'Я', organizerEmail: 'me@corp.ru', isOrganizer: true }),
            ev({ organizer: 'Я', organizerEmail: 'me@corp.ru', isOrganizer: true }),
            ev({ organizer: 'Я', organizerEmail: 'me@corp.ru', isOrganizer: true }),
        ];
        expect(frequentPeople(recent, events).map((p) => p.email)).toEqual([
            'mine@corp.ru',
            'often@corp.ru',
            'rare@corp.ru',
        ]);
        expect(frequentPeople(recent, events, 1)).toHaveLength(1);
    });

    it('a remembered address without a name takes the organizer’s name from the calendar', () => {
        const p = frequentPeople(
            [{ email: 'often@corp.ru', name: '', count: 1, last: now.toISOString() }],
            [ev({ organizer: 'Мария Соколова', organizerEmail: 'often@corp.ru' })],
        );
        expect(p[0].name).toBe('Мария Соколова');
    });

    it('places: remembered first, then the calendar’s rooms; links, cancelled and all-day ones are left out', () => {
        const recent = [{ text: 'Моя переговорная', count: 1, last: now.toISOString() }];
        const events = [
            ev({ location: 'Байкал' }),
            ev({ location: 'Байкал' }),
            ev({ location: 'https://zoom.us/j/1' }),
            ev({ location: 'Отменённая', isCancelled: true }),
            ev({ location: 'Весь день', isAllDay: true }),
        ];
        expect(frequentPlaces(recent, events)).toEqual(['Моя переговорная', 'Байкал']);
    });
});
