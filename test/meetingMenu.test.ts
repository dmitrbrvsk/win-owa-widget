import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/shared/types';
import { meetingCopy, meetingMenuItems, whenText } from '../src/shared/meetingMenu';
import { parseId } from '../src/shared/validate';

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0';
let n = 0;
const ev = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `m${++n}`,
  changeKey: 'ck',
  title: 'Планёрка',
  start: at(7, 15),
  end: at(7, 16),
  isAllDay: false,
  platform: 'teams',
  joinUrl: LINK,
  isCancelled: false,
  isOrganizer: false,
  responseType: 'accepted',
  categories: [],
  isRecurring: false,
  ...extra,
});

describe('copy text of a meeting', () => {
  it('is "title — date, time — link"', () => {
    expect(meetingCopy(ev(), 'ru').all).toBe(`Планёрка — 7 окт, 15:00–16:00 — ${LINK}`);
    expect(meetingCopy(ev({ title: 'Planning' }), 'en').all).toBe(`Planning — 7 Oct, 15:00–16:00 — ${LINK}`);
    expect(meetingCopy(ev(), 'ru')).toMatchObject({ title: 'Планёрка', link: LINK });
  });

  it('leaves the link out when there is none', () => {
    const c = meetingCopy(ev({ joinUrl: undefined, platform: 'generic' }), 'ru');
    expect(c.link).toBeUndefined();
    expect(c.all).toBe('Планёрка — 7 окт, 15:00–16:00');
  });

  it('gives no link for a cancelled meeting, and shows its title without the prefix', () => {
    const c = meetingCopy(ev({ title: 'Отменено: Планёрка' }), 'ru');
    expect(c.title).toBe('Планёрка');
    expect(c.link).toBeUndefined();
    expect(meetingCopy(ev({ isCancelled: true }), 'ru').link).toBeUndefined();
  });

  it('never copies a link that is not a plain web link', () => {
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'https://trusted.example@evil.example/', 'https://x.example/\u202eabc']) {
      expect(meetingCopy(ev({ joinUrl: bad }), 'ru').link).toBeUndefined();
    }
  });

  it('cleans a title written by a stranger: one line, no control or bidi characters, bounded', () => {
    const t = meetingCopy(ev({ title: 'Первая\nвторая\r\n\tтретья\u202e\u0000 конец' }), 'ru').title;
    expect(t).toBe('Первая вторая третья конец');
    expect(meetingCopy(ev({ title: 'я'.repeat(5000) }), 'ru').title).toHaveLength(300);
    expect(meetingCopy(ev({ title: '   ' }), 'ru').title).toBe('(без темы)');
    expect(meetingCopy(ev({ title: '' }), 'en').title).toBe('(no title)');
  });

  it('is a single line even when the title tries to be several', () => {
    expect(meetingCopy(ev({ title: 'a\nb\nc' }), 'en').all).not.toContain('\n');
  });

  it('writes the time of a meeting across midnight, an all-day one and a long one', () => {
    expect(whenText({ start: at(7, 23), end: at(8, 1), isAllDay: false }, 'ru')).toBe('7 окт, 23:00 – 8 окт, 01:00');
    expect(whenText({ start: at(7, 0), end: at(8, 0), isAllDay: true }, 'ru')).toBe('7 окт, весь день');
    expect(whenText({ start: at(7, 0), end: at(10, 0), isAllDay: true }, 'en')).toBe('7 Oct – 9 Oct, all day');
    expect(whenText({ start: at(7, 9, 5), end: at(7, 9, 5), isAllDay: false }, 'ru')).toBe('7 окт, 09:05–09:05');
  });

  it('survives unusable dates', () => {
    expect(whenText({ start: 'nonsense', end: at(7, 9), isAllDay: false }, 'ru')).toBe('');
    expect(whenText({ start: at(7, 9), end: 'nonsense', isAllDay: false }, 'ru')).toBe('7 окт, 09:00');
    const c = meetingCopy(ev({ start: 'nonsense', end: 'nonsense' }), 'ru');
    expect(c.all).toBe(`Планёрка — ${LINK}`);
  });
});

describe('items of the menu', () => {
  it('offers title, link and everything when the meeting has a link', () => {
    const items = meetingMenuItems(ev(), 'ru');
    expect(items.map((i) => i.kind)).toEqual(['title', 'link', 'all']);
    expect(items.map((i) => i.label)).toEqual(['Копировать название', 'Копировать ссылку', 'Копировать название, время и ссылку']);
    expect(items.map((i) => i.text)).toEqual(['Планёрка', LINK, `Планёрка — 7 окт, 15:00–16:00 — ${LINK}`]);
  });

  it('does not offer a link that is not there, and says what the last item copies then', () => {
    const items = meetingMenuItems(ev({ joinUrl: undefined }), 'ru');
    expect(items.map((i) => i.kind)).toEqual(['title', 'all']);
    expect(items[1].label).toBe('Копировать название и время');
    expect(items[1].text).toBe('Планёрка — 7 окт, 15:00–16:00');
    expect(meetingMenuItems(ev({ isCancelled: true }), 'ru').map((i) => i.kind)).toEqual(['title', 'all']);
  });

  it('speaks English', () => {
    expect(meetingMenuItems(ev(), 'en').map((i) => i.label)).toEqual(['Copy title', 'Copy link', 'Copy title, time and link']);
    expect(meetingMenuItems(ev({ joinUrl: undefined }), 'en')[1].label).toBe('Copy title and time');
  });

  it('takes the id from the page only as a string of sane length', () => {
    expect(parseId('AAMk-abc=')).toBe('AAMk-abc=');
    for (const bad of [undefined, null, 5, {}, [], '', 'x'.repeat(2049)]) expect(() => parseId(bad)).toThrow();
  });
});
