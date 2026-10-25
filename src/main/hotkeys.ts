// System-wide key combinations, registered with Windows. Only the exact combinations from the
// settings reach the app: no other key press is seen by it.
import { globalShortcut } from 'electron';

import { HOTKEY_ACTIONS, type HotkeyAction, type Hotkeys, joinChoice } from '../shared/hotkeys';
import { type CalendarEvent } from '../shared/types';

import { describeError, log } from './log';
import { SlidingWindow } from './meetingGate';

export type HotkeyHandlers = Record<HotkeyAction, () => void>;

export class HotkeyController {
    /** Combinations Windows refused: another program registered them first. */
    problems: HotkeyAction[] = [];
    private keys?: Hotkeys;
    /** The settings page is recording a combination: the registered ones are let go meanwhile. */
    private paused = false;
    /** A held-down key repeats; a person presses a combination a few times a minute at most. */
    private readonly presses = new SlidingWindow(20, 60_000);

    constructor(
        private readonly handlers: HotkeyHandlers,
        private readonly onProblemsChanged: () => void,
    ) {}

    apply(keys: Hotkeys): void {
        if (this.keys && HOTKEY_ACTIONS.every((a) => this.keys?.[a] === keys[a])) return;
        this.keys = { ...keys };
        this.register();
    }

    pause(paused: boolean): void {
        if (this.paused === paused) return;
        this.paused = paused;
        this.register();
    }

    /** On quit: everything registered is let go, and nothing is registered again. */
    stop(): void {
        this.keys = undefined;
        globalShortcut.unregisterAll();
    }

    /** The combination shown next to a tray item as a reminder (Windows already delivers it). */
    hint(action: HotkeyAction): { accelerator?: string; registerAccelerator?: boolean } {
        const accelerator = this.keys?.[action];
        return accelerator && !this.problems.includes(action)
            ? { accelerator, registerAccelerator: false }
            : {};
    }

    private register(): void {
        globalShortcut.unregisterAll();
        // While a field records, nothing is registered, and what Windows refused stays as it was:
        // the "taken by another program" note must not vanish because a field got the focus.
        if (this.paused) return;
        const problems: HotkeyAction[] = [];
        if (this.keys) {
            for (const action of HOTKEY_ACTIONS) {
                const accelerator = this.keys[action];
                if (!accelerator) continue;
                let ok = false;
                try {
                    ok =
                        globalShortcut.register(accelerator, () => this.press(action)) &&
                        globalShortcut.isRegistered(accelerator);
                } catch (e) {
                    log.warn(`hotkeys: ${action} could not be registered: ${describeError(e)}`);
                }
                if (!ok) problems.push(action);
            }
            if (problems.length)
                log.warn(`hotkeys: taken by another program: ${problems.join(', ')}`);
        }
        const changed = problems.join(',') !== this.problems.join(',');
        this.problems = problems;
        if (changed) this.onProblemsChanged();
    }

    private press(action: HotkeyAction): void {
        const now = Date.now();
        if (!this.presses.allows(now)) return;
        this.presses.take(now);
        this.handlers[action]();
    }
}

/**
 * The call the "join" combination opens, or undefined when the widget should open instead: none or
 * several calls are on, or the privacy mode is on (then the windows show no links either).
 */
export function hotkeyJoinUrl(
    events: CalendarEvent[],
    privacy: boolean,
    now = new Date(),
): string | undefined {
    const choice = privacy ? ({ kind: 'none' } as const) : joinChoice(events, now);
    log.info(`hotkey: join (${privacy ? 'privacy' : choice.kind})`);
    return choice.kind === 'join' ? choice.url : undefined;
}
