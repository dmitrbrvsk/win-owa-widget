import { participantGroupAccount } from '../shared/participantGroups';
import { serverKey } from '../shared/serverUrl';
import { oneLine } from '../shared/text';

import { type CalendarService } from './calendarService';
import { RequestGate } from './limits';

const recoveryGate = new RequestGate(1, 3, 60_000);

/** The page cannot choose a destination owner or approve recovery of ambiguous local data. */
export async function confirmAccountRecovery(
    service: Pick<
        CalendarService,
        'settings' | 'accountRevision' | 'accountRecovery' | 'recoverAccountData'
    >,
    suppliedOwner: unknown,
    confirm: (options: Electron.MessageBoxOptions) => Promise<number>,
    language = service.settings.language,
): Promise<void> {
    const owner = participantGroupAccount(service.settings.account);
    if (suppliedOwner !== owner || !service.accountRecovery || service.settings.privacyMode)
        throw new Error('Данные для восстановления недоступны: обновите настройки');
    const release = recoveryGate.enter();
    const revision = service.accountRevision;
    try {
        const { account } = service.settings;
        const english = language === 'en';
        const identity = account.useWindowsAuth ? 'Windows SSO' : oneLine(account.username, 256);
        const response = await confirm({
            type: 'warning',
            title: 'OWA Widget',
            message: english
                ? 'Assign preserved data to this account?'
                : 'Назначить сохраненные данные этому аккаунту?',
            detail: `${serverKey(account.serverUrl)}\n${identity}\n\n${
                english
                    ? 'Older records did not distinguish Windows SSO from a manual login named windows. Assign them only if they belong to this account. The original encrypted data will be preserved. Existing notes win conflicts; conflicting group names get a numeric suffix. This choice cannot assign the same source to a second account.'
                    : 'Старые записи не различали Windows SSO и ручной логин windows. Назначайте их только если они принадлежат этому аккаунту. Исходные зашифрованные данные сохранятся. При совпадении заметок останутся текущие; совпадающие названия групп получат номер. Те же исходные данные нельзя будет назначить второму аккаунту.'
            }`,
            buttons: english
                ? ['Cancel', 'Assign to this account']
                : ['Отмена', 'Назначить этому аккаунту'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
        if (response !== 1) return;
        if (
            revision !== service.accountRevision ||
            owner !== participantGroupAccount(service.settings.account) ||
            service.settings.privacyMode
        )
            throw new Error('Аккаунт изменился: повторите восстановление');
        service.recoverAccountData(owner, revision);
    } finally {
        release();
    }
}
