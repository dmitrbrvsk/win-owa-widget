import { expect, it } from 'vitest';

import { participantGroupAccount } from '../src/shared/participantGroups';

it('separates SSO from every manual principal, including windows in any case', () => {
    const account = { serverUrl: 'mail.example', username: '', useWindowsAuth: true };
    const sso = participantGroupAccount(account);
    for (const username of ['windows', ' WINDOWS ', 'alice', 'sso']) {
        expect(participantGroupAccount({ ...account, useWindowsAuth: false, username })).not.toBe(
            sso,
        );
    }
    expect(participantGroupAccount({ ...account, username: 'unused' })).toBe(sso);
    expect(
        participantGroupAccount({ ...account, useWindowsAuth: false, username: ' ALICE ' }),
    ).toBe(participantGroupAccount({ ...account, useWindowsAuth: false, username: 'alice' }));
});
