import { beforeEach, expect, it, vi } from 'vitest';

import { HotkeyController } from '../src/main/hotkeys';
import { DEFAULT_HOTKEYS } from '../src/shared/hotkeys';

const keys = vi.hoisted(() => ({
    registered: new Map<string, () => void>(),
    taken: new Set<string>(),
}));
vi.mock('electron', () => ({
    globalShortcut: {
        register: (accelerator: string, cb: () => void) => {
            if (keys.taken.has(accelerator)) return false;
            keys.registered.set(accelerator, cb);
            return true;
        },
        isRegistered: (accelerator: string) => keys.registered.has(accelerator),
        unregisterAll: () => keys.registered.clear(),
    },
}));
vi.mock('../src/main/log', () => ({
    log: { info: vi.fn(), warn: vi.fn() },
    describeError: () => '',
}));

const handlers = { join: vi.fn(), open: vi.fn(), create: vi.fn() };
let changes = 0;
let c: HotkeyController;
beforeEach(() => {
    keys.registered.clear();
    keys.taken.clear();
    changes = 0;
    for (const h of Object.values(handlers)) h.mockClear();
    c = new HotkeyController(handlers, () => {
        changes += 1;
    });
});

it('registers exactly the combinations from the settings and runs the matching action', () => {
    c.apply(DEFAULT_HOTKEYS);
    expect([...keys.registered.keys()].toSorted()).toEqual([
        'Ctrl+Alt+J',
        'Ctrl+Alt+N',
        'Ctrl+Alt+W',
    ]);
    keys.registered.get('Ctrl+Alt+N')?.();
    expect(handlers.create).toHaveBeenCalledTimes(1);
    expect(handlers.join).not.toHaveBeenCalled();
    c.apply({ ...DEFAULT_HOTKEYS, open: '' });
    expect(keys.registered.has('Ctrl+Alt+W')).toBe(false);
});

it('a combination another program holds is reported, and the report survives a pause', () => {
    keys.taken.add('Ctrl+Alt+W');
    c.apply(DEFAULT_HOTKEYS);
    expect(c.problems).toEqual(['open']);
    expect(c.hint('open')).toEqual({});
    expect(c.hint('create')).toEqual({ accelerator: 'Ctrl+Alt+N', registerAccelerator: false });
    c.pause(true);
    expect(keys.registered.size).toBe(0);
    expect(c.problems).toEqual(['open']);
    c.pause(false);
    expect(keys.registered.size).toBe(2);
    expect(changes).toBe(1);
});

it('a held-down key does not fire the action without limit', () => {
    c.apply(DEFAULT_HOTKEYS);
    const press = keys.registered.get('Ctrl+Alt+W')!;
    for (let i = 0; i < 100; i++) press();
    expect(handlers.open).toHaveBeenCalledTimes(20);
});

it('after stop nothing is registered again', () => {
    c.apply(DEFAULT_HOTKEYS);
    c.stop();
    expect(keys.registered.size).toBe(0);
    c.pause(true);
    c.pause(false);
    expect(keys.registered.size).toBe(0);
});
