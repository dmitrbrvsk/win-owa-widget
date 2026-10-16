import { describe, expect, it } from 'vitest';

import {
    meetingPage,
    meetingPageForId,
    MEETINGS_PER_PAGE,
    TIMELINE_GRID_LIMIT,
    TIMELINE_LANE_LIMIT,
    usesMeetingPages,
} from '../src/shared/meetingPages';
import { privateEvent } from '../src/shared/privacy';
import { layoutDay, visibleRange } from '../src/shared/timeline';
import { type CalendarEvent } from '../src/shared/types';

const day = new Date(2026, 9, 16);
const at = (minutes: number) => new Date(2026, 9, 16, 0, minutes).toISOString();
const event = (id: number, start = 540, end = 600): CalendarEvent => ({
    id: `meeting-${id}`,
    title: `Meeting ${String(id).padStart(4, '0')}`,
    start: at(start),
    end: at(end),
    isAllDay: false,
    platform: 'teams',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/example',
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    categories: [],
    isRecurring: false,
});

describe('bounded day presentation', () => {
    it('retains the ordinary side-by-side layout and working range', () => {
        const events = [
            event(1, 540, 600),
            event(2, 570, 630),
            event(3, 600, 615),
            event(4, 660, 720),
        ];
        const blocks = layoutDay(events, day);
        expect(usesMeetingPages(blocks)).toBe(false);
        expect(blocks.map(({ event: item, lane, lanes }) => [item.id, lane, lanes])).toEqual([
            ['meeting-1', 0, 2],
            ['meeting-2', 1, 2],
            ['meeting-3', 0, 2],
            ['meeting-4', 0, 1],
        ]);
        expect(visibleRange(blocks, { startHour: 8, endHour: 20 })).toEqual({
            startMin: 480,
            endMin: 1200,
        });
    });

    it('uses pages for high concurrency even on a smaller day', () => {
        const events = Array.from({ length: TIMELINE_LANE_LIMIT }, (_, index) => event(index));
        expect(usesMeetingPages(layoutDay(events, day))).toBe(false);
        expect(usesMeetingPages(layoutDay([...events, event(100)], day))).toBe(true);
    });

    it('reuses the lowest available lane when lanes finish in a different order', () => {
        const ends = [7, 4, 1, 6, 3, 0, 5, 2];
        const initial = ends.map((end, index) => event(index, 540 + index, 600 + end));
        const later = ends.map((_, index) => event(100 + index, 608 + index, 720));
        const blocks = layoutDay([...initial, event(50, 548, 900), ...later], day);
        const laterBlocks = blocks.filter((block) => later.includes(block.event));
        expect(laterBlocks.map((block) => block.lane)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(blocks.every((block) => block.lanes === 9)).toBe(true);
    });

    it('uses pages for many non-overlapping meetings as well', () => {
        const events = Array.from({ length: TIMELINE_GRID_LIMIT + 1 }, (_, index) =>
            event(index, index * 2, index * 2 + 1),
        );
        expect(usesMeetingPages(layoutDay(events.slice(0, TIMELINE_GRID_LIMIT), day))).toBe(false);
        expect(usesMeetingPages(layoutDay(events, day))).toBe(true);
    });

    it('keeps all 3000 overlapping meetings reachable in bounded pages', () => {
        const events = Array.from({ length: 3000 }, (_, index) => event(index));
        const blocks = layoutDay(events.toReversed(), day);
        expect(blocks).toHaveLength(events.length);
        expect(usesMeetingPages(blocks)).toBe(true);
        expect(blocks.every((block) => block.lanes === events.length)).toBe(true);
        const ids: string[] = [];
        const { pages } = meetingPage(blocks, 0);
        for (let index = 0; index < pages; index++) {
            const page = meetingPage(blocks, index);
            expect(page.items.length).toBeLessThanOrEqual(MEETINGS_PER_PAGE);
            expect(page.total).toBe(3000);
            expect(page.start).toBe(index * MEETINGS_PER_PAGE + 1);
            ids.push(...page.items.map((block) => block.event.id));
        }
        expect(ids).toEqual(events.map((item) => item.id));
        expect(new Set(ids).size).toBe(events.length);
    });

    it('keeps a zero-duration meeting visible at equal starts and treats midnight as exclusive', () => {
        const events = [event(1, 540, 600), event(2, 540, 540), event(3, 1440, 1440)];
        const blocks = layoutDay(events, day);
        expect(blocks.map(({ event: item, lane, lanes }) => [item.id, lane, lanes])).toEqual([
            ['meeting-1', 0, 2],
            ['meeting-2', 1, 2],
        ]);
        expect(blocks[1]).toMatchObject({ startMin: 540, endMin: 540 });
        const zeroes = Array.from({ length: 3000 }, (_, index) => event(index, 540, 540));
        expect(layoutDay(zeroes, day)).toHaveLength(3000);
        expect(usesMeetingPages(layoutDay(zeroes, day))).toBe(true);
    });

    it('clips multi-day meetings to the selected day and excludes other days and all-day records', () => {
        const overnight = event(1, -60, 30);
        const nextNight = event(2, 1410, 1500);
        const blocks = layoutDay(
            [
                overnight,
                nextNight,
                event(3, -120, -60),
                event(4, 1500, 1560),
                { ...event(5), isAllDay: true },
            ],
            day,
        );
        expect(
            blocks.map(({ event: item, startMin, endMin }) => [item.id, startMin, endMin]),
        ).toEqual([
            ['meeting-1', 0, 30],
            ['meeting-2', 1410, 1440],
        ]);
    });

    it('retains all-day records in pages with exact boundary and selected meeting access', () => {
        const events = Array.from({ length: 3000 }, (_, index) => ({
            ...event(index),
            isAllDay: true,
        }));
        expect(layoutDay(events, day)).toEqual([]);
        const found = Array.from(
            { length: 60 },
            (_, index) => meetingPage(events, index).items,
        ).flat();
        expect(found).toEqual(events);
        const selected = meetingPageForId(events, 'meeting-2999');
        expect(selected).toBe(59);
        expect(meetingPage(events, selected).items.at(-1)?.id).toBe('meeting-2999');
        expect(meetingPageForId(events, 'missing')).toBe(0);
        expect(meetingPage(events, 100).page).toBe(59);
        expect(meetingPage(events, -1).page).toBe(0);
        expect(meetingPage([], 10)).toMatchObject({
            total: 0,
            start: 0,
            end: 0,
            pages: 1,
            page: 0,
        });
    });

    it('preserves masked data and event identity through pages', () => {
        const masked = Array.from({ length: 101 }, (_, index) =>
            privateEvent({ ...event(index), organizer: 'SECRET', title: 'SECRET' }, 'en'),
        );
        const page = meetingPage(layoutDay(masked, day), 1);
        expect(page.total).toBe(masked.length);
        expect(JSON.stringify(page)).not.toMatch(/SECRET|teams\.microsoft/);
        expect(page.items[0].event).toBe(masked[50]);
        expect(page.items[0].event.title).toBe('Busy');
    });
});
