import { describe, expect, it } from 'vitest';

import { McpCatalog } from '../src/main/mcp/catalog';

import { ACCESS, event, RANGE, TITLES, view } from './mcpCatalogFixtures';

describe('MCP argument and query boundaries', () => {
    it.each([null, undefined, [], new Date('2026-10-16'), 1, 'arguments', Object.create({})])(
        'rejects non-record arguments %s',
        (args) => {
            expect(() => new McpCatalog().read('get_status', args, view(), ACCESS)).toThrow();
        },
    );

    it.each([
        ['get_status', { extra: true }],
        ['get_meeting', { id: 'x', title: true }],
        ['list_meetings', { ...RANGE, query: 'Planning' }],
        ['search_meetings', { ...RANGE, query: 'Planning', fields: ['body'] }],
        ['get_status', { [Symbol('hidden')]: true }],
        ['get_status', Object.defineProperty({}, 'secret', { value: true })],
    ])('rejects unexpected arguments for %s', (tool, args) => {
        expect(() => new McpCatalog().read(tool, args, view(), TITLES)).toThrow(
            'Unexpected MCP argument',
        );
    });

    it('rejects argument accessors without evaluating them', () => {
        const args = {
            get start() {
                throw new Error('PRIVATE-GETTER');
            },
        };
        expect(() => new McpCatalog().read('list_meetings', args, view(), ACCESS)).toThrow(
            'Unexpected MCP argument',
        );
    });

    it.each([
        { start: '2026-10-16' },
        { start: '2026-10-16T00:00:00' },
        { start: 0 },
        { start: '2026-02-30T00:00:00Z' },
        { end: '2026-10-16T24:00:00Z' },
        { end: '2026-10-17T00:00:00+24:00' },
        { end: RANGE.start },
        { end: '2026-10-15T00:00:00Z' },
        { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00.001Z' },
    ])('rejects invalid or oversized date ranges %j', (patch) => {
        expect(() =>
            new McpCatalog().read('list_meetings', { ...RANGE, ...patch }, view(), ACCESS),
        ).toThrow();
    });

    it('accepts exactly 31 days', () => {
        expect(
            new McpCatalog().read(
                'list_meetings',
                {
                    start: '2026-10-01T00:00:00Z',
                    end: '2026-11-01T00:00:00Z',
                },
                view(),
                ACCESS,
            ).meetings,
        ).toHaveLength(1);
    });

    it.each([null, undefined, 0, -1, 101, 1.5, Number.NaN, Infinity, '10'])(
        'rejects invalid result limit %s',
        (limit) => {
            expect(() =>
                new McpCatalog().read('list_meetings', { ...RANGE, limit }, view(), ACCESS),
            ).toThrow('limit');
        },
    );

    it.each([
        [undefined, 50],
        [1, 1],
        [100, 100],
    ])('limits results with limit %s', (limit, count) => {
        const snapshot = view({
            events: Array.from({ length: 101 }, (_, i) => event({ id: `raw-${i}` })),
        });
        const args = limit === undefined ? RANGE : { ...RANGE, limit };
        const payload = new McpCatalog().read('list_meetings', args, snapshot, ACCESS);
        expect(payload.meetings).toHaveLength(count);
        expect(payload.hasMore).toBe(true);
    });

    it.each([undefined, null, 1, '', ' '.repeat(3), 'a'.repeat(101)])(
        'rejects invalid title query %s',
        (query) => {
            expect(() =>
                new McpCatalog().read('search_meetings', { ...RANGE, query }, view(), TITLES),
            ).toThrow('query');
        },
    );

    it('searches only returned subjects, case-insensitively, with both query length boundaries', () => {
        const snapshot = view({
            events: [event({ title: 'A'.repeat(300), bodyPreview: 'needle', location: 'needle' })],
        });
        const catalog = new McpCatalog();
        for (const query of ['a', 'A'.repeat(100)])
            expect(
                catalog.read('search_meetings', { ...RANGE, query }, snapshot, TITLES).meetings,
            ).toHaveLength(1);
        expect(
            catalog.read('search_meetings', { ...RANGE, query: 'needle' }, snapshot, TITLES)
                .meetings,
        ).toEqual([]);
        const clipped = view({ events: [event({ title: `${'A'.repeat(300)}secret-tail` })] });
        expect(
            catalog.read('search_meetings', { ...RANGE, query: 'secret-tail' }, clipped, TITLES)
                .meetings,
        ).toEqual([]);
    });
});
