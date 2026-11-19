import { useState } from 'react';

import { type AccountDraft, type AccountSummary, DEFAULT_SERVER_URL } from '../shared/accounts';
import { type Snapshot } from '../shared/types';

import { AccountPicker } from './AccountControls';
import { api } from './api';
import { ipcMessage, useI18n } from './hooks';

export function AccountManagement({ snap }: { snap: Snapshot }) {
    const { lang } = useI18n(snap);
    const en = lang === 'en';
    const [adding, setAdding] = useState(!snap.accounts?.length);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const account = snap.accounts?.find((entry) => entry.id === snap.selectedAccountId);
    const name = en ? 'Account name' : 'Название аккаунта';
    const color = en ? 'Calendar color' : 'Цвет календаря';
    const add = en ? 'Add account' : 'Добавить аккаунт';
    async function run(action: () => Promise<unknown>) {
        setError('');
        setBusy(true);
        try {
            await action();
        } catch (cause) {
            setError(ipcMessage(cause));
        } finally {
            setBusy(false);
        }
    }
    return (
        <section>
            <h2>{en ? 'Accounts' : 'Аккаунты'}</h2>
            <div className='card account-management'>
                <AccountPicker snap={snap} settings={true} fixed={busy} />
                {account && (
                    <AccountAppearance
                        key={account.id}
                        account={account}
                        labels={{
                            name,
                            color,
                            save: en ? 'Save appearance' : 'Сохранить оформление',
                        }}
                        disabled={busy}
                        onSave={(label, hex) =>
                            run(() => api.renameAccount(account.id, label, hex))
                        }
                    />
                )}
                {account && (
                    <div className='account-actions'>
                        {account.id === snap.primaryAccountId ? (
                            <span className='hint'>
                                {en ? 'Primary account' : 'Основной аккаунт'}
                            </span>
                        ) : (
                            <button
                                type='button'
                                className='btn'
                                disabled={busy}
                                onClick={() => {
                                    void run(() => api.setPrimaryAccount(account.id));
                                }}
                            >
                                {en ? 'Set as primary' : 'Сделать основным'}
                            </button>
                        )}
                        <button
                            type='button'
                            className='btn'
                            disabled={busy}
                            onClick={() => {
                                void run(() => api.removeAccount(account.id));
                            }}
                        >
                            {en ? 'Remove account…' : 'Удалить аккаунт…'}
                        </button>
                    </div>
                )}
                {adding || !snap.accounts?.length ? (
                    <AddAccountForm
                        snap={snap}
                        busy={busy}
                        onCancel={() => setAdding(false)}
                        onAdd={(draft) =>
                            run(async () => {
                                await api.addAccount(draft);
                                setAdding(false);
                            })
                        }
                    />
                ) : (
                    <button type='button' className='btn' onClick={() => setAdding(true)}>
                        {add}
                    </button>
                )}
                {error && (
                    <div className='msg bad' role='alert'>
                        {error}
                    </div>
                )}
            </div>
        </section>
    );
}

function AddAccountForm({
    snap,
    busy,
    onCancel,
    onAdd,
}: {
    snap: Snapshot;
    busy: boolean;
    onCancel: () => void;
    onAdd: (draft: AccountDraft) => Promise<void>;
}) {
    const { t, lang } = useI18n(snap);
    const en = lang === 'en';
    const name = en ? 'Account name' : 'Название аккаунта';
    const add = en ? 'Add account' : 'Добавить аккаунт';
    return (
        <form
            className='account-fields'
            onSubmit={(event) => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                const field = (key: string) => {
                    const value = fields.get(key);
                    return typeof value === 'string' ? value : '';
                };
                void onAdd({
                    label: field('label'),
                    serverUrl: field('server'),
                    username: field('username'),
                    password: field('password'),
                });
            }}
        >
            <label>
                {name}
                <input className='field' name='label' maxLength={100} />
            </label>
            <label>
                {t.serverUrl}
                <input
                    className='field'
                    name='server'
                    placeholder='mail.company.ru'
                    defaultValue={snap.accounts?.length ? '' : DEFAULT_SERVER_URL}
                    maxLength={254}
                    required={true}
                />
            </label>
            <label>
                {t.username}
                <input className='field' name='username' maxLength={256} autoComplete='username' />
            </label>
            <label>
                {t.password}
                <input
                    className='field'
                    name='password'
                    type='password'
                    maxLength={1024}
                    autoComplete='current-password'
                />
            </label>
            <div className='hint'>{t.credentialsHint}</div>
            <div className='account-actions'>
                <button className='btn primary' type='submit' disabled={busy}>
                    {add}
                </button>
                {!!snap.accounts?.length && (
                    <button type='button' className='btn' disabled={busy} onClick={onCancel}>
                        {en ? 'Cancel' : 'Отмена'}
                    </button>
                )}
            </div>
        </form>
    );
}

function AccountAppearance({
    account,
    labels,
    disabled,
    onSave,
}: {
    account: AccountSummary;
    labels: { name: string; color: string; save: string };
    disabled: boolean;
    onSave: (label: string, color: string) => Promise<void>;
}) {
    const [label, setLabel] = useState(account.label);
    const [color, setColor] = useState(account.color);
    return (
        <form
            className='account-actions'
            onSubmit={(event) => {
                event.preventDefault();
                void onSave(label, color);
            }}
        >
            <label>
                {labels.name}{' '}
                <input
                    className='field'
                    value={label}
                    maxLength={100}
                    onChange={(event) => setLabel(event.target.value)}
                />
            </label>
            <label>
                {labels.color}{' '}
                <input
                    type='color'
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                />
            </label>
            <button
                className='btn'
                type='submit'
                disabled={disabled || (label === account.label && color === account.color)}
            >
                {labels.save}
            </button>
        </form>
    );
}
