import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import {
    acceleratorFromKey,
    DEFAULT_HOTKEYS,
    hotkeyLabel,
    joinChoice,
    normalizeAccelerator,
    sanitizeHotkeys,
} from '../src/shared/hotkeys';
import { type CalendarEvent } from '../src/shared/types';
import { sanitizeSettings } from '../src/shared/validate';

const key = (
    code: string,
    mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {},
) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

function ev(
    id: string,
    startMin: number,
    endMin: number,
    extra: Partial<CalendarEvent> = {},
    now = new Date('2026-10-26T12:00:00+03:00'),
): CalendarEvent {
    return {
        id,
        title: id,
        start: new Date(now.getTime() + startMin * 60_000).toISOString(),
        end: new Date(now.getTime() + endMin * 60_000).toISOString(),
        isAllDay: false,
        platform: 'teams',
        isCancelled: false,
        isOrganizer: false,
        responseType: 'accepted',
        categories: [],
        isRecurring: false,
        joinUrl: `https://teams.microsoft.com/l/meetup-join/${id}`,
        ...extra,
    };
}

describe('key combinations', () => {
    it('accepts two modifiers with Ctrl or Alt and a letter, digit or F-key, in one canonical spelling', () => {
        expect(normalizeAccelerator('Ctrl+Alt+J')).toBe('Ctrl+Alt+J');
        expect(normalizeAccelerator('alt+ctrl+j')).toBe('Ctrl+Alt+J');
        expect(normalizeAccelerator('Control+Shift+5')).toBe('Ctrl+Shift+5');
        expect(normalizeAccelerator('Shift+Alt+F12')).toBe('Alt+Shift+F12');
        expect(normalizeAccelerator('Ctrl+Alt+Shift+N')).toBe('Ctrl+Alt+Shift+N');
        expect(normalizeAccelerator('')).toBe('');
    });

    it('refuses what would take typing or common shortcuts away from every other program', () => {
        for (const bad of [
            'J',
            'Ctrl+J',
            'Alt+F4',
            'Shift+J',
            'Ctrl+Ctrl+J',
            'Super+Alt+J',
            'Ctrl+Alt+Space',
            'Ctrl+Alt+Delete',
            'Ctrl+Alt+F25',
            'Ctrl+Alt+',
            'Ctrl+Alt+JJ',
            'Ctrl+Alt+Й',
            null,
            42,
            {},
            'Ctrl+Alt+J'.repeat(10),
        ]) {
            expect(normalizeAccelerator(bad), JSON.stringify(bad)).toBeNull();
        }
    });

    it('records by the physical key, so a Russian layout gives the same letter', () => {
        expect(acceleratorFromKey(key('KeyJ', { ctrlKey: true, altKey: true }))).toEqual({
            kind: 'combo',
            accelerator: 'Ctrl+Alt+J',
        });
        expect(acceleratorFromKey(key('Digit7', { ctrlKey: true, shiftKey: true }))).toEqual({
            kind: 'combo',
            accelerator: 'Ctrl+Shift+7',
        });
        expect(acceleratorFromKey(key('F9', { altKey: true, shiftKey: true }))).toEqual({
            kind: 'combo',
            accelerator: 'Alt+Shift+F9',
        });
        expect(acceleratorFromKey(key('ControlLeft', { ctrlKey: true }))).toEqual({
            kind: 'partial',
        });
        expect(acceleratorFromKey(key('AltRight', { ctrlKey: true, altKey: true }))).toEqual({
            kind: 'partial',
        });
        expect(acceleratorFromKey(key('KeyJ', { ctrlKey: true }))).toEqual({ kind: 'invalid' });
        expect(
            acceleratorFromKey(key('KeyJ', { ctrlKey: true, altKey: true, metaKey: true })),
        ).toEqual({ kind: 'invalid' });
        expect(acceleratorFromKey(key('Space', { ctrlKey: true, altKey: true }))).toEqual({
            kind: 'invalid',
        });
    });

    it('the settings keep valid combinations, fall back on junk and never give one combination to two actions', () => {
        expect(sanitizeHotkeys(undefined, DEFAULT_HOTKEYS)).toEqual(DEFAULT_HOTKEYS);
        expect(
            sanitizeHotkeys({ join: 'Ctrl+Shift+K', open: '', create: 'junk' }, DEFAULT_HOTKEYS),
        ).toEqual({ join: 'Ctrl+Shift+K', open: '', create: DEFAULT_HOTKEYS.create });
        expect(
            sanitizeHotkeys(
                { join: 'Ctrl+Alt+K', open: 'Alt+Ctrl+K', create: 'Ctrl+Alt+K' },
                DEFAULT_HOTKEYS,
            ),
        ).toEqual({ join: 'Ctrl+Alt+K', open: '', create: '' });
        // A settings file from an older version has none: the defaults apply, the rest is untouched.
        const s = sanitizeSettings({ notifyChanges: false }, DEFAULT_SETTINGS);
        expect(s.hotkeys).toEqual(DEFAULT_HOTKEYS);
        expect(s.notifyChanges).toBe(false);
        expect(sanitizeSettings({ hotkeys: 'Ctrl+J' }, DEFAULT_SETTINGS).hotkeys).toEqual(
            DEFAULT_HOTKEYS,
        );
    });

    it('reads as "Ctrl + Alt + J"', () => {
        expect(hotkeyLabel('Ctrl+Alt+J')).toBe('Ctrl + Alt + J');
        expect(hotkeyLabel('')).toBe('');
    });
});

describe('which call the join combination opens', () => {
    const now = new Date('2026-10-26T12:00:00+03:00');
    it('the one meeting on now (or starting within ten minutes) with a link', () => {
        const c = joinChoice([ev('a', -10, 20), ev('later', 30, 60)], now);
        expect(c.kind).toBe('join');
        if (c.kind === 'join') expect(c.url).toContain('/a');
        expect(joinChoice([ev('soon', 8, 40)], now).kind).toBe('join');
    });

    it('nothing to join: no link, too far ahead, declined or cancelled', () => {
        expect(joinChoice([], now).kind).toBe('none');
        expect(joinChoice([ev('far', 15, 45)], now).kind).toBe('none');
        expect(joinChoice([ev('nolink', -5, 30, { joinUrl: undefined })], now).kind).toBe('none');
        expect(joinChoice([ev('no', -5, 30, { responseType: 'declined' })], now).kind).toBe('none');
        expect(joinChoice([ev('off', -5, 30, { isCancelled: true })], now).kind).toBe('none');
    });

    it('two different calls at once: the person chooses, the key does not guess', () => {
        expect(joinChoice([ev('a', -10, 20), ev('b', 5, 40)], now).kind).toBe('choose');
        // The same call twice (an occurrence and its copy) is one call.
        expect(
            joinChoice(
                [
                    ev('a', -10, 20),
                    ev('b', -10, 20, { joinUrl: 'https://teams.microsoft.com/l/meetup-join/a' }),
                ],
                now,
            ).kind,
        ).toBe('join');
    });

    it('a meeting the person accepted wins over an invitation nobody answered', () => {
        const c = joinChoice(
            [ev('mine', -10, 20), ev('invite', 5, 40, { responseType: 'notResponded' })],
            now,
        );
        expect(c.kind).toBe('join');
        if (c.kind === 'join') expect(c.event.id).toBe('mine');
    });
});

describe('the main process and the combinations', () => {
    const main = readFileSync('src/main/index.ts', 'utf8');
    const controller = readFileSync('src/main/hotkeys.ts', 'utf8');
    const preload = readFileSync('src/preload/index.ts', 'utf8');
    it('registers only the combinations from the settings, and lets them all go on quit', () => {
        expect(controller).toMatch(
            /globalShortcut\.register\(accelerator, \(\) => this\.press\(action\)\)/,
        );
        expect(controller.match(/globalShortcut\.register\(/g)?.length).toBe(1);
        expect(main).not.toMatch(/globalShortcut/);
        expect(main).toMatch(/will-quit[\s\S]{0,120}hotkeys\.stop\(\)/);
        expect(main).toMatch(/hotkeys\.apply\(service\.settings\.hotkeys\)/);
    });
    it('only the settings window may pause them, and closing it resumes them', () => {
        expect(main).toMatch(
            /IPC\.pauseHotkeys[\s\S]{0,160}fromWebContents\(e\.sender\) === settingsWin\) hotkeys\.pause/,
        );
        expect(main).toMatch(/settingsWin\.on\('closed'[\s\S]{0,200}hotkeys\.pause\(false\)/);
        expect(preload).toMatch(
            /pauseHotkeys: \(paused\) => ipcRenderer\.invoke\(IPC\.pauseHotkeys, paused\)/,
        );
    });
    it('the join combination opens no call in privacy mode, and logs no title', () => {
        expect(controller).toMatch(/privacy \? \(\{ kind: 'none' \} as const\)/);
        expect(controller).toMatch(
            /log\.info\(`hotkey: join \(\$\{privacy \? 'privacy' : choice\.kind\}\)`\)/,
        );
    });
});
