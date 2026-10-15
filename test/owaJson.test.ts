import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseOwaJson } from '../src/main/owa/json';

afterEach(() => vi.restoreAllMocks());

describe('OWA JSON resource preflight', () => {
    it.each([
        ['wide object', `{${Array.from({ length: 400_000 }, (_, i) => `"k${i}":0`).join(',')}}`],
        ['large array', `[${'0,'.repeat(100_000)}0]`],
        ['deep structure', `${'['.repeat(1000)}0${']'.repeat(1000)}`],
        [
            'many containers',
            JSON.stringify(
                Array.from({ length: 5000 }, () => Array.from({ length: 50 }, () => ({}))),
            ),
        ],
    ])('rejects a %s before native JSON materialization', (_name, text) => {
        const parse = vi.spyOn(JSON, 'parse');
        expect(() => parseOwaJson(text)).toThrow(/structure exceeds limit/);
        expect(parse).not.toHaveBeenCalled();
    });

    it('preserves normal calendars, nested arrays and quoted punctuation', () => {
        const data = {
            Body: {
                Items: Array.from({ length: 3000 }, (_, i) => ({
                    ItemId: { Id: `event-${i}`, ChangeKey: 'key' },
                    Subject: String.raw`Meeting: [{,}] "quoted" \ path`,
                    Start: '2026-10-16T10:00:00Z',
                    End: '2026-10-16T11:00:00Z',
                    Categories: ['a', 'b'],
                    IsAllDayEvent: false,
                })),
            },
        };
        expect(parseOwaJson(JSON.stringify(data))).toEqual(data);
        expect(parseOwaJson(String.raw`[[],{},[1,2],"\"[,:]",null,true]`)).toEqual([
            [],
            {},
            [1, 2],
            '"[,:]',
            null,
            true,
        ]);
    });

    it('leaves grammar validation to JSON.parse', () => {
        for (const text of ['{', '[1,]', '{"x":}', '"unterminated', '[}']) {
            expect(() => parseOwaJson(text)).toThrow(SyntaxError);
        }
    });
});
