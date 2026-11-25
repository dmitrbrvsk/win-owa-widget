import { app } from 'electron';
import nodePath from 'node:path';

import { participantGroupAccount } from '../../shared/participantGroups';
import { oneLine } from '../../shared/text';
import { type CalendarAccounts } from '../calendarAccounts';
import { type CalendarService } from '../calendarService';

import { mcpConsent } from './consent';
import { McpController } from './controller';

export async function createAppMcp(
    service: CalendarService,
    confirm: (options: Electron.MessageBoxOptions) => Promise<boolean>,
    english: () => boolean,
    accounts?: CalendarAccounts,
): Promise<McpController> {
    const controller = new McpController({
        directory: nodePath.join(app.getPath('userData'), service.demo ? 'mcp-demo' : 'mcp'),
        cliPath: app.isPackaged
            ? nodePath.join(process.resourcesPath, 'mcp', 'index.cjs')
            : nodePath.join(app.getAppPath(), 'dist', 'mcp', 'index.cjs'),
        view: () => ({
            account: accounts
                ? 'saved-accounts'
                : participantGroupAccount(service.settings.account),
            revision: accounts ? 0 : service.accountRevision,
            events: accounts?.events ?? service.events,
            privacyMode: service.settings.privacyMode,
            sync: service.sync,
            version: app.getVersion(),
            demo: service.demo,
        }),
        sources:
            accounts &&
            (() =>
                accounts.summaries().map(({ id, label }) => {
                    const calendar = accounts.calendar(id);
                    const { account } = calendar.settings;
                    return {
                        id,
                        label: [
                            oneLine(label, 100),
                            `Exchange — ${account.serverUrl}`,
                            account.useWindowsAuth
                                ? 'Windows SSO'
                                : `${english() ? 'Login' : 'Логин'} — ${oneLine(account.username, 256)}`,
                        ].join('\n'),
                        owner: participantGroupAccount(account),
                        revision: calendar.accountRevision,
                        sync: calendar.sync,
                    };
                })),
        confirm: (access, label) => confirm(mcpConsent(access, english(), label)),
    });
    if (accounts) {
        const revoke = (id: string, owner: string) => {
            void controller.removeSource(id, owner).catch(() => {});
        };
        accounts.on('removed', revoke);
        accounts.on('ownerChanged', revoke);
    } else {
        service.on('accountChanged', () => controller.revoke());
    }
    app.once('will-quit', () => controller.close());
    await controller.initialize();
    return controller;
}
