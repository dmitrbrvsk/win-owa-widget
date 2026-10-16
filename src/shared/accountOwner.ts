import { serverKey } from './serverUrl';
import { type AccountSettings } from './types';

export interface AccountRecoveryApi {
    recoverAccountData(account: string): Promise<void>;
}

/** Version, origin, authentication mode and principal occupy distinct tuple positions. */
export function accountOwner(
    account: Pick<AccountSettings, 'serverUrl' | 'username' | 'useWindowsAuth'>,
): string {
    return JSON.stringify([
        2,
        serverKey(account.serverUrl),
        account.useWindowsAuth ? 'sso' : 'password',
        account.useWindowsAuth ? '' : account.username.trim().toLowerCase(),
    ]);
}

export function legacyAccountOwner(owner: string): { key: string; ambiguous: boolean } | undefined {
    try {
        const value: unknown = JSON.parse(owner);
        if (!Array.isArray(value) || value.length !== 4 || value[0] !== 2) return undefined;
        const server: unknown = value[1];
        const mode: unknown = value[2];
        const principal: unknown = value[3];
        if (typeof server !== 'string' || typeof principal !== 'string') return undefined;
        if (mode !== 'sso' && mode !== 'password') return undefined;
        if (server !== serverKey(server) || principal !== principal.trim().toLowerCase())
            return undefined;
        if (mode === 'sso' && principal !== '') return undefined;
        const login = mode === 'sso' ? 'windows' : principal;
        return { key: JSON.stringify([server, login]), ambiguous: login === 'windows' };
    } catch {
        return undefined;
    }
}
