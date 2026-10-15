import { expect, it } from 'vitest';

import { type CertInfo } from '../src/shared/types';

import { ipcHarness } from './ipcSecurityHarness';

const first: CertInfo = {
    host: 'mail.example.test',
    fingerprint: `sha256/${Buffer.alloc(32, 17).toString('base64')}`,
    issuer: 'Synthetic CA',
    subject: 'mail.example.test',
    validTo: '2030-01-01T00:00:00Z',
    reason: 'Synthetic untrusted certificate',
};
it('rejects a same-fingerprint host replacement between consent validation and pinning', async () => {
    const h = ipcHarness(false);
    h.service.settings.account.serverUrl = first.host;
    h.certificate(first);
    await h.call('testConnection', { settings: h.service.settings });
    let probe: Promise<unknown> | undefined;
    h.confirm.mockImplementation(() => {
        // Let the helper validate its captured certificate, then complete another probe before
        // the outer IPC continuation pins it. The final consumer must recheck the whole context.
        const update = () => {
            h.certificate({ ...first, host: 'other.example.test' });
            probe = h.call('testConnection', { settings: h.service.settings });
        };
        queueMicrotask(() => {
            queueMicrotask(() => {
                queueMicrotask(update);
            });
        });
        return Promise.resolve({ response: 1 });
    });
    await expect(h.call('trustCertificate', first.fingerprint)).rejects.toThrow(
        /Сертификат изменился/,
    );
    await probe;
    expect(h.service.pendingCertificate()?.host).toBe('other.example.test');
    expect(h.service.settings.account.trustedCertHost).toBeUndefined();
    expect(h.service.settings.account.trustedCertFingerprint).toBeUndefined();
});
it('rejects approval from an earlier account even when the new account sees the same certificate', async () => {
    const h = ipcHarness(false);
    h.service.settings.account.serverUrl = first.host;
    h.certificate(first);
    await h.call('testConnection', { settings: h.service.settings });
    const approval = {
        fingerprint: first.fingerprint,
        host: first.host,
        accountRevision: h.service.accountRevision,
    };
    await h.service.applySettings({
        settings: {
            ...h.service.settings,
            account: { ...h.service.settings.account, username: 'replacement-account' },
        },
    });
    await h.call('testConnection', { settings: h.service.settings });
    expect(h.service.pendingCertificate()).toMatchObject(first);
    await expect(h.service.trustCertificate(approval)).rejects.toThrow(/Сертификат изменился/);
    expect(h.service.settings.account.trustedCertFingerprint).toBeUndefined();
});
