import { type Dict, type Lang } from './i18n';

const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'ru-RU');
const INVALID_DATE: Record<Lang, string> = { en: 'Invalid Date', ru: 'Invalid Date' };
const DATE_FORMATS = {
    dayMonthLong: { day: 'numeric', month: 'long' },
    weekdayLong: { weekday: 'long' },
    weekdayShort: { weekday: 'short' },
    dayMonthShort: { day: 'numeric', month: 'short' },
    monthShort: { month: 'short' },
    shortDay: { weekday: 'short', day: 'numeric', month: 'short' },
} as const;
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Fixed UTC formatters render local calendar fields, so a runtime system-zone change cannot stale the cache. */
export function localDateText(
    d: Date | string,
    lang: Lang,
    format: keyof typeof DATE_FORMATS,
): string {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return INVALID_DATE[lang];
    const localFields = new Date(0);
    localFields.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    const key = `${lang}:${format}`;
    let formatter = dateFormatters.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale(lang), {
            ...DATE_FORMATS[format],
            timeZone: 'UTC',
        });
        dateFormatters.set(key, formatter);
    }
    return formatter.format(localFields);
}

export function hm(d: Date | string, lang: Lang): string {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return INVALID_DATE[lang];
    // Both supported locales use HH:mm. Local getters follow the system zone, including future DST.
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function range(start: string, end: string, lang: Lang): string {
    return `${hm(start, lang)}–${hm(end, lang)}`;
}

export function dayTitle(day: Date, today: Date, t: Dict, lang: Lang): string {
    const date = localDateText(day, lang, 'dayMonthLong');
    const diff = Math.round(
        (new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() -
            new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
            86_400_000,
    );
    if (diff === 0) return `${t.today}, ${date}`;
    if (diff === 1) return `${t.tomorrow}, ${date}`;
    if (diff === -1) return `${t.yesterday}, ${date}`;
    const weekday = localDateText(day, lang, 'weekdayLong');
    return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${date}`;
}

export function shortDay(d: Date | string, lang: Lang): string {
    return localDateText(d, lang, 'shortDay');
}

export function duration(min: number, t: Dict): string {
    if (min < 60) return t.minShort(min);
    return t.hoursShort(Math.floor(min / 60), min % 60);
}
