import { useState } from 'react';
import type { UpdateCheckResult } from '../shared/types';
import type { Dict } from '../shared/i18n';
import { api } from './api';
import { ipcMessage } from './hooks';
export function UpdateCheck({ version, t }: { version: string; t: Dict }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState('');
  async function check() {
    if (busy) return;
    setBusy(true); setError(''); setResult(null);
    try { setResult(await api.checkForUpdates()); } catch (e) { setError(ipcMessage(e)); } finally { setBusy(false); }
  }
  return <><h2>{t.updatesTitle}</h2><div className="card"><div className="setting-row"><div className="label"><div>{t.updatesVersion(version)}</div><div className="hint">{t.updatesHint}</div></div><button className="btn compact" disabled={busy} onClick={() => void check()}>{busy ? t.updatesChecking : t.updatesCheck}</button></div>
    {result && <div className="setting-row"><div className="msg ok" role="status">{result.status === 'available' ? t.updatesAvailable(result.latestVersion) : t.updatesCurrent(result.currentVersion)}</div>{result.status === 'available' && <button className="btn primary compact" onClick={() => { void api.openUpdatePage().catch(e => setError(ipcMessage(e))); }}>{t.updatesDownload}</button>}</div>}
    {error && <div className="setting-row msg bad" role="alert">{error}</div>}
  </div></>;
}
