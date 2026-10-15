import { describe, expect, it, vi } from 'vitest';

import { type CertInfo } from '../src/shared/types';

import { ipcHarness } from './ipcSecurityHarness';

const certificate = (byte: number): CertInfo => ({
    host: 'mail.example.test',
    fingerprint: `sha256/${Buffer.alloc(32, byte).toString('base64')}`,
    issuer: 'Synthetic CA',
    subject: 'mail.example.test',
    validTo: '2030-01-01T00:00:00Z',
    reason: 'Synthetic untrusted certificate',
});
const first = certificate(17);
const second = certificate(34);

async function setup() {
    const h = ipcHarness(false);
    h.service.settings.account.serverUrl = first.host;
    h.certificate(first);
    await h.call('testConnection', { settings: h.service.settings });
    expect(h.service.pendingCertificate()?.fingerprint).toBe(first.fingerprint);
    return h;
}

describe('certificate consent through the real main IPC and CalendarService', () => {
    it('rejects a renderer fingerprint different from the pending certificate before asking', async () => {
        const h = await setup();
        const pin = vi.spyOn(h.service, 'trustCertificate');
        h.confirm.mockResolvedValue({ response: 1 });
        await expect(h.call('trustCertificate', second.fingerprint)).rejects.toThrow(
            /Сертификат изменился/,
        );
        expect(h.confirm).not.toHaveBeenCalled();
        expect(pin).not.toHaveBeenCalled();
        expect(h.service.settings.account.trustedCertFingerprint).toBeUndefined();
    });

    it.each([
        ['fingerprint', second],
        ['host', { ...first, host: 'different.example.test' }],
    ])('rejects a changed pending %s while the native dialog is open', async (_field, changed) => {
        const h = await setup();
        const pin = vi.spyOn(h.service, 'trustCertificate');
        let answer!: (value: { response: number }) => void;
        h.confirm.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const revision = h.service.accountRevision;
        const pending = h.call('trustCertificate', first.fingerprint);
        const checked = expect(pending).rejects.toThrow(/Сертификат изменился/);
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledOnce());
        const options = h.confirm.mock.calls[0][0] as { detail: string };
        expect(options.detail).toContain(first.fingerprint);
        expect(options.detail).not.toContain(second.fingerprint);
        h.certificate(changed);
        await h.call('testConnection', { settings: h.service.settings });
        expect(h.service.accountRevision).toBe(revision);
        expect(h.service.pendingCertificate()).toMatchObject(changed);
        answer({ response: 1 });
        await checked;
        expect(pin).not.toHaveBeenCalled();
        expect(h.service.settings.account.trustedCertFingerprint).toBeUndefined();
    });

    it('pins the exact certificate shown when the native approval is still current', async () => {
        const h = await setup();
        const pin = vi.spyOn(h.service, 'trustCertificate');
        h.confirm.mockResolvedValue({ response: 1 });
        const { accountRevision } = h.service;
        await h.call('trustCertificate', first.fingerprint);
        expect(pin).toHaveBeenCalledExactlyOnceWith({
            fingerprint: first.fingerprint,
            host: first.host,
            accountRevision,
        });
        expect(h.service.settings.account).toMatchObject({
            trustedCertFingerprint: first.fingerprint,
            trustedCertHost: first.host,
        });
    });
});
