// Fictional people and places for the demo's "Create meeting" form. No Exchange needed.
import { type RecentPerson, type RecentPlace } from '../shared/frequent';

/** Fictional "people and places you meet most" for the demo form. */
export function demoRecent(now = new Date()): { people: RecentPerson[]; places: RecentPlace[] } {
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    const people = [
        ['m.sokolova', 'Мария Соколова', 9, 1],
        ['a.petrov', 'Алексей Петров', 7, 2],
        ['i.ivanov', 'Иван Иванов', 5, 3],
        ['o.vasilieva', 'Ольга Васильева', 3, 6],
        ['n.frolov', 'Никита Фролов', 2, 9],
    ] as const;
    const places = [
        ['Переговорная «Байкал», 5 этаж', 6, 1],
        ['Переговорная «Ладога», 3 этаж', 3, 4],
        ['Кофепоинт у лифтов', 2, 8],
    ] as const;
    return {
        people: people.map(([user, name, count, days]) => ({
            email: `${user}@example.com`,
            name,
            count,
            last: ago(days),
        })),
        places: places.map(([text, count, days]) => ({ text, count, last: ago(days) })),
    };
}
