// Settings for the keyboard shortcuts, the free windows of the day view and the frequent people.
import * as React from 'react';
import { type KeyboardEvent, useRef, useState } from 'react';

import {
    acceleratorFromKey,
    DEFAULT_HOTKEYS,
    HOTKEY_ACTIONS,
    type HotkeyAction,
    hotkeyLabel,
    type Hotkeys,
} from '../shared/hotkeys';
import { type Dict } from '../shared/i18n';

import { api } from './api';
import { ipcMessage } from './hooks';
import { Icon } from './icons';

/**
 * Records a key combination. While it has the focus the app's system-wide combinations are let go
 * (otherwise pressing one would join a call instead of being recorded); they come back on blur.
 */
function HotkeyField({
    value,
    onChange,
    label,
    t,
    taken,
    busy,
}: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    t: Dict;
    taken: string[];
    busy: boolean;
}) {
    const [recording, setRecording] = useState(false);
    const [held, setHeld] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const ref = useRef<HTMLButtonElement>(null);

    const finish = (next?: string) => {
        if (next !== undefined) onChange(next);
        ref.current?.blur();
    };

    function onKey(ev: KeyboardEvent<HTMLButtonElement>) {
        const plain = !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey;
        if (ev.key === 'Tab' && plain) return; // the keyboard can still leave the field
        ev.preventDefault();
        ev.stopPropagation();
        if (plain && ev.key === 'Escape') return finish();
        if (plain && (ev.key === 'Backspace' || ev.key === 'Delete')) return finish('');
        const r = acceleratorFromKey(ev);
        if (r.kind === 'partial') {
            const mods = [ev.ctrlKey && 'Ctrl', ev.altKey && 'Alt', ev.shiftKey && 'Shift'];
            return setHeld(mods.filter(Boolean).join(' + '));
        }
        if (r.kind === 'invalid') return setProblem(t.hotkeyInvalid);
        if (taken.includes(r.accelerator)) return setProblem(t.hotkeyDuplicate);
        setProblem(null);
        return finish(r.accelerator);
    }

    const shown = value ? hotkeyLabel(value) : t.hotkeyOff;
    return (
        <div className='col hotkey-col'>
            <div className='row hotkey-row'>
                <button
                    ref={ref}
                    type='button'
                    className={`field hotkey${recording ? ' rec' : ''}${busy && !recording ? ' bad' : ''}`}
                    aria-label={`${label}: ${shown}`}
                    onFocus={() => {
                        setRecording(true);
                        setProblem(null);
                        setHeld('');
                        void api.pauseHotkeys(true);
                    }}
                    onBlur={() => {
                        setRecording(false);
                        setHeld('');
                        void api.pauseHotkeys(false);
                    }}
                    onKeyDown={onKey}
                    onKeyUp={(ev) => {
                        if (!ev.ctrlKey && !ev.altKey && !ev.shiftKey) setHeld('');
                    }}
                >
                    {recording ? (held ? `${held} + …` : t.hotkeyRecording) : shown}
                </button>
                {value && (
                    <button
                        type='button'
                        className='icon-btn'
                        title={t.hotkeyClear}
                        aria-label={`${t.hotkeyClear}: ${label}`}
                        onClick={() => onChange('')}
                    >
                        <Icon name='x' size={14} />
                    </button>
                )}
            </div>
            {(problem ?? busy) && (
                <div className='msg bad' role={problem ? 'alert' : 'status'}>
                    {problem ?? t.hotkeyBusy}
                </div>
            )}
        </div>
    );
}

const actionLabel = (a: HotkeyAction, t: Dict) =>
    a === 'join' ? t.hotkeyJoin : a === 'open' ? t.hotkeyOpen : t.hotkeyCreate;

export function HotkeySettings({
    value,
    saved,
    problems,
    onChange,
    t,
}: {
    value: Hotkeys;
    saved: Hotkeys;
    problems: HotkeyAction[];
    onChange: (next: Hotkeys) => void;
    t: Dict;
}) {
    const changed = HOTKEY_ACTIONS.some((a) => value[a] !== saved[a]);
    return (
        <React.Fragment>
            <h2>{t.hotkeysTitle}</h2>
            <div className='card'>
                <div className='setting-row'>
                    <div className='label'>
                        <div className='hint'>{t.hotkeysHint}</div>
                        {changed && <div className='hint'>{t.hotkeysUnsaved}</div>}
                    </div>
                </div>
                {HOTKEY_ACTIONS.map((action) => {
                    const label = actionLabel(action, t);
                    const others = HOTKEY_ACTIONS.filter((a) => a !== action)
                        .map((a) => value[a])
                        .filter(Boolean);
                    const fallback = DEFAULT_HOTKEYS[action];
                    const canReset = value[action] !== fallback && !others.includes(fallback);
                    return (
                        <div className='setting-row' key={action}>
                            <div className='label'>
                                <div>{label}</div>
                                {action === 'join' && (
                                    <div className='hint'>{t.hotkeyJoinHint}</div>
                                )}
                                {canReset && (
                                    <button
                                        type='button'
                                        className='link-btn'
                                        onClick={() => onChange({ ...value, [action]: fallback })}
                                    >
                                        {t.hotkeyReset}: {hotkeyLabel(fallback)}
                                    </button>
                                )}
                            </div>
                            <HotkeyField
                                value={value[action]}
                                onChange={(v) => onChange({ ...value, [action]: v })}
                                label={label}
                                t={t}
                                taken={others}
                                busy={problems.includes(action) && value[action] === saved[action]}
                            />
                        </div>
                    );
                })}
            </div>
        </React.Fragment>
    );
}

export function FreeTimeRow({
    value,
    onChange,
    t,
}: {
    value: boolean;
    onChange: (v: boolean) => void;
    t: Dict;
}) {
    return (
        <div className='setting-row'>
            <div className='label'>
                <div>{t.freeTimeSetting}</div>
                <div className='hint'>{t.freeTimeSettingHint}</div>
            </div>
            <button
                type='button'
                role='switch'
                aria-checked={value}
                aria-label={t.freeTimeSetting}
                className='switch'
                onClick={() => onChange(!value)}
            />
        </div>
    );
}

export function ForgetFrequentRow({ t }: { t: Dict }) {
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    async function forget() {
        setMsg(null);
        try {
            const n = await api.forgetFrequent();
            setMsg({ ok: true, text: n > 0 ? t.frequentForgotten(n) : t.frequentNone });
        } catch (e) {
            setMsg({ ok: false, text: ipcMessage(e) });
        }
    }
    return (
        <div className='setting-row'>
            <div className='label'>
                <div className='hint'>{t.frequentHint}</div>
                {msg && (
                    <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role='status'>
                        {msg.text}
                    </div>
                )}
            </div>
            <button
                type='button'
                className='btn compact'
                onClick={() => {
                    void forget();
                }}
            >
                {t.frequentForget}
            </button>
        </div>
    );
}
