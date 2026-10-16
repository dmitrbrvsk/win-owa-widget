import { useState } from 'react';

import { type Dict } from '../shared/i18n';
import { type Snapshot } from '../shared/types';

import { api } from './api';
import { ipcMessage } from './hooks';

export function AccountRecovery({ snap, t }: { snap: Snapshot; t: Dict }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    if (!snap.accountRecovery) return null;
    return (
        <div className='msg' role='status'>
            <strong>{t.accountRecoveryTitle}</strong>
            <p className='hint'>
                {snap.accountRecovery === 'retry' ? t.accountRecoveryRetry : t.accountRecoveryHint}
            </p>
            <button
                type='button'
                className='btn small'
                disabled={busy}
                onClick={() => {
                    setBusy(true);
                    setError('');
                    void api
                        .recoverAccountData(snap.participantGroups.account)
                        .catch((e) => setError(ipcMessage(e)))
                        .finally(() => setBusy(false));
                }}
            >
                {t.accountRecoveryAction}
            </button>
            {error && (
                <p className='bad' role='alert'>
                    {error}
                </p>
            )}
        </div>
    );
}
