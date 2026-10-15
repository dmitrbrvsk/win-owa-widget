import { expect, it } from 'vitest';
import { diagnosticCode, initialDiagnostics, supportReport } from '../src/shared/diagnostics';
it('allows known technical codes and discards arbitrary server-supplied strings', () => {
  expect(diagnosticCode('net::ERR_NAME_NOT_RESOLVED')).toBe('ERR_NAME_NOT_RESOLVED');
  expect(diagnosticCode('ErrorAccessDenied')).toBe('ErrorAccessDenied');
  for (const code of ['ErrorPasswordSecret', 'ErrorAccessDenied extra@example.com', 'https://secret.example.com', 'sha256/private']) expect(diagnosticCode(code)).toBeUndefined();
  const d = { ...initialDiagnostics(), httpStatus: 12345, errorCode: 'ErrorPasswordSecret' };
  const report = supportReport('1.2.0', 'win32', 'x64', false, { phase: 'error', error: 'secret error', errorKind: 'network' }, d);
  expect(report.connection?.httpStatus).toBeUndefined(); expect(report.connection?.errorCode).toBeUndefined();
  expect(JSON.stringify(report)).not.toContain('secret');
  expect(report.sync.errorKind).toBe('network');
});
