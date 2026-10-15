import { expect, it } from 'vitest';

import { ipcHarness } from './ipcSecurityHarness';

async function setup() {
    const h = ipcHarness(true);
    await h.service.syncNow();
    const event = h.service.events[0];
    h.service.setNote(event.id, 'Account A note');
    return { ...h, event };
}
it('does not clear replacement account notes after native approval returns for the old account', async () => {
    const h = await setup();
    h.service.on('accountChanged', () => {
        h.service.events = [{ ...h.event }];
        h.service.setNote(h.event.id, 'Account B retained note');
    });
    let switching: Promise<unknown> | undefined;
    h.confirm.mockImplementation(() => {
        // Cross the native-result promise boundary before replacing the account, then let the
        // actual settings update finish before the outer IPC continuation performs deletion.
        const update = () => {
            switching = h.service.applySettings({
                settings: {
                    ...h.service.settings,
                    account: { ...h.service.settings.account, username: 'account-b' },
                },
            });
        };
        queueMicrotask(() => {
            queueMicrotask(() => {
                queueMicrotask(update);
            });
        });
        return Promise.resolve({ response: 1 });
    });
    await expect(h.call('clearNotes')).rejects.toThrow(/Аккаунт изменился/);
    await switching;
    expect(h.service.settings.account.username).toBe('account-b');
    expect(h.service.getNote(h.event.id)).toBe('Account B retained note');
});

it.each([
    { response: 0, count: 0, text: 'Account A note' },
    { response: 1, count: 1, text: '' },
])(
    'honors native response $response for the unchanged account',
    async ({ response, count, text }) => {
        const h = await setup();
        h.confirm.mockResolvedValue({ response });
        expect(await h.call('clearNotes')).toBe(count);
        expect(h.service.getNote(h.event.id)).toBe(text);
    },
);
