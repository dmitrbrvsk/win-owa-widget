import { app } from 'electron';
import nodePath from 'node:path';

import { participantGroupAccount } from '../../shared/participantGroups';
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
                    return {
                        id,
                        label,
                        owner: participantGroupAccount(calendar.settings.account),
                        revision: calendar.accountRevision,
                        sync: calendar.sync,
                    };
                })),
        confirm: (access, label) => confirm(mcpConsent(access, english(), label)),
    });
    if (accounts) {
        accounts.on('removed', (id: string, owner: string) => {
            void controller.removeSource(id, owner).catch(() => {});
        });
    } else {
        service.on('accountChanged', () => controller.revoke());
    }
    app.once('will-quit', () => controller.close());
    await controller.initialize();
    return controller;
}
