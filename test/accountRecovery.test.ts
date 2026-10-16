import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { confirmAccountRecovery } from '../src/main/accountRecovery';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { participantGroupAccount } from '../src/shared/participantGroups';

let tick = 0;
beforeEach(() => {
    vi.useFakeTimers();
    tick += 1;
    vi.setSystemTime(new Date(1_800_000_000_000 + tick * 61_000));
});
afterEach(() => vi.useRealTimers());
function context() {
    const state = { revision: 1 };
    const source = {
        settings: { ...structuredClone(DEFAULT_SETTINGS), language: 'en' as const },
        get accountRevision() {
            return state.revision;
        },
        accountRecovery: 'available' as const,
        recoverAccountData: vi.fn(),
    };
    source.settings.account.serverUrl = 'mail.example';
    return { source, state, owner: participantGroupAccount(source.settings.account) };
}
it('needs native approval and states the destination and conflict policy', async () => {
    const { source, owner } = context();
    const native = vi.fn<(options: Electron.MessageBoxOptions) => Promise<number>>(async () => 1);
    await confirmAccountRecovery(source, owner, native);
    expect(native).toHaveBeenCalledWith(
        expect.objectContaining({
            defaultId: 0,
            cancelId: 0,
            type: 'warning',
        }),
    );
    expect(native.mock.calls[0][0].detail).toContain('mail.example');
    expect(native.mock.calls[0][0].detail).toContain('Windows SSO');
    expect(source.recoverAccountData).toHaveBeenCalledExactlyOnceWith(owner, 1);
});
it('declining approval makes no storage call', async () => {
    const { source, owner } = context();
    await confirmAccountRecovery(source, owner, async () => 0);
    expect(source.recoverAccountData).not.toHaveBeenCalled();
});
it.each(['forged', 'privacy'])('rejects %s before opening a dialog', async (kind) => {
    const { source, owner } = context();
    const native = vi.fn<(options: Electron.MessageBoxOptions) => Promise<number>>(async () => 1);
    if (kind === 'privacy') source.settings.privacyMode = true;
    await expect(
        confirmAccountRecovery(source, kind === 'forged' ? 'other-owner' : owner, native),
    ).rejects.toThrow();
    expect(native).not.toHaveBeenCalled();
    expect(source.recoverAccountData).not.toHaveBeenCalled();
});
it.each(['owner', 'revision', 'privacy'])(
    'expires consent after a pending %s change',
    async (kind) => {
        const { source, state, owner } = context();
        let approve!: (answer: number) => void;
        const pending = confirmAccountRecovery(
            source,
            owner,
            () =>
                new Promise((resolve) => {
                    approve = resolve;
                }),
        );
        if (kind === 'owner') source.settings.account.username = 'other-user';
        if (kind === 'owner') source.settings.account.useWindowsAuth = false;
        if (kind === 'revision') state.revision += 1;
        if (kind === 'privacy') source.settings.privacyMode = true;
        approve(1);
        await expect(pending).rejects.toThrow(/Аккаунт изменился/);
        expect(source.recoverAccountData).not.toHaveBeenCalled();
    },
);
