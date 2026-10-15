import type { ConnectionDiagnostics as Progress } from '../shared/types';
import { DIAGNOSTIC_STAGES } from '../shared/diagnostics';
import type { Dict } from '../shared/i18n';
import { Icon } from './icons';
export function ConnectionDiagnostics({ progress, t }: { progress: Progress; t: Dict }) {
  const labels = { server: t.diagnosticServer, certificate: t.diagnosticCertificate, auth: t.diagnosticAuth, calendar: t.diagnosticCalendar };
  const statuses = { pending: t.diagnosticPending, running: t.diagnosticRunning, passed: t.diagnosticPassed, failed: t.diagnosticFailed, skipped: t.diagnosticSkipped };
  return <ol className="connection-steps" aria-live="polite">{DIAGNOSTIC_STAGES.map((stage, i) => {
    const status = progress.stages[stage];
    return <li className={`connection-step ${status}`} key={stage}><span className="step-number">{status === 'passed' ? <Icon name="check" /> : status === 'failed' ? <Icon name="x" /> : i + 1}</span><span>{labels[stage]}</span><small>{statuses[status]}</small></li>;
  })}</ol>;
}
