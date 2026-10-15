import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarService } from '../src/main/calendarService';
import { OwaError } from '../src/main/owa/errors';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { supportReport } from '../src/shared/diagnostics';
import { NoteBook } from '../src/shared/notes';
import { ParticipantGroupBook } from '../src/shared/participantGroups';
import {
    type ConnectionDiagnostics,
    type DiagnosticStage,
    type SettingsUpdate,
} from '../src/shared/types';

const network = vi.hoisted(() => ({
    stages: [] as DiagnosticStage[],
    error: undefined as OwaError | undefined,
    persist: true,
    dispose: vi.fn(),
    fetch: vi.fn(),
}));
vi.mock('../src/main/log', () => ({
    log: { info: vi.fn(), warn: vi.fn() },
    describeError: () => 'redacted',
}));
vi.mock('../src/main/store', () => ({
    loadSettings: () => structuredClone(DEFAULT_SETTINGS),
    loadNotes: () => new NoteBook(),
    loadParticipantGroups: () => new ParticipantGroupBook(),
    loadEventCache: () => [],
    loadPassword: () => {},
    saveSettings: vi.fn(),
    saveParticipantGroups: () => network.persist,
    saveNotes: vi.fn(),
    saveEventCache: vi.fn(),
    clearEventCache: vi.fn(),
    savePassword: vi.fn(),
}));
vi.mock('../src/main/owa/http', async () => {
    const { OwaError: MockOwaError } = await import('../src/main/owa/errors');
    return { OwaError: MockOwaError };
});
vi.mock('../src/main/owa/client', () => ({
    OwaClient: class {
        host = 'PRIVATE_SERVER';
        constructor(private opts: { onConnectionStage?: (s: DiagnosticStage) => void }) {}
        async fetchCalendarView() {
            network.fetch();
            for (const stage of network.stages) this.opts.onConnectionStage?.(stage);
            if (network.error) throw network.error;
            return [];
        }
        // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Mock interface delegates to shared test state instead of a real Electron session.
        dispose = () => {
            network.dispose();
        };
    },
}));

const update = (): SettingsUpdate => ({ settings: structuredClone(DEFAULT_SETTINGS) });
beforeEach(() => {
    network.stages = [];
    network.error = undefined;
    network.persist = true;
    network.dispose.mockClear();
    network.fetch.mockClear();
});
describe('connection stages', () => {
    it('reports real progress, calendar success, and disposes the test session', async () => {
        network.stages = ['server', 'certificate', 'auth'];
        const service = new CalendarService(false);
        const history: ConnectionDiagnostics[] = [];
        const result = await service.testConnection(update(), (d) => history.push(d));
        expect(result.ok).toBe(true);
        expect(result.diagnostics?.stages).toEqual({
            server: 'passed',
            certificate: 'passed',
            auth: 'passed',
            calendar: 'passed',
        });
        expect(history[0].stages.auth).toBe('pending');
        expect(history.some((d) => d.stages.auth === 'running')).toBe(true);
        expect(network.dispose).toHaveBeenCalledOnce();
    });
    it.each([
        [
            'network',
            undefined,
            [],
            { server: 'failed', certificate: 'skipped', auth: 'skipped', calendar: 'skipped' },
        ],
        [
            'certificate',
            undefined,
            [],
            { server: 'passed', certificate: 'failed', auth: 'skipped', calendar: 'skipped' },
        ],
        [
            'auth',
            401,
            [],
            { server: 'passed', certificate: 'passed', auth: 'failed', calendar: 'skipped' },
        ],
        [
            'server',
            500,
            ['server', 'certificate', 'auth'],
            { server: 'passed', certificate: 'passed', auth: 'passed', calendar: 'failed' },
        ],
    ] as const)(
        'shows the failed %s stage without claiming downstream success',
        async (kind, status, stages, expected) => {
            network.error = new OwaError(kind, 'PRIVATE_ERROR', status, 'ErrorAccessDenied');
            network.stages = [...stages];
            const service = new CalendarService(false);
            const result = await service.testConnection(update());
            expect(result.ok).toBe(false);
            expect(result.diagnostics?.stages).toEqual(expected);
            const report = supportReport(
                '1.2.0',
                'win32',
                'x64',
                false,
                {
                    phase: 'error',
                    error: 'PRIVATE_PASSWORD',
                    untrustedCert: {
                        host: 'PRIVATE_HOST',
                        fingerprint: 'PRIVATE_PIN',
                        subject: 'PRIVATE_SUBJECT',
                        issuer: 'PRIVATE_ISSUER',
                        validTo: '',
                        reason: '',
                    },
                },
                service.lastDiagnostics,
            );
            expect(JSON.stringify(report)).not.toMatch(
                /PRIVATE|password|username|serverUrl|fingerprint|eventCount|logPath/,
            );
            expect(report.connection?.errorCode).toBe('ErrorAccessDenied');
        },
    );
    it('does not pretend a demo checked a real server', async () => {
        const result = await new CalendarService(true).testConnection(update());
        expect(Object.values(result.diagnostics!.stages).every((s) => s === 'skipped')).toBe(true);
    });
});
it('leaves the old group book intact when encrypted persistence fails', () => {
    const service = new CalendarService(false);
    const { account } = service.participantGroupState();
    const group = service.saveParticipantGroup(account, {
        name: 'Team',
        emails: ['one@example.com'],
    });
    network.persist = false;
    expect(() =>
        service.saveParticipantGroup(account, { ...group, emails: ['two@example.com'] }),
    ).toThrow(/шифрование/);
    expect(() => service.deleteParticipantGroup(account, group.id)).toThrow(/шифрование/);
    expect(service.participantGroupState().groups).toEqual([group]);
    expect(() =>
        service.saveParticipantGroup('old-account', { name: 'Other', emails: ['a@example.com'] }),
    ).toThrow(/Аккаунт/);
});
it('switches privacy without changing account settings and broadcasts it', () => {
    const service = new CalendarService(false);
    const before = structuredClone(service.settings.account);
    const changed = vi.fn();
    service.on('changed', changed);
    service.setPrivacyMode(true);
    expect(service.settings.privacyMode).toBe(true);
    expect(service.settings.account).toEqual(before);
    expect(changed).toHaveBeenCalledOnce();
    expect(() => service.setPrivacyMode('true')).toThrow();
});

it.each([false, true])(
    'successful retry resumes only saved credentials (unsaved=%s)',
    async (unsaved) => {
        const service = new CalendarService(false);
        network.error = new OwaError('auth', 'Rejected', 401);
        await service.syncNow();
        expect(network.fetch).toHaveBeenCalledOnce();
        network.error = undefined;
        const candidate = {
            ...update(),
            ...(unsaved ? { password: 'synthetic-correct-password' } : {}),
        };
        expect((await service.testConnection(candidate, undefined, async () => true)).ok).toBe(
            true,
        );
        await service.syncNow();
        expect(network.fetch).toHaveBeenCalledTimes(unsaved ? 2 : 3);
        expect(service.sync.phase).toBe(unsaved ? 'error' : 'ok');
    },
);
