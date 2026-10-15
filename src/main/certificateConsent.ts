import { type CertInfo } from '../shared/types';

interface CertificateContext {
    readonly accountRevision: number;
    pendingCertificate(): CertInfo | undefined;
}

export interface CertificateApproval {
    fingerprint: string;
    host: string;
    accountRevision: number;
}

/** Trusting a certificate is a decision for the person, so it is asked in a native dialog the page cannot fake or click. */
export async function confirmCertificateTrust(
    source: CertificateContext,
    fingerprint: string,
    confirm: (options: Electron.MessageBoxOptions) => Promise<number>,
): Promise<CertificateApproval | undefined> {
    const current = source.pendingCertificate();
    if (current?.fingerprint !== fingerprint)
        throw new Error('Сертификат изменился — обновите календарь и повторите');
    const pending = { ...current };
    const revision = source.accountRevision;
    const until = new Date(pending.validTo).toLocaleDateString('ru-RU');
    const response = await confirm({
        type: 'warning',
        title: 'OWA Widget',
        message: `Сертификат сервера ${pending.host} не прошел проверку Windows`,
        detail:
            `Сертификат ${pending.reason}.\n\n` +
            `Выдан: ${pending.issuer}\nДля: ${pending.subject}\nДействует до: ${until}\nОтпечаток: ${pending.fingerprint}\n\n` +
            'Если это внутренний сертификат компании, правильнее установить корневой сертификат компании в Windows — тогда ему будут доверять и браузер, и это приложение. ' +
            'Если все же довериться здесь, приложение будет отправлять на этот сервер ваш пароль и читать календарь, пока сертификат совпадает с отпечатком выше.\n\n' +
            'Сверьте отпечаток с тем, что показывает ваш ИТ-отдел. Если не уверены — нажмите «Отмена»: так можно отдать пароль подставному серверу.',
        buttons: ['Отмена', 'Довериться этому сертификату'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
    });
    if (response !== 1) return undefined;
    const latest = source.pendingCertificate();
    if (
        revision !== source.accountRevision ||
        latest?.host !== pending.host ||
        latest.fingerprint !== pending.fingerprint
    )
        throw new Error('Сертификат изменился — обновите календарь и повторите');
    return { fingerprint: pending.fingerprint, host: pending.host, accountRevision: revision };
}
