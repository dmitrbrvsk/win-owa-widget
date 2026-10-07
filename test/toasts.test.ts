import { describe, expect, it } from 'vitest';
import { describeChange } from '../src/shared/changes';
import { doneText, inviteToast, layoutToast, noteToast, reminderToast, resolveAction } from '../src/shared/toasts';
import { sanitizeSettings } from '../src/shared/validate';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import type { CalendarEvent } from '../src/shared/types';

const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m).toISOString();
const NOW = new Date(2026, 9, 7, 14, 55);

function ev(id: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: `Планёрка ${id}`,
    start: at(15),
    end: at(16),
    isAllDay: false,
    platform: 'teams',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    categories: [],
    isRecurring: false,
    organizer: 'Иван Иванов',
    ...over,
  };
}

describe('reminder notification', () => {
  it('one meeting with a link: a snooze drop-down, then Join and Snooze', () => {
    const def = reminderToast([ev('a')], NOW, 'ru');
    expect(def.title).toBe('Встреча через 5 мин');
    expect(def.body).toContain('Планёрка a');
    expect(def.body).toContain('Иван Иванов');
    expect(def.selection?.minutes).toEqual([5, 10, 15]);
    expect(def.buttons.map((b) => b.id)).toEqual(['join', 'snooze']);
    expect(def.buttons[0].text).toBe('Подключиться');
  });

  it('a meeting without a link has no Join button', () => {
    const def = reminderToast([ev('a', { joinUrl: undefined, platform: 'generic' })], NOW, 'ru');
    expect(def.buttons.map((b) => b.id)).toEqual(['snooze']);
  });

  it('a link to an unfamiliar site names the real host on the button', () => {
    const def = reminderToast([ev('a', { platform: 'generic', joinUrl: 'https://evil.example/room' })], NOW, 'en');
    expect(def.buttons[0].text).toBe('Join · evil.example');
  });

  it('several meetings: Open instead of a guess about which one to join', () => {
    const def = reminderToast([ev('a'), ev('b', { start: at(15, 5) }), ev('c', { start: at(15, 6) }), ev('d', { start: at(15, 7) })], NOW, 'ru');
    expect(def.title).toContain('4 встречи');
    expect(def.buttons.map((b) => b.id)).toEqual(['open', 'snooze']);
    expect(def.body).toContain('…и ещё 1');
    expect(def.eventId).toBeUndefined();
  });

  it('a meeting that has started says so', () => {
    expect(reminderToast([ev('a', { start: at(14, 50), end: at(16) })], NOW, 'en').title).toBe('Meeting is starting');
  });

  it('a stranger\'s title cannot add lines or hidden characters', () => {
    const def = reminderToast([ev('a', { title: 'Плановая‮\nвстреча\u0007' + 'x'.repeat(500) })], NOW, 'ru');
    const [titleLine] = def.body.split('\n');
    expect(titleLine).not.toMatch(/[‮\u0007]/);
    expect(titleLine.length).toBeLessThanOrEqual(100);
    expect(def.body.split('\n')).toHaveLength(2);
  });
});

describe('which button was pressed', () => {
  const def = reminderToast([ev('a')], NOW, 'ru');
  const layout = layoutToast(def);

  it('puts the drop-down first, then the buttons, and numbers them in that order', () => {
    expect(layout.actions.map((a) => a.type)).toEqual(['selection', 'button', 'button']);
    expect(layout.slots).toEqual(['selection', 'join', 'snooze']);
  });

  it('Join is Join, Snooze is Snooze', () => {
    expect(resolveAction(def, layout, 1, -1)?.id).toBe('join');
    expect(resolveAction(def, layout, 2, 1)).toEqual({ id: 'snooze', minutes: 10 });
  });

  it('an untouched drop-down means the first choice', () => {
    expect(resolveAction(def, layout, 2, -1)).toEqual({ id: 'snooze', minutes: 5 });
  });

  it('a drop-down value out of range falls back to the first choice', () => {
    for (const bad of [3, 99, -5, 1.5, NaN]) expect(resolveAction(def, layout, 2, bad)?.minutes).toBe(5);
  });

  it('the drop-down itself and unknown entries do nothing', () => {
    expect(resolveAction(def, layout, 0, 1)).toBeNull();
    expect(resolveAction(def, layout, 7, 0)).toBeNull();
    expect(resolveAction(def, layout, -1, 0)).toBeNull();
    expect(resolveAction(def, layout, NaN, 0)).toBeNull();
  });

  it('without a drop-down the buttons start at zero', () => {
    const invite = inviteToast('t', 'b', 'a', 'ru');
    const l = layoutToast(invite);
    expect(l.slots).toEqual(['accept']);
    expect(resolveAction(invite, l, 0, -1)?.id).toBe('accept');
  });
});

describe('notifications about changes', () => {
  const invited = describeChange({ kind: 'invited', event: ev('n', { responseType: 'notResponded' }) }, NOW, 'ru');

  it('a new invitation offers Accept; clicking the text opens the meeting', () => {
    const def = noteToast(invited, 'ru');
    expect(def.buttons).toEqual([{ id: 'accept', text: 'Принять' }]);
    expect(def.eventId).toBe('n');
    expect(def.selection).toBeUndefined();
  });

  it('a move or a cancellation is text only', () => {
    const moved = describeChange({ kind: 'moved', event: ev('m', { start: at(16), end: at(17) }), was: ev('m') }, NOW, 'ru');
    expect(noteToast(moved, 'ru').buttons).toEqual([]);
    const cancelled = describeChange({ kind: 'cancelled', event: ev('c', { isCancelled: true }), was: ev('c') }, NOW, 'ru');
    expect(noteToast(cancelled, 'ru').buttons).toEqual([]);
  });

  it('only a new invitation can carry Accept', () => {
    expect(describeChange({ kind: 'moved', event: ev('m'), was: ev('m') }, NOW, 'ru').accept).toBeUndefined();
    expect(describeChange({ kind: 'cancelled', event: ev('c'), was: ev('c') }, NOW, 'ru').accept).toBeUndefined();
    expect(invited.accept).toBe(true);
  });

  it('has the words for the result of Accept in both languages', () => {
    expect(doneText('ru').accepted).toMatch(/принято/);
    expect(doneText('en').failed).toMatch(/Could not/);
  });
});

describe('reminder style setting', () => {
  it('takes only the three known values', () => {
    for (const ok of ['auto', 'system', 'window'] as const) expect(sanitizeSettings({ reminderStyle: ok }, DEFAULT_SETTINGS).reminderStyle).toBe(ok);
    for (const bad of ['popup', '', 1, null, {}, ['system']]) expect(sanitizeSettings({ reminderStyle: bad }, DEFAULT_SETTINGS).reminderStyle).toBe('auto');
  });
});
