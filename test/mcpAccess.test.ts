import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type McpCalendarView } from '../src/main/mcp/catalog';
import { McpController } from '../src/main/mcp/controller';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { callBridge } from '../src/mcp/bridgeClient';
import { participantGroupAccount } from '../src/shared/participantGroups';
import { sanitizeUpdate } from '../src/shared/validate';

vi.mock('node:fs', async (importOriginal) => {
    const original = await importOriginal<typeof fs>();
    return { ...original, renameSync: vi.fn(original.renameSync) };
});

const closers: Array<() => void> = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const close of closers.splice(0).toReversed()) close();
});
function setup(confirm = vi.fn(async () => true)) {
    const directory = mkdtempSync(nodePath.join(tmpdir(), 'owa-mcp-access-'));
    closers.push(() => rmSync(directory, { recursive: true, force: true }));
    const view: McpCalendarView = {
        account: 'mail.internal.test|user',
        revision: 1,
        events: [],
        privacyMode: false,
        sync: { phase: 'ok' },
        version: '1.4.4',
        demo: false,
    };
    const options = {
        directory,
        cliPath: '/app/resources/mcp/index.cjs',
        view: () => view,
        confirm,
    };
    const controller = new McpController(options);
    closers.push(() => controller.close());
    const file = nodePath.join(directory, 'connection.json');
    return { controller, view, confirm, file, directory, options };
}
const readOnly = { enabled: true, allowTitles: false };
const disabled = { enabled: false, allowTitles: false };

describe('MCP permission lifecycle', () => {
    it('starts disabled with no endpoint and requires native consent before exposing a key', async () => {
        const { controller, file, confirm } = setup();
        await controller.initialize();
        expect(controller.state()).toMatchObject({
            access: disabled,
            running: false,
            configuration: '',
        });
        expect(existsSync(file)).toBe(false);
        const state = await controller.setAccess(readOnly);
        expect(confirm).toHaveBeenCalledWith(readOnly);
        expect(state.running).toBe(true);
        expect(state.configuration).toContain('--connection-file');
        const { key } = JSON.parse(readFileSync(file, 'utf8')) as { key: string };
        expect(state.configuration).not.toContain(key);
        expect(JSON.stringify(state)).not.toContain('mail.internal.test');
    });

    it('declining consent leaves the endpoint closed', async () => {
        const { controller, file } = setup(vi.fn(async () => false));
        await controller.setAccess(readOnly);
        expect(controller.state().running).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it('widening titles asks again; narrowing and disabling revoke without consent', async () => {
        const { controller, confirm, file } = setup();
        await controller.setAccess(readOnly);
        const old = readFileSync(file, 'utf8');
        await controller.setAccess({ enabled: true, allowTitles: true });
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(readFileSync(file, 'utf8')).not.toBe(old);
        await controller.setAccess(readOnly);
        await controller.setAccess(disabled);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(existsSync(file)).toBe(false);
        await expect(callBridge(file, 'get_status', {})).rejects.toThrow('MCP unavailable');
    });

    it('disabling while consent is pending cannot be undone by a late approval', async () => {
        let approve!: (value: boolean) => void;
        const { controller, file } = setup(
            vi.fn(
                () =>
                    new Promise<boolean>((resolve) => {
                        approve = resolve;
                    }),
            ),
        );
        const pending = controller.setAccess(readOnly);
        await controller.setAccess(disabled);
        approve(true);
        await expect(pending).rejects.toThrow('expired');
        expect(controller.state().running).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it('rejects an approval for an obsolete account revision', async () => {
        let approve!: (value: boolean) => void;
        const { controller, view } = setup(
            vi.fn(
                () =>
                    new Promise<boolean>((resolve) => {
                        approve = resolve;
                    }),
            ),
        );
        const pending = controller.setAccess(readOnly);
        view.revision += 1;
        approve(true);
        await expect(pending).rejects.toThrow('expired');
        expect(controller.state().running).toBe(false);
    });

    it('checks the current account on every read, even before an accountChanged listener runs', async () => {
        const { controller, view, file } = setup();
        await controller.setAccess(readOnly);
        view.account = 'other-account';
        await expect(callBridge(file, 'get_status', {})).rejects.toThrow('MCP unavailable');
        expect(controller.state().running).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it('restores saved consent only for the same account and demo mode', async () => {
        const { controller, view, options, file } = setup();
        await controller.setAccess(readOnly);
        controller.close();
        expect(existsSync(file)).toBe(false);
        const restored = new McpController(options);
        closers.push(() => restored.close());
        await restored.initialize();
        expect(restored.state().running).toBe(true);
        restored.close();
        view.demo = true;
        const demo = new McpController(options);
        closers.push(() => demo.close());
        await demo.initialize();
        expect(demo.state().running).toBe(false);
    });

    it('fails closed if the access record cannot be saved', async () => {
        const { controller, directory, file } = setup();
        mkdirSync(nodePath.join(directory, 'access.json'));
        await expect(controller.setAccess(readOnly)).rejects.toThrow('could not be saved');
        expect(controller.state().running).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it.each([disabled, readOnly])(
        'does not restore a broader grant after a failed downgrade to %j',
        async (next) => {
            const { controller, directory, options } = setup();
            await controller.setAccess({ enabled: true, allowTitles: true });
            const rename = vi.mocked(fs.renameSync).mockImplementationOnce(() => {
                throw new Error('Simulated atomic write failure');
            });
            await expect(controller.setAccess(next)).rejects.toThrow('could not be saved');
            rename.mockRestore();
            expect(existsSync(nodePath.join(directory, 'access.json'))).toBe(false);
            const restored = new McpController(options);
            closers.push(() => restored.close());
            await restored.initialize();
            expect(restored.state()).toMatchObject({ running: false, access: disabled });
        },
    );

    it('rejects injected permission fields through both the dedicated and generic API', async () => {
        const { controller } = setup();
        await expect(controller.setAccess({ ...readOnly, token: 'injected' })).rejects.toThrow();
        // Generic settings patches cannot add permissions outside the AppSettings allowlist.
        expect(
            sanitizeUpdate({ settings: { mcp: readOnly } }, DEFAULT_SETTINGS).settings,
        ).not.toHaveProperty('mcp');
        expect(controller.state().running).toBe(false);
    });
});

it.each([true, false])(
    'requires new native MCP consent when an old owner is upgraded (SSO=%s)',
    async (useWindowsAuth) => {
        const { controller, view, options, confirm } = setup();
        view.account = JSON.stringify(['mail.example', 'windows']);
        await controller.setAccess(readOnly);
        controller.close();
        view.account = participantGroupAccount({
            serverUrl: 'mail.example',
            username: 'windows',
            useWindowsAuth,
        });
        const upgraded = new McpController(options);
        closers.push(() => upgraded.close());
        await upgraded.initialize();
        expect(upgraded.state().access).toEqual(disabled);
        expect(upgraded.state().running).toBe(false);
        await upgraded.setAccess(readOnly);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(upgraded.state().running).toBe(true);
        view.account = participantGroupAccount({
            serverUrl: 'mail.example',
            username: 'windows',
            useWindowsAuth: !useWindowsAuth,
        });
        expect(upgraded.state().running).toBe(false);
    },
);
