import { app } from 'electron';
import nodePath from 'node:path';

import { participantGroupAccount } from '../../shared/participantGroups';
import { type CalendarService } from '../calendarService';

import { mcpConsent } from './consent';
import { McpController } from './controller';

export async function createAppMcp(
    service: CalendarService,
    confirm: (options: Electron.MessageBoxOptions) => Promise<boolean>,
    english: () => boolean,
): Promise<McpController> {
    const controller = new McpController({
        directory: nodePath.join(app.getPath('userData'), 'mcp'),
        cliPath: app.isPackaged
            ? nodePath.join(process.resourcesPath, 'mcp', 'index.cjs')
            : nodePath.join(app.getAppPath(), 'dist', 'mcp', 'index.cjs'),
        view: () => ({
            account: participantGroupAccount(service.settings.account),
            revision: service.accountRevision,
            events: service.events,
            privacyMode: service.settings.privacyMode,
            sync: service.sync,
            version: app.getVersion(),
            demo: service.demo,
        }),
        confirm: (access) => confirm(mcpConsent(access, english())),
    });
    service.on('accountChanged', () => controller.revoke());
    app.once('will-quit', () => controller.close());
    await controller.initialize();
    return controller;
}
