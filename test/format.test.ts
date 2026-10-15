import { afterEach, describe, expect, it, vi } from 'vitest';

import { hm, localDateText, range, shortDay } from '../src/shared/format';
import { type Lang } from '../src/shared/i18n';

const initialZone = process.env.TZ;
afterEach(() => {
    if (initialZone === undefined) delete process.env.TZ;
    else process.env.TZ = initialZone;
    vi.restoreAllMocks();
});

const nativeTime = (date: Date, language: Lang) =>
    date.toLocaleTimeString(language === 'en' ? 'en-GB' : 'ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

describe('local calendar formatting', () => {
    it('matches both supported locales at midnight, DST changes and invalid dates', () => {
        for (const zone of ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kathmandu']) {
            process.env.TZ = zone;
            for (const value of [
                '2026-01-01T00:00:00Z',
                '2026-03-29T00:59:00Z',
                '2026-03-29T01:00:00Z',
                '2026-10-25T00:59:00Z',
                '2026-10-25T01:00:00Z',
                '2026-12-31T23:59:00Z',
                'invalid',
            ]) {
                for (const language of ['ru', 'en'] as const) {
                    const date = new Date(value);
                    expect(hm(value, language)).toBe(nativeTime(date, language));
                    expect(hm(date, language)).toBe(nativeTime(date, language));
                    expect(shortDay(date, language)).toBe(
                        date.toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                        }),
                    );
                }
            }
        }
    });

    it('uses the new runtime zone even if current offsets agree and future DST differs', () => {
        const winter = new Date('2026-01-01T12:00:00Z');
        const summer = new Date('2026-07-01T12:00:00Z');
        process.env.TZ = 'America/Denver';
        const currentOffset = winter.getTimezoneOffset();
        expect(hm(summer, 'en')).toBe(nativeTime(summer, 'en'));
        process.env.TZ = 'America/Phoenix';
        expect(winter.getTimezoneOffset()).toBe(currentOffset);
        expect(hm(summer, 'en')).toBe(nativeTime(summer, 'en'));
        expect(hm(summer, 'en')).toBe('05:00');
        expect(range(summer.toISOString(), '2026-07-01T13:00:00Z', 'en')).toBe('05:00–06:00');
    });

    it('does not create locale time formatters on the hot path', () => {
        const localeCall = vi.spyOn(Date.prototype, 'toLocaleTimeString');
        const formatter = vi.spyOn(Intl, 'DateTimeFormat');
        for (let i = 0; i < 100; i++) hm('2026-10-16T09:00:00Z', 'en');
        expect(localeCall).not.toHaveBeenCalled();
        expect(formatter).not.toHaveBeenCalled();
    });

    it('renders local date fields with fixed UTC formatters across runtime zone changes', () => {
        const formats = {
            dayMonthLong: { day: 'numeric', month: 'long' },
            weekdayLong: { weekday: 'long' },
            weekdayShort: { weekday: 'short' },
            dayMonthShort: { day: 'numeric', month: 'short' },
            monthShort: { month: 'short' },
            shortDay: { weekday: 'short', day: 'numeric', month: 'short' },
        } as const;
        const formatsToCheck = Object.keys(formats) as Array<keyof typeof formats>;
        for (const zone of ['America/Denver', 'America/Phoenix', 'Pacific/Kiritimati', 'UTC']) {
            process.env.TZ = zone;
            for (const instant of ['2026-07-01T06:30:00Z', '0099-12-31T23:59:00Z', 'invalid']) {
                for (const language of ['en', 'ru'] as const) {
                    for (const format of formatsToCheck) {
                        const date = new Date(instant);
                        expect(localDateText(date, language, format)).toBe(
                            date.toLocaleDateString(
                                language === 'en' ? 'en-GB' : 'ru-RU',
                                formats[format],
                            ),
                        );
                    }
                }
            }
        }
    });
});
