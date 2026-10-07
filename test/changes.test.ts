import { describe, expect, it } from 'vitest';
import { describeChange, describeChanges, diffEvents, whenText } from '../src/shared/changes';
import type { CalendarEvent } from '../src/shared/types';

// Built from local wall-clock times so the expectations hold in any time zone.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const NOW = new Date(2026, 9, 7, 12, 0);

function ev(id: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: `Встреча ${id}`,
    start: at(7, 15),
    end: at(7, 16),
    isAllDay: false,
    platform: 'generic',
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    categories: [],
    isRecurring: false,
    ...over,
  };
}

describe('what changed between two syncs', () => {
  it('says nothing the first time: there is nothing to compare with', () => {
    expect(diffEvents([], [ev('a', { responseType: 'notResponded' })], NOW)).toEqual([]);
  });

  it('notices a moved meeting', () => {
    const [c] = diffEvents([ev('a')], [ev('a', { start: at(7, 16), end: at(7, 17) })], NOW);
    expect(c.kind).toBe('moved');
    expect(c.was?.start).toBe(at(7, 15));
  });

  it('notices a cancellation, by flag or by Exchange\'s subject prefix', () => {
    expect(diffEvents([ev('a')], [ev('a', { isCancelled: true })], NOW)[0].kind).toBe('cancelled');
    expect(diffEvents([ev('a')], [ev('a', { title: 'Отменено: Встреча a' })], NOW)[0].kind).toBe('cancelled');
  });

  it('a cancelled meeting that is also moved is told once, as cancelled', () => {
    const c = diffEvents([ev('a')], [ev('a', { isCancelled: true, start: at(8, 10), end: at(8, 11) })], NOW);
    expect(c.map((x) => x.kind)).toEqual(['cancelled']);
  });

  it('notices an invitation from someone else, but not a meeting that is already answered or mine', () => {
    const before = [ev('a')];
    expect(diffEvents(before, [...before, ev('b', { responseType: 'notResponded' })], NOW).map((c) => c.kind)).toEqual(['invited']);
    expect(diffEvents(before, [...before, ev('b', { responseType: 'accepted' })], NOW)).toEqual([]);
    expect(diffEvents(before, [...before, ev('b', { responseType: 'notResponded', isOrganizer: true })], NOW)).toEqual([]);
    expect(diffEvents(before, [...before, ev('b', { responseType: 'notResponded', isCancelled: true })], NOW)).toEqual([]);
  });

  it('ignores meetings that are over, unchanged ones, and my own answer', () => {
    const past = ev('p', { start: at(7, 9), end: at(7, 10) });
    expect(diffEvents([past], [{ ...past, start: at(7, 9, 30) }], NOW)).toEqual([]);
    expect(diffEvents([ev('a')], [ev('a')], NOW)).toEqual([]);
    expect(diffEvents([ev('a', { responseType: 'notResponded' })], [ev('a', { responseType: 'accepted', changeKey: 'new' })], NOW)).toEqual([]);
  });

  it('a meeting that disappears is not announced (the person may have deleted it)', () => {
    expect(diffEvents([ev('a'), ev('b')], [ev('a')], NOW)).toEqual([]);
  });
});

describe('notification text', () => {
  it('moved: the new time, and what it was', () => {
    const [c] = diffEvents([ev('a', { title: 'Синк' })], [ev('a', { title: 'Синк', start: at(7, 16), end: at(7, 16, 45) })], NOW);
    const n = describeChange(c, NOW, 'ru');
    expect(n.title).toBe('Встречу перенесли');
    expect(n.body).toBe('Синк\nТеперь сегодня 16:00–16:45 (было 15:00)');
    expect(n.eventId).toBe('a');
    expect(describeChange(c, NOW, 'en').title).toBe('Meeting rescheduled');
  });

  it('moved to another day names the day for both times', () => {
    const [c] = diffEvents([ev('a')], [ev('a', { start: at(8, 11), end: at(8, 12) })], NOW);
    expect(describeChange(c, NOW, 'ru').body).toContain('завтра 11:00–12:00 (было сегодня 15:00–16:00)');
  });

  it('invitation: who invites, to what, when', () => {
    const [c] = diffEvents([ev('a')], [ev('a'), ev('b', { title: 'Ретро', organizer: 'Иван Иванов', responseType: 'notResponded', start: at(8, 11), end: at(8, 12) })], NOW);
    expect(describeChange(c, NOW, 'ru').body).toBe('Иван Иванов приглашает на «Ретро»\nзавтра 11:00–12:00');
    expect(describeChange(c, NOW, 'en').body).toContain('Иван Иванов invites you to “Ретро”');
  });

  it('cancelled: the strike-through title without Exchange\'s prefix', () => {
    const [c] = diffEvents([ev('a')], [ev('a', { title: 'Отменено: Синк' })], NOW);
    const n = describeChange(c, NOW, 'ru');
    expect(n.title).toBe('Встречу отменили');
    expect(n.body.split('\n')[0]).toBe('Синк');
  });

  it('a stranger\'s subject line stays one short clean line', () => {
    const [c] = diffEvents([ev('a')], [ev('a'), ev('b', { title: 'Срочно\n\nНажмите здесь‮' + 'я'.repeat(500), responseType: 'notResponded' })], NOW);
    const first = describeChange(c, NOW, 'ru').body.split('\n')[0];
    expect(first).not.toMatch(/[‮]/);
    expect(first.length).toBeLessThan(160);
  });

  it('a series edited at once becomes one summary, not a storm', () => {
    const before = Array.from({ length: 10 }, (_, i) => ev(`s${i}`));
    const after = before.map((e) => ({ ...e, start: at(7, 17), end: at(7, 18) }));
    const notes = describeChanges(diffEvents(before, after, NOW), NOW, 'ru');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Изменения в календаре');
    expect(notes[0].body).toBe('перенесено: 10');
    expect(notes[0].eventId).toBeUndefined();
  });

  it('up to three are told one by one', () => {
    const before = [ev('a'), ev('b')];
    const after = [ev('a', { isCancelled: true }), ev('b', { start: at(7, 17), end: at(7, 18) }), ev('c', { responseType: 'notResponded' })];
    expect(describeChanges(diffEvents(before, after, NOW), NOW, 'ru').map((n) => n.title)).toEqual(['Встречу отменили', 'Встречу перенесли', 'Новое приглашение']);
  });

  it('all-day meetings give just the day', () => {
    expect(whenText({ start: at(8, 0), end: at(9, 0), isAllDay: true }, NOW, 'ru')).toBe('завтра');
  });
});

describe('the notification setting', () => {
  it('is on by default and only a boolean is accepted from the settings page', async () => {
    const { sanitizeSettings } = await import('../src/shared/validate');
    const { DEFAULT_SETTINGS } = await import('../src/main/store.defaults');
    expect(DEFAULT_SETTINGS.notifyChanges).toBe(true);
    expect(sanitizeSettings({ notifyChanges: false }, DEFAULT_SETTINGS).notifyChanges).toBe(false);
    expect(sanitizeSettings({ notifyChanges: 'no' }, DEFAULT_SETTINGS).notifyChanges).toBe(true);
  });
});
