import {
    type ConnectionDiagnostics,
    type DiagnosticStage,
    type SupportReport,
    type SyncState,
} from './types';

export const DIAGNOSTIC_STAGES: DiagnosticStage[] = ['server', 'certificate', 'auth', 'calendar'];
const SAFE_CODES = new Set([
    'ErrorAccessDenied',
    'ErrorInvalidClientAccessToken',
    'ErrorInvalidIdMalformed',
    'ErrorItemNotFound',
    'ErrorNonExistentMailbox',
    'ErrorServerBusy',
    'ErrorInternalServerError',
    'ErrorInvalidRequest',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_TIMED_OUT',
    'ERR_TIMED_OUT',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NETWORK_CHANGED',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_EMPTY_RESPONSE',
    'ERR_HTTP2_PROTOCOL_ERROR',
]);
export function diagnosticCode(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const code = value.replace(/^net::/, '');
    return SAFE_CODES.has(code) ? code : undefined;
}
const KINDS = ['auth', 'network', 'certificate', 'server', 'other'] as const;
const date = (v: unknown): string | undefined =>
    typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
        ? new Date(v).toISOString()
        : undefined;
export function initialDiagnostics(now = new Date()): ConnectionDiagnostics {
    return {
        checkedAt: now.toISOString(),
        stages: { server: 'running', certificate: 'pending', auth: 'pending', calendar: 'pending' },
    };
}
/** No error messages, server names, paths, certificate subjects or account fields are copied. */
// eslint-disable-next-line @typescript-eslint/max-params -- Explicit scalar inputs keep the report projection independent of settings and credentials.
export function supportReport(
    version: string,
    platform: string,
    arch: string,
    demo: boolean,
    sync: SyncState,
    connection?: ConnectionDiagnostics,
): SupportReport {
    const kind = (v: unknown) => KINDS.find((k) => k === v);
    const safeConnection: ConnectionDiagnostics | undefined = connection
        ? {
              checkedAt: date(connection.checkedAt) ?? new Date().toISOString(),
              stages: Object.fromEntries(
                  DIAGNOSTIC_STAGES.map((k) => [
                      k,
                      ['pending', 'running', 'passed', 'failed', 'skipped'].includes(
                          connection.stages[k],
                      )
                          ? connection.stages[k]
                          : 'pending',
                  ]),
              ) as ConnectionDiagnostics['stages'],
              errorKind: kind(connection.errorKind),
              httpStatus:
                  Number.isInteger(connection.httpStatus) &&
                  connection.httpStatus! >= 100 &&
                  connection.httpStatus! <= 599
                      ? connection.httpStatus
                      : undefined,
              errorCode: diagnosticCode(connection.errorCode),
          }
        : undefined;
    return {
        format: 1,
        version: /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) ? version : 'unknown',
        platform: ['win32', 'darwin', 'linux', 'browser'].includes(platform) ? platform : 'unknown',
        arch: ['x64', 'arm64', 'ia32', 'browser'].includes(arch) ? arch : 'unknown',
        generatedAt: new Date().toISOString(),
        demo,
        connection: safeConnection,
        sync: {
            phase: sync.phase,
            lastSuccess: date(sync.lastSuccess),
            errorKind: kind(sync.errorKind),
        },
    };
}
