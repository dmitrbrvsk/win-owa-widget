import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/shared/types';
import { canDecline, conflictsInRange, conflictsOf } from '../src/shared/conflicts';

const day = (h: number, m = 0) => new Date(2026, 9, 12, h, m).toISOString();
let n = 0;
const ev = (from: [number, number?], to: [number, number?], extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `c${++n}`,
  changeKey: 'ck',
  title: `Встреча ${n}`,
  start: day(from[0], from[1] ?? 0),
  end: day(to[0], to[1] ?? 0),
  isAllDay: false,
  platform: 'generic',
  isCancelled: false,
  isOrganizer: false,
  responseType: 'accepted',
  categories: [],
  isRecurring: false,
  ...extra,
});

describe('conflicts', () => {
  it('finds accepted, tentative and own meetings that overlap, in time order', () => {
    const target = ev([10], [11], { responseType: 'notResponded' });
    const a = ev([10, 30], [11, 30]);
    const b = ev([9], [10, 15], { responseType: 'tentative' });
    const c = ev([10, 10], [10, 20], { responseType: 'organizer', isOrganizer: true });
    expect(conflictsOf(target, [target, a, b, c]).map((e) => e.id)).toEqual([b.id, c.id, a.id]);
  });

  it('does not count what cannot block the time', () => {
    const target = ev([10], [11], { responseType: 'notResponded' });
    const others = [
      ev([10], [11], { responseType: 'declined' }),
      ev([10], [11], { responseType: 'notResponded' }), // another unanswered invitation
      ev([10], [11], { isCancelled: true }),
      ev([10], [11], { title: 'Отменено: Ретро' }),
      ev([0], [23, 59], { isAllDay: true }),
    ];
    expect(conflictsOf(target, [target, ...others])).toEqual([]);
  });

  it('lets meetings that only touch stand side by side', () => {
    const target = ev([10], [11], { responseType: 'notResponded' });
    expect(conflictsOf(target, [target, ev([9], [10]), ev([11], [12])])).toEqual([]);
  });

  it('never reports the meeting against itself, and has nothing to say about a cancelled or all-day one', () => {
    const self = ev([10], [11]);
    expect(conflictsOf(self, [self])).toEqual([]);
    const gone = ev([10], [11], { isCancelled: true });
    expect(conflictsOf(gone, [gone, ev([10], [11])])).toEqual([]);
    const allDay = ev([0], [23, 59], { isAllDay: true });
    expect(conflictsOf(allDay, [allDay, ev([10], [11])])).toEqual([]);
  });

  it('checks a proposed span the same way, and ignores an empty or backwards one', () => {
    const busy = ev([14], [15]);
    expect(conflictsInRange(new Date(day(14, 30)), new Date(day(15, 30)), [busy])).toEqual([busy]);
    expect(conflictsInRange(new Date(day(15)), new Date(day(16)), [busy])).toEqual([]);
    expect(conflictsInRange(new Date(day(15)), new Date(day(14)), [busy])).toEqual([]);
    expect(conflictsInRange(new Date(day(14, 30)), new Date(day(15, 30)), [busy], busy.id)).toEqual([]);
  });

  it('offers to decline only someone else’s meeting that still takes an answer', () => {
    expect(canDecline(ev([10], [11]))).toBe(true);
    expect(canDecline(ev([10], [11], { isOrganizer: true, responseType: 'organizer' }))).toBe(false);
    expect(canDecline(ev([10], [11], { responseType: 'declined' }))).toBe(false);
    expect(canDecline(ev([10], [11], { changeKey: undefined }))).toBe(false);
    expect(canDecline(ev([10], [11], { isCancelled: true }))).toBe(false);
  });
});
