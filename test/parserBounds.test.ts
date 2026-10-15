import { describe, expect, it } from 'vitest';

import { parseOwnAddress } from '../src/main/owa/availability';
import { defaultCalendarFolder, mapCalendarItem, parseEventDetails } from '../src/main/owa/parse';

function countedObject(length: number) {
    let reads = 0;
    const value: Record<string, unknown> = {};
    const read = () => {
        reads += 1;
        return 0;
    };
    for (let i = 0; i < length; i++) {
        Object.defineProperty(value, `k${i}`, {
            enumerable: true,
            get: read,
        });
    }
    return { value, reads: () => reads };
}

function countedArray(length: number) {
    let reads = 0;
    const value: unknown[] = Array.from({ length });
    const read = () => {
        reads += 1;
        return 0;
    };
    for (let i = 0; i < length; i++) {
        Object.defineProperty(value, i, {
            get: read,
        });
    }
    return { value, reads: () => reads };
}

describe('JSON parser work budgets', () => {
    it.each([
        ['own address', parseOwnAddress],
        ['calendar folder', defaultCalendarFolder],
        ['event details', parseEventDetails],
    ] as const)('reads at most 200 own values per object: %s', (_name, parse) => {
        const input = countedObject(1000);
        parse(input.value);
        expect(input.reads()).toBeLessThanOrEqual(200);
    });

    it.each([
        ['calendar folder', defaultCalendarFolder],
        ['event details', parseEventDetails],
    ] as const)('stops the actual array traversal at the shared budget: %s', (_name, parse) => {
        const input = countedArray(10_000);
        parse(input.value);
        expect(input.reads()).toBeLessThanOrEqual(5000);
    });

    it('limits category reads before mapping their display fields', () => {
        const input = countedArray(1000);
        mapCalendarItem({
            ItemId: { Id: 'x' },
            Subject: 'Meeting',
            Start: '2026-10-16T09:00:00Z',
            End: '2026-10-16T10:00:00Z',
            Categories: input.value,
        });
        expect(input.reads()).toBe(20);
    });

    it('shares the work budget between branches at the depth boundary', () => {
        const first = countedArray(10_000);
        const second = countedArray(10_000);
        let input: unknown = { first: first.value, second: second.value };
        for (let i = 0; i < 39; i++) input = { nested: input };
        parseEventDetails(input);
        expect(first.reads() + second.reads()).toBeLessThanOrEqual(5000);
    });

    it('keeps generic wrappers and SMTP field preference', () => {
        expect(
            parseOwnAddress({
                arbitrary: [{ nested: { PrimarySmtpAddress: 'p@example.invalid' } }],
                SessionSettings: { UserEmailAddress: 'u@example.invalid' },
            }),
        ).toBe('u@example.invalid');
        expect(
            defaultCalendarFolder({
                arbitrary: [{ FolderId: { Id: 'c' }, IsDefaultCalendar: true }],
            }),
        ).toEqual({ id: 'c', changeKey: undefined });
        expect(
            parseEventDetails({ arbitrary: [{ Body: { BodyType: 'Text', Value: 'Agenda' } }] }),
        ).toEqual({ attendees: [], bodyText: 'Agenda' });
    });

    it('finishes direct highest-priority address and calendar shapes before enumerating extras', () => {
        const address = countedObject(1000);
        address.value.UserEmailAddress = 'u@example.invalid';
        expect(parseOwnAddress(address.value)).toBe('u@example.invalid');
        expect(address.reads()).toBe(0);
        const calendar = countedObject(1000);
        calendar.value.FolderId = { Id: 'main' };
        calendar.value.IsDefaultCalendar = true;
        expect(defaultCalendarFolder(calendar.value)).toEqual({ id: 'main', changeKey: undefined });
        expect(calendar.reads()).toBe(0);
    });

    it('does not accept inherited address fields or walk inherited envelopes', () => {
        const inherited: unknown = Object.create({ UserEmailAddress: 'fake@example.invalid' });
        expect(parseOwnAddress(inherited)).toBeUndefined();
        const envelope: unknown = Object.create({ nested: { FolderId: { Id: 'fake' } } });
        expect(defaultCalendarFolder(envelope)).toBeUndefined();
    });
});
