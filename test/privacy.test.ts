import { describe, expect, it } from 'vitest';

import { demoEvents } from '../src/main/demo';
import { describeChanges } from '../src/shared/changes';
import { isEffectivelyCancelled } from '../src/shared/events';
import { dict } from '../src/shared/i18n';
import { privateEvent } from '../src/shared/privacy';
import { trayPresentation } from '../src/shared/status';
import { reminderToast } from '../src/shared/toasts';
import { tooltipFor } from '../src/shared/trayTooltip';

const now = new Date();
const event = {
    ...demoEvents()[0],
    title: 'SECRET_TITLE',
    organizer: 'SECRET_NAME',
    organizerEmail: 'secret@example.com',
    location: 'SECRET_LOCATION',
    bodyPreview: 'SECRET_BODY',
    joinUrl: 'https://secret.example.com',
    categories: ['SECRET_CATEGORY'],
    futureField: 'SECRET_FUTURE',
    start: now.toISOString(),
    end: new Date(+now + 1_800_000).toISOString(),
};
it('keeps time and busy state but never forwards additional fields', () => {
    const masked = privateEvent(event);
    expect(masked.start).toBe(event.start);
    expect(masked.end).toBe(event.end);
    expect(masked.responseType).toBe(event.responseType);
    expect(masked.title).toBe('Занято');
    expect(JSON.stringify(masked)).not.toMatch(/SECRET|secret|futureField|changeKey/);
    expect(event.title).toBe('SECRET_TITLE');
});
it('keeps cancellation derived from Exchange subject prefixes', () => {
    const cancelled = { ...event, title: 'Отменено: SECRET_TITLE', isCancelled: false };
    expect(isEffectivelyCancelled(privateEvent(cancelled))).toBe(true);
});
describe('private visible surfaces', () => {
    it('keeps confidential strings out of reminders, changes and tray tooltips', () => {
        const masked = privateEvent(event);
        const text = JSON.stringify({
            toast: reminderToast([masked], now, 'ru'),
            notes: describeChanges([{ kind: 'invited', event: masked }], now, 'ru'),
            tooltip: tooltipFor(trayPresentation([masked], now), dict('ru'), 'ru'),
        });
        expect(text).not.toMatch(/SECRET|secret/);
        expect(text).toContain('Занято');
        expect(privateEvent(event, 'en').title).toBe('Busy');
    });
});
