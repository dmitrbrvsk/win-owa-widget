import { useMemo, useState } from 'react';

import { type Snapshot } from '../shared/types';

import { api } from './api';
import { ipcMessage, useI18n } from './hooks';

export function useCalendarEvents(snap: Snapshot) {
    const { accounts, events } = snap;
    return useMemo(() => {
        if (!accounts?.length) return events;
        const visible = new Set(
            accounts.filter((account) => account.visible).map((account) => account.id),
        );
        return events.filter((event) => event.accountId && visible.has(event.accountId));
    }, [accounts, events]);
}

export function AccountFilters({ snap }: { snap: Snapshot }) {
    const { lang } = useI18n(snap);
    const en = lang === 'en';
    const [error, setError] = useState('');
    const { accounts } = snap;
    if (!accounts?.length) return null;
    const apply = (action: Promise<void>) => {
        setError('');
        void action.catch((cause: unknown) => setError(ipcMessage(cause)));
    };
    return (
        <div className='account-filters' role='group' aria-label={en ? 'Calendars' : 'Календари'}>
            {accounts.map((account) => {
                const label = snap.settings.privacyMode
                    ? (en ? 'Calendar ' : 'Календарь ') + account.label
                    : account.label;
                const failed = account.phase === 'error';
                const status = failed ? (en ? 'Sync error' : 'Ошибка синхронизации') : '';
                return (
                    <label className='account-filter' key={account.id} title={status || label}>
                        <input
                            type='checkbox'
                            checked={account.visible}
                            onChange={(event) =>
                                apply(api.setAccountVisible(account.id, event.target.checked))
                            }
                        />
                        <span
                            className='account-swatch'
                            style={{ backgroundColor: account.color }}
                            aria-hidden='true'
                        />
                        <span>{label}</span>
                        {failed && (
                            <span className='msg bad' role='img' aria-label={status}>
                                !
                            </span>
                        )}
                    </label>
                );
            })}
            {accounts.some((account) => !account.visible) && (
                <button
                    type='button'
                    className='btn compact'
                    onClick={() => apply(api.showAllAccounts())}
                >
                    {en ? 'Show all' : 'Показать все'}
                </button>
            )}
            {error && (
                <span className='msg bad' role='alert'>
                    {error}
                </span>
            )}
        </div>
    );
}

export function AccountPicker({
    snap,
    fixed = false,
    settings = false,
}: {
    snap: Snapshot;
    fixed?: boolean;
    settings?: boolean;
}) {
    const { lang } = useI18n(snap);
    const [error, setError] = useState('');
    const [changing, setChanging] = useState(false);
    if (!snap.accounts?.length) return null;
    const label = lang === 'en' ? 'Exchange account' : 'Аккаунт Exchange';
    return (
        <div className='account-picker'>
            <label>
                {label}{' '}
                <select
                    className='field'
                    value={snap.selectedAccountId ?? ''}
                    disabled={fixed || changing || (!settings && snap.accounts.length === 1)}
                    onChange={async (event) => {
                        setError('');
                        setChanging(true);
                        try {
                            await api.selectAccount(event.target.value);
                        } catch (cause) {
                            setError(ipcMessage(cause));
                        } finally {
                            setChanging(false);
                        }
                    }}
                >
                    {snap.accounts.map((account) => (
                        <option value={account.id} key={account.id}>
                            {account.label}
                        </option>
                    ))}
                </select>
            </label>
            {error && (
                <span className='msg bad' role='alert'>
                    {error}
                </span>
            )}
        </div>
    );
}
