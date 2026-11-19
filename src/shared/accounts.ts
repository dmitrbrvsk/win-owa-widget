import { checkServerUrl, serverUrlError } from './serverUrl';
import { type SyncState } from './types';

export const ACCOUNT_COLORS = [
    '#1a73e8',
    '#188038',
    '#9334e6',
    '#c5221f',
    '#b06000',
    '#007b83',
    '#bd2086',
    '#526276',
] as const;

export interface AccountSummary {
    id: string;
    label: string;
    color: string;
    visible: boolean;
    phase: SyncState['phase'];
    errorKind?: SyncState['errorKind'];
    lastSuccess?: string;
}

export interface AccountDraft {
    label: string;
    color?: string;
    serverUrl: string;
    username: string;
    password?: string;
}

export interface AccountsApi {
    addAccount(draft: AccountDraft): Promise<string>;
    renameAccount(id: string, label: string, color: string): Promise<void>;
    removeAccount(id: string): Promise<void>;
    setPrimaryAccount(id: string): Promise<void>;
    setAccountVisible(id: string, visible: boolean): Promise<void>;
    showAllAccounts(): Promise<void>;
    selectAccount(id: string): Promise<void>;
}

export const DEFAULT_SERVER_URL = 'owa.alfabank.ru';

function record(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Недопустимые данные аккаунта');
    return input as Record<string, unknown>;
}

export function accountLabel(value: unknown): string {
    if (typeof value !== 'string' || value.length > 100 || /[\r\n]/.test(value))
        throw new Error('Недопустимое имя аккаунта');
    return value.trim();
}

export function accountColor(value: unknown): string {
    if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))
        throw new Error('Недопустимый цвет аккаунта');
    return value.toLowerCase();
}

export function accountDraft(input: unknown) {
    const value = record(input);
    const address = checkServerUrl(typeof value.serverUrl === 'string' ? value.serverUrl : '');
    if (!address.ok) throw new Error(serverUrlError(address));
    if (typeof value.username !== 'string' || value.username.length > 256)
        throw new Error('Недопустимый логин');
    const username = value.username.trim();
    const { password } = value;
    if (
        (password !== undefined && (typeof password !== 'string' || password.length > 1024)) ||
        Boolean(username) !== Boolean(password)
    )
        throw new Error('Укажите логин и пароль или оставьте оба поля пустыми для входа Windows');
    return {
        label: accountLabel(value.label),
        color: value.color === undefined ? undefined : accountColor(value.color),
        settings: {
            serverUrl: address.url.replace(/^https:\/\//, ''),
            username,
            useWindowsAuth: !username,
            hasPassword: false,
        },
        password,
    };
}

export const ACCOUNT_IPC = {
    addAccount: 'owa:addAccount',
    renameAccount: 'owa:renameAccount',
    removeAccount: 'owa:removeAccount',
    setPrimaryAccount: 'owa:setPrimaryAccount',
    setAccountVisible: 'owa:setAccountVisible',
    showAllAccounts: 'owa:showAllAccounts',
    selectAccount: 'owa:selectAccount',
    getMcpState: 'owa:getMcpState',
    setMcpAccess: 'owa:setMcpAccess',
    setPrivacyMode: 'owa:setPrivacyMode',
    saveParticipantGroup: 'owa:saveParticipantGroup',
    deleteParticipantGroup: 'owa:deleteParticipantGroup',
    connectionProgress: 'owa:connectionProgress',
    getSupportReport: 'owa:getSupportReport',
    checkForUpdates: 'owa:checkForUpdates',
    openUpdatePage: 'owa:openUpdatePage',
} as const;
