import { describe, expect, it } from 'vitest';
import { calendarDateValue, calendarView, dateOfCalendarDay, parseCalendarSelection } from '../src/shared/calendar';
import type { CalendarEvent } from '../src/shared/types';

const now = new Date(2026, 9, 15, 12);
const event: CalendarEvent = {
  id: 'meeting-1', changeKey: 'ck', title: 'Team', start: new Date(2026, 9, 17, 10).toISOString(),
  end: new Date(2026, 9, 17, 11).toISOString(), isAllDay: false, platform: 'generic',
  isCancelled: false, isOrganizer: false, responseType: 'accepted', categories: [], isRecurring: false,
};

describe('calendar window selection', () => {
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '1969-12-31', '2201-01-01', '2026-1-01', '2026-10-15T12:00:00Z'])('rejects invalid day %s', day => {
    expect(() => parseCalendarSelection({ day })).toThrow();
  });
  it('accepts leap days and keeps a local date round trip', () => {
    expect(calendarDateValue(dateOfCalendarDay('2028-02-29'))).toBe('2028-02-29');
    expect(parseCalendarSelection({ day: '2028-02-29', eventId: event.id, title: 'ignored' })).toEqual({ day: '2028-02-29', eventId: event.id });
  });
  it.each([42, [], '2026-10-15', { eventId: '' }, { eventId: {} }])('rejects invalid IPC payload %j', raw => {
    expect(() => parseCalendarSelection(raw)).toThrow();
  });
  it('opens today by default and preserves a day without an event', () => {
    expect(calendarDateValue(calendarView(null, [], now).day)).toBe('2026-10-15');
    expect(calendarView({ day: '2026-10-16' }, [], now)).toEqual({ day: dateOfCalendarDay('2026-10-16'), eventId: null });
  });
  it('follows a moved meeting instead of the stale popup date', () => {
    expect(calendarView({ day: '2026-10-16', eventId: event.id }, [event], now)).toEqual({ day: dateOfCalendarDay('2026-10-17'), eventId: event.id });
  });
  it('retains the day but drops a meeting deleted during navigation', () => {
    expect(calendarView({ day: '2026-10-16', eventId: event.id }, [], now)).toEqual({ day: dateOfCalendarDay('2026-10-16'), eventId: null });
  });
});
