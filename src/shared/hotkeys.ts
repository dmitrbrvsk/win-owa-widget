// System-wide key combinations: join the meeting that is on, open the widget, start a new meeting.
// This is the pure part (the grammar of a combination, its defaults, which meeting a press joins);
// the main process registers them with Windows (see `applyHotkeys` in index.ts).
import { isEngaged, joinCandidates, joinUrlForActions } from './events';
import { type CalendarEvent } from './types';

export type HotkeyAction = 'join' | 'open' | 'create';
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ['join', 'open', 'create'];
export type Hotkeys = Record<HotkeyAction, string>;

export interface HotkeyApi {
    /**
     * While the settings record a new combination the system-wide ones are let go, so pressing one of
     * them is recorded instead of joining a call. Resumed on `false` and when the settings close.
     */
    pauseHotkeys(paused: boolean): Promise<void>;
}

/**
 * Ctrl+Alt plus a letter: the same pair the macOS widget uses (Ctrl+Option). On the Russian and the
 * English layouts Ctrl+Alt (AltGr) types nothing with these letters, so typing is not taken away.
 */
export const DEFAULT_HOTKEYS: Hotkeys = {
    join: 'Ctrl+Alt+J',
    open: 'Ctrl+Alt+W',
    create: 'Ctrl+Alt+N',
};

const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIERS)[number];
const MOD_ALIASES: Record<string, Modifier> = {
    ctrl: 'Ctrl',
    control: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
};
const KEY_RE = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;

/**
 * A combination as the settings keep it ("Ctrl+Alt+J"), or '' for "off". Anything else is null.
 *
 * At least two modifiers, one of them Ctrl or Alt, and a letter, a digit or F1–F24: a combination
 * registered system-wide takes the keys away from every other program, so a single modifier (Ctrl+J
 * is "Downloads" in a browser) or Shift alone (capital letters) is never accepted. The Windows key is
 * left out on purpose: Windows reserves most of its combinations for itself.
 */
export function normalizeAccelerator(v: unknown): string | null {
    if (v === '') return '';
    if (typeof v !== 'string' || v.length > 40) return null;
    const parts = v.split('+').map((p) => p.trim());
    if (parts.length < 3 || parts.length > 4 || parts.some((p) => !p)) return null;
    const key = (parts.at(-1) ?? '').toUpperCase();
    if (!KEY_RE.test(key)) return null;
    const mods = new Set<Modifier>();
    for (const p of parts.slice(0, -1)) {
        const m = MOD_ALIASES[p.toLowerCase()];
        if (!m || mods.has(m)) return null;
        mods.add(m);
    }
    if (mods.size < 2 || (!mods.has('Ctrl') && !mods.has('Alt'))) return null;
    return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

/** What a key press in the settings' recorder makes of it. */
export type RecordedKey =
    { kind: 'combo'; accelerator: string } | { kind: 'partial' } | { kind: 'invalid' };

/**
 * Reads a key press the way Windows will match it: a Latin letter as the layout types it (on a
 * German keyboard the key labelled Z is "Z"), and by its physical key (`code`) when the layout types
 * something else, so a Russian layout records the same "J" as an English one. Modifiers on their own
 * are a combination still being pressed.
 */
export function acceleratorFromKey(ev: {
    key?: string;
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}): RecordedKey {
    if (/^(?:Control|Alt|Shift|Meta|OS)(?:Left|Right)?$/.test(ev.code)) return { kind: 'partial' };
    if (ev.metaKey) return { kind: 'invalid' };
    const m = /^(?:Key([A-Z])|Digit([0-9])|(F(?:[1-9]|1[0-9]|2[0-4])))$/.exec(ev.code);
    if (!m) return { kind: 'invalid' };
    const latin = m[1] && ev.key && /^[a-z]$/i.test(ev.key) ? ev.key.toUpperCase() : undefined;
    const key = latin ?? m[1] ?? m[2] ?? m[3];
    const raw = [ev.ctrlKey && 'Ctrl', ev.altKey && 'Alt', ev.shiftKey && 'Shift', key]
        .filter(Boolean)
        .join('+');
    const accelerator = normalizeAccelerator(raw);
    return accelerator ? { kind: 'combo', accelerator } : { kind: 'invalid' };
}

/**
 * The combinations from the settings file or the settings page: an invalid one keeps the current
 * value, and a combination given to two actions stays with the first and is switched off for the other.
 */
export function sanitizeHotkeys(raw: unknown, base: Hotkeys): Hotkeys {
    const r =
        raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
    const out = { ...base };
    const used = new Set<string>();
    for (const action of HOTKEY_ACTIONS) {
        const v = normalizeAccelerator(r[action]);
        const value = v === null ? (normalizeAccelerator(base[action]) ?? '') : v;
        out[action] = value && used.has(value) ? '' : value;
        if (out[action]) used.add(out[action]);
    }
    return out;
}

/** "Ctrl + Alt + J" for the screen; '' stays ''. */
export function hotkeyLabel(accelerator: string): string {
    return accelerator ? accelerator.replaceAll('+', ' + ') : '';
}

export type JoinChoice =
    | { kind: 'join'; event: CalendarEvent; url: string }
    | { kind: 'choose'; events: CalendarEvent[] }
    | { kind: 'none' };

/**
 * What the "join" combination does now. A call opens at once only when it is unambiguous and its
 * address needs no second look: one meeting the person accepted or runs, on (or within ten
 * minutes), with a link to a known call service. Anything else — several calls, an invitation
 * nobody answered, a link to an unfamiliar site (shown with its real host in the widget) — opens
 * the widget, where the person sees where each link goes and chooses.
 */
export function joinChoice(events: CalendarEvent[], now: Date): JoinChoice {
    const all = joinCandidates(events, now);
    if (!all.length) return { kind: 'none' };
    const engaged = all.filter(isEngaged);
    const urls = new Set(engaged.map((e) => joinUrlForActions(e)));
    const [event] = engaged;
    if (urls.size === 1 && event && event.platform !== 'generic')
        return { kind: 'join', event, url: joinUrlForActions(event)! };
    return { kind: 'choose', events: all };
}
