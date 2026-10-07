// What the right-click "Copy" menu on a meeting puts on the clipboard, and what its items say.
// Pure and shared: the main process builds the native menu from this and the text is composed from
// the meeting the main process itself holds, never from anything the page sends.
import type { CalendarEvent } from './types';
import { displayTitle, joinUrlForActions } from './events';
import { safeUrl } from './meetingUrl';
import { oneLine } from './text';

export type MenuLang = 'ru' | 'en';

const MONTHS: Record<MenuLang, readonly string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** Our own tables instead of Intl: the text is the same on every machine and in every test run. */
const day = (d: Date, lang: MenuLang) => `${d.getDate()} ${MONTHS[lang][d.getMonth()]}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sameDate = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const NO_TITLE: Record<MenuLang, string> = { ru: '(без темы)', en: '(no title)' };
const ALL_DAY: Record<MenuLang, string> = { ru: 'весь день', en: 'all day' };

/** "7 окт, 15:00–16:00"; across midnight "7 окт, 23:00 – 8 окт, 01:00"; all day "7 окт, весь день". Empty when the dates are unusable. */
export function whenText(e: Pick<CalendarEvent, 'start' | 'end' | 'isAllDay'>, lang: MenuLang): string {
  const start = new Date(e.start);
  const end = new Date(e.end);
  if (Number.isNaN(start.getTime())) return '';
  if (e.isAllDay) {
    // An all-day meeting ends at the midnight after its last day.
    const last = Number.isNaN(end.getTime()) || end <= start ? start : new Date(end.getTime() - 1);
    return `${sameDate(start, last) ? day(start, lang) : `${day(start, lang)} – ${day(last, lang)}`}, ${ALL_DAY[lang]}`;
  }
  if (Number.isNaN(end.getTime())) return `${day(start, lang)}, ${hhmm(start)}`;
  if (sameDate(start, end)) return `${day(start, lang)}, ${hhmm(start)}–${hhmm(end)}`;
  return `${day(start, lang)}, ${hhmm(start)} – ${day(end, lang)}, ${hhmm(end)}`;
}

export interface MeetingCopy {
  /** One line, no control characters. */
  title: string;
  /** The join link, only when the meeting has a safe one and is not cancelled. */
  link?: string;
  /** "Планёрка — 7 окт, 15:00–16:00 — https://…" (the link part is left out when there is none). */
  all: string;
}

export function meetingCopy(e: CalendarEvent, lang: MenuLang): MeetingCopy {
  const title = oneLine(displayTitle(e), 300) || NO_TITLE[lang];
  const link = safeUrl(joinUrlForActions(e)) ?? undefined;
  const all = [title, whenText(e, lang), link].filter(Boolean).join(' — ');
  return { title, link, all };
}

export interface MenuItemDef {
  kind: 'title' | 'link' | 'all';
  label: string;
  /** What goes to the clipboard. */
  text: string;
}

/** The items of the menu for one meeting: "copy link" only when there is a link to copy. */
export function meetingMenuItems(e: CalendarEvent, lang: MenuLang): MenuItemDef[] {
  const c = meetingCopy(e, lang);
  const ru = lang === 'ru';
  const items: MenuItemDef[] = [{ kind: 'title', label: ru ? 'Копировать название' : 'Copy title', text: c.title }];
  if (c.link) items.push({ kind: 'link', label: ru ? 'Копировать ссылку' : 'Copy link', text: c.link });
  items.push({
    kind: 'all',
    label: c.link ? (ru ? 'Копировать название, время и ссылку' : 'Copy title, time and link') : ru ? 'Копировать название и время' : 'Copy title and time',
    text: c.all,
  });
  return items;
}
