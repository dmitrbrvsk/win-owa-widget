import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// Bundle the actual renderer with its normal JSX configuration. The node TypeScript project
// intentionally has no DOM/JSX libraries; a child process also isolates the preload mock.
const fixture = `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timeline } from './src/renderer/Timeline';
import { AllDayMeetings } from './src/renderer/AllDayMeetings';
import { TimelineMeeting } from './src/renderer/TimelineMeeting';
import { PrivateCalendar } from './src/renderer/PrivateCalendar';
import { dict } from './src/shared/i18n';
import { privateEvent } from './src/shared/privacy';
import { layoutDay } from './src/shared/timeline';

const day = new Date(2026, 9, 16);
const events = Array.from({ length: 3000 }, (_, index) => ({
    id: 'meeting-' + index,
    title: 'SECRET Meeting ' + String(index).padStart(4, '0'),
    organizer: 'SECRET Organizer',
    start: new Date(2026, 9, 16, 9).toISOString(),
    end: new Date(2026, 9, 16, 10).toISOString(),
    isAllDay: false,
    platform: 'generic',
    joinUrl: 'https://secret.example/meeting',
    isCancelled: false,
    isOrganizer: false,
    responseType: 'accepted',
    categories: [],
    isRecurring: false,
}));
const actions = [];
const props = {
    events, day, now: new Date(2026, 9, 16, 8),
    workday: { startHour: 8, endHour: 20 },
    t: dict('en'), lang: 'en', noteIds: ['meeting-0'],
    onOpen: (event) => actions.push('open:' + event.id),
    onJoin: (event) => actions.push('join:' + event.id),
};
const render = (overrides) => renderToStaticMarkup(createElement(Timeline, { ...props, ...overrides }));
const allDay = (count, selectedId) => renderToStaticMarkup(createElement(AllDayMeetings, {
    events: events.slice(0, count).map((event) => ({ ...event, isAllDay: true })),
    t: props.t, onOpen: props.onOpen, selectedId,
}));
const normal = render({ events: events.slice(0, 2) });
const dense = render({});
const selected = render({ selectedId: 'meeting-2999' });
const masked = render({ events: events.map((event) => privateEvent(event, 'en')), noteIds: [] });
const cancelled = render({ events: events.map((event) => ({ ...event, isCancelled: true })) });
const empty = render({ events: [], emptyText: 'Selected day is empty' });
const today = new Date();
const privateEvents = events.map((event, index) => ({ ...event,
    start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9).toISOString(),
    end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10).toISOString(),
    isAllDay: index === 0,
}));
const privateCalendar = (lang, count) => renderToStaticMarkup(createElement(PrivateCalendar, {
    snap: { events: privateEvents.slice(0, count), settings: { language: lang } },
}));
const row = TimelineMeeting({
    block: layoutDay([events[0]], day)[0],
    noted: new Set(props.noteIds), ...props, past: false, dense: true,
});
row.props.children[0].props.onClick();
row.props.children[1].props.onClick();
row.props.onContextMenu({ preventDefault() {} });
console.log(JSON.stringify({ normal, dense, selected, masked, cancelled, empty,
    allDay: allDay(3000), allDaySelected: allDay(3000, 'meeting-2999'),
    allDayNormal: allDay(2), actions, menus: globalThis.timelineMenus,
    privateEnglish: privateCalendar('en', 3000), privateRussian: privateCalendar('ru', 3000),
    privateNormal: privateCalendar('en', 2), privateEmpty: privateCalendar('en', 0),
}));
`;

interface Rendered {
    normal: string;
    dense: string;
    selected: string;
    masked: string;
    cancelled: string;
    empty: string;
    allDay: string;
    allDaySelected: string;
    allDayNormal: string;
    privateEnglish: string;
    privateRussian: string;
    privateNormal: string;
    privateEmpty: string;
    actions: string[];
    menus: string[];
}

let rendered: Rendered;
beforeAll(async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const bundled = await build({
        stdin: { contents: fixture, resolveDir: root, loader: 'ts' },
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        plugins: [
            {
                name: 'isolated-preload',
                setup(builder) {
                    builder.onLoad({ filter: /src\/renderer\/api\.ts$/ }, () => ({
                        contents: `export const api = { meetingMenu(id) {
                            (globalThis.timelineMenus ??= []).push(id);
                            return Promise.resolve();
                        } };`,
                        loader: 'ts',
                    }));
                },
            },
        ],
    });
    const output = execFileSync(process.execPath, ['--input-type=module'], {
        cwd: root,
        input: bundled.outputFiles[0].text,
        encoding: 'utf8',
        env: { ...process.env, TZ: 'Europe/Moscow' },
    });
    rendered = JSON.parse(output) as Rendered;
});

const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

describe('rendered timeline bounds', () => {
    it('retains the normal grid, meeting controls, note marker and host warning', () => {
        expect(rendered.normal).toContain('tl-inner');
        expect(rendered.normal).not.toContain('dense-day');
        expect(count(rendered.normal, /role="listitem"/g)).toBe(2);
        expect(rendered.normal).toContain('Has a note');
        expect(rendered.normal).toContain('Join · secret.example');
    });

    it('renders 50 accessible rows for 3000 meetings and reports the complete count', () => {
        expect(count(rendered.dense, /role="listitem"/g)).toBe(50);
        expect(count(rendered.dense, /<[a-z][a-z0-9-]*(?:\s|>)/g)).toBeLessThan(700);
        expect(rendered.dense).toContain('Meetings 1–50 of 3000');
        expect(rendered.dense).toContain('Page 1 of 60');
        expect(rendered.dense).toContain('aria-setsize="3000"');
        expect(rendered.dense).toContain('aria-posinset="50"');
        expect(rendered.dense).not.toContain('tl-inner');
        expect(rendered.dense).not.toContain('SECRET Meeting 0050');
    });

    it('opens the page containing an externally selected meeting', () => {
        expect(rendered.selected).toContain('Meetings 2951–3000 of 3000');
        expect(rendered.selected).toContain('Page 60 of 60');
        expect(rendered.selected).toContain('SECRET Meeting 2999');
        expect(rendered.selected).toContain('dense-day-row selected');
        expect(count(rendered.selected, /role="listitem"/g)).toBe(50);
    });

    it('preserves privacy masking, cancellation rules and selected-day empty text', () => {
        expect(rendered.masked).not.toMatch(/SECRET|secret\.example|Has a note/);
        expect(rendered.masked).toContain('Busy');
        expect(rendered.cancelled).not.toContain('Join ·');
        expect(rendered.cancelled).toContain('cancelled');
        expect(rendered.empty).toContain('Selected day is empty');
        expect(rendered.empty).not.toContain('dense-day');
    });

    it('bounds all-day pills with the same selected-page access and preserves small strips', () => {
        expect(count(rendered.allDay, /class="pill nowrap/g)).toBe(50);
        expect(rendered.allDay).toContain('Meetings 1–50 of 3000');
        expect(rendered.allDaySelected).toContain('SECRET Meeting 2999');
        expect(rendered.allDaySelected).toContain('Page 60 of 60');
        expect(count(rendered.allDaySelected, /class="pill nowrap/g)).toBe(50);
        expect(count(rendered.allDayNormal, /class="pill nowrap/g)).toBe(2);
        expect(rendered.allDayNormal).not.toContain('meeting-pages');
    });

    it('passes the original event to Open and Join and its ID to the native copy menu', () => {
        expect(rendered.actions).toEqual(['open:meeting-0', 'join:meeting-0']);
        expect(rendered.menus).toEqual(['meeting-0']);
    });

    it('bounds the private calendar and keeps both languages free of confidential data', () => {
        for (const html of [rendered.privateEnglish, rendered.privateRussian]) {
            expect(count(html, /role="listitem"/g)).toBe(50);
            expect(count(html, /<[a-z][a-z0-9-]*(?:\s|>)/g)).toBeLessThan(250);
            expect(html).toContain('aria-setsize="3000"');
            expect(html).toContain('aria-posinset="50"');
            expect(html).not.toMatch(/SECRET|secret\.example/);
        }
        expect(rendered.privateEnglish).toContain('Meetings 1–50 of 3000');
        expect(rendered.privateEnglish).toContain('Page 1 of 60');
        expect(rendered.privateEnglish).toContain('All day');
        expect(rendered.privateEnglish).toContain('Busy');
        expect(rendered.privateRussian).toContain('Встречи 1–50 из 3000');
        expect(rendered.privateRussian).toContain('Страница 1 из 60');
        expect(rendered.privateRussian).toContain('Весь день');
        expect(rendered.privateRussian).toContain('Занято');
        expect(count(rendered.privateNormal, /role="listitem"/g)).toBe(2);
        expect(rendered.privateNormal).not.toContain('meeting-pages');
        expect(rendered.privateEmpty).toContain('No meetings');
    });
});
