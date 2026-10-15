// Real main IPC in an isolated VM: no profile reads, network, Electron windows or external browser.
import { buildSync } from 'esbuild';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { vi } from 'vitest';

import { type CalendarService } from '../src/main/calendarService';
import { type CertInfo } from '../src/shared/types';

const require = createRequire(import.meta.url);
const root = nodePath.dirname(nodePath.dirname(fileURLToPath(import.meta.url)));
const bundle = buildSync({
    stdin: {
        loader: 'ts',
        contents: `${readFileSync(nodePath.join(root, 'src/main/index.ts'), 'utf8')}\nexport function auditBoot(demo: boolean) { service = new CalendarService(demo); registerIpc(); return service; }\nimport { OwaClient as AuditClient } from './owa/client';\nexport function auditCertificate(cert: unknown) { AuditClient.prototype.fetchCalendarView = async () => { const error = new OwaError('certificate', 'Synthetic certificate failure'); error.cert = cert; throw error; }; }`,
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
export function ipcHarness(demo: boolean) {
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
    const mod = {
        exports: {} as {
            auditBoot: (demo: boolean) => CalendarService;
            auditCertificate: (cert: CertInfo) => void;
        },
    };
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
    return {
        service,
        call,
        opened,
        confirm,
        requests: () => requests,
        certificate: mod.exports.auditCertificate,
    };
}
