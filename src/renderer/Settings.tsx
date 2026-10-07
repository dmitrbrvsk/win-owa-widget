import { useState } from 'react';
import type { AppSettings, CertInfo, ConnectionTestResult, Snapshot } from '../shared/types';
import { api } from './api';
import { ipcMessage, useI18n } from './hooks';
import { checkServerUrl } from '../shared/serverUrl';

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Settings({ snap }: { snap: Snapshot }) {
  const { t } = useI18n(snap);
  const [s, setS] = useState<AppSettings>(snap.settings);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverSaved, setServerSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [passwordDropped, setPasswordDropped] = useState(false);
  const [cacheMsg, setCacheMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const acc = s.account;
  // The pin lives in the main process; show the live value, not the form's copy.
  const pinned = snap.settings.account;
  const setAcc = (patch: Partial<AppSettings['account']>) => setS({ ...s, account: { ...acc, ...patch } });
  const update = () => ({ settings: s, password: clearPassword ? '' : password ? password : undefined });
  const server = checkServerUrl(acc.serverUrl);
  const serverChanged = acc.serverUrl.trim() !== snap.settings.account.serverUrl;

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.testConnection(update()));
    } finally {
      setTesting(false);
    }
  }

  async function trust(cert: CertInfo) {
    await api.trustCertificate(cert.fingerprint);
    setTest(null);
  }

  async function resetCache() {
    setCacheMsg(null);
    try {
      await api.clearCache();
      setCacheMsg({ ok: true, text: t.cacheCleared });
      setTimeout(() => setCacheMsg(null), 4000);
    } catch (e) {
      setCacheMsg({ ok: false, text: ipcMessage(e) });
    }
  }

  async function save(what: 'all' | 'server' = 'all') {
    setSaveError(null);
    setPasswordDropped(false);
    try {
      const result = await api.saveSettings(update());
      setPasswordDropped(result.passwordRemoved);
    } catch (e) {
      setSaveError(ipcMessage(e));
      return;
    }
    setPassword('');
    setClearPassword(false);
    if (what === 'server') {
      setServerSaved(true);
      setTimeout(() => setServerSaved(false), 3000);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="settings">
      <h1>{t.settingsTitle}</h1>

      <h2>{t.server}</h2>
      <div className="card">
        <div className="setting-row">
          <div className="label">
            <div>{t.serverUrl}</div>
            <div className="hint">{t.serverHint}</div>
          </div>
          <input
            className={`field${acc.serverUrl && !server.ok ? ' bad' : ''}`}
            value={acc.serverUrl}
            placeholder="mail.company.ru"
            spellCheck={false}
            autoFocus={!snap.settings.account.serverUrl}
            onChange={(e) => setAcc({ serverUrl: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && server.ok && void save('server')}
          />
        </div>
        <div className="setting-row">
          <div className="label">
            {server.ok ? (
              <div className="msg ok" role="status">
                {t.serverWillUse(server.url)}
              </div>
            ) : acc.serverUrl ? (
              <div className="msg bad" role="alert">
                {t.serverProblem[server.problem]}
              </div>
            ) : (
              <div className="hint">{t.serverProblem.empty}</div>
            )}
            {serverSaved && (
              <div className="msg ok" role="status">
                {t.serverSaved}
              </div>
            )}
            {saveError && (
              <div className="msg bad" role="alert">
                {saveError}
              </div>
            )}
            {passwordDropped && (
              <div className="msg bad" role="status">
                {t.passwordDropped}
              </div>
            )}
          </div>
          <button className="btn primary" disabled={!server.ok || !serverChanged} onClick={() => void save('server')}>
            {t.saveServer}
          </button>
        </div>
      </div>

      <h2>{t.account}</h2>
      <div className="card">
        <div className="setting-row">
          <div className="label">
            <div>{t.username}</div>
            <div className="hint">{t.usernameHint}</div>
            <div className="hint">{t.credentialsHint}</div>
          </div>
          <input className="field" value={acc.username} spellCheck={false} autoComplete="username" onChange={(e) => setAcc({ username: e.target.value })} />
        </div>
        <div className="setting-row">
          <div className="label">
            <div>{t.password}</div>
            {acc.hasPassword && !clearPassword && <div className="hint">{t.passwordStored}</div>}
          </div>
          <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
            <input
              className="field"
              type="password"
              value={password}
              autoComplete="current-password"
              placeholder={acc.hasPassword && !clearPassword ? '••••••••' : ''}
              onChange={(e) => (setPassword(e.target.value), setClearPassword(false))}
            />
            {acc.hasPassword && !clearPassword && (
              <button className="btn compact" onClick={() => (setClearPassword(true), setPassword(''))}>
                {t.passwordClear}
              </button>
            )}
          </div>
        </div>
        {pinned.trustedCertFingerprint && (
          <div className="setting-row">
            <div className="label">
              <div>{t.certificate}</div>
              <div className="hint nowrap" style={{ maxWidth: 360 }} title={pinned.trustedCertFingerprint}>
                {t.trustedCert} ({pinned.trustedCertHost}): {pinned.trustedCertFingerprint}
              </div>
            </div>
            <button className="btn compact" onClick={() => void api.forgetCertificate()}>
              {t.forgetCert}
            </button>
          </div>
        )}
        <div className="setting-row">
          <div className="label">
            {test && (
              <div className={`msg ${test.ok ? 'ok' : 'bad'}`} role="status">
                {test.message}
              </div>
            )}
            {!test && <div className="hint">{t.privacyNote}</div>}
          </div>
          <button className="btn" disabled={testing || !server.ok} onClick={() => void runTest()}>
            {testing ? t.testing : t.testConnection}
          </button>
        </div>
        {test?.untrustedCert && (
          <div className="setting-row">
            <div className="label">
              <div className="hint">
                {t.certIssuer}: {test.untrustedCert.issuer}
                <br />
                {t.certFor}: {test.untrustedCert.subject}
                <br />
                {t.certValidTo}: {new Date(test.untrustedCert.validTo).toLocaleDateString()}
                <br />
                <span className="nowrap" title={test.untrustedCert.fingerprint}>
                  {test.untrustedCert.fingerprint}
                </span>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {t.certHint}
              </div>
            </div>
            <button className="btn" onClick={() => void trust(test.untrustedCert!)}>
              {t.trustCert}
            </button>
          </div>
        )}
      </div>

      <h2>{t.behaviour}</h2>
      <div className="card">
        <div className="setting-row">
          <div className="label">{t.reminderLead}</div>
          <select className="field" value={s.reminderMinutes} onChange={(e) => setS({ ...s, reminderMinutes: Number(e.target.value) })}>
            <option value={-1}>{t.reminderOff}</option>
            <option value={0}>{t.reminderAtStart}</option>
            {[1, 2, 5, 10].map((m) => (
              <option key={m} value={m}>
                {t.reminderBefore(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div className="label">
            <div>{t.reminderStyle}</div>
            <div className="hint">{t.reminderStyleHint}</div>
          </div>
          <select className="field" value={s.reminderStyle} onChange={(e) => setS({ ...s, reminderStyle: e.target.value as AppSettings['reminderStyle'] })}>
            <option value="auto">{t.reminderStyleAuto}</option>
            <option value="system">{t.reminderStyleSystem}</option>
            <option value="window">{t.reminderStyleWindow}</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="label">{t.syncEvery}</div>
          <select className="field" value={s.syncIntervalMinutes} onChange={(e) => setS({ ...s, syncIntervalMinutes: Number(e.target.value) })}>
            {[2, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {t.everyMin(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div className="label">
            <div>{t.workday}</div>
            <div className="hint">{t.workdayHint}</div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="hint">{t.workdayFrom}</span>
            <select
              className="field"
              style={{ width: 92 }}
              value={s.workdayStartHour}
              onChange={(e) => {
                const start = Number(e.target.value);
                setS({ ...s, workdayStartHour: start, workdayEndHour: Math.max(s.workdayEndHour, start + 1) });
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
            <span className="hint">{t.workdayTo}</span>
            <select
              className="field"
              style={{ width: 92 }}
              value={s.workdayEndHour}
              onChange={(e) => {
                const end = Number(e.target.value);
                setS({ ...s, workdayEndHour: end, workdayStartHour: Math.min(s.workdayStartHour, end - 1) });
              }}
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {String(h % 24).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="setting-row">
          <div className="label">{t.joinHotkey}</div>
          <Switch checked={s.joinHotkeyEnabled} onChange={(v) => setS({ ...s, joinHotkeyEnabled: v })} label={t.joinHotkey} />
        </div>
        <div className="setting-row">
          <div className="label">
            <div>{t.notifyChanges}</div>
            <div className="hint">{t.notifyChangesHint}</div>
          </div>
          <Switch checked={s.notifyChanges} onChange={(v) => setS({ ...s, notifyChanges: v })} label={t.notifyChanges} />
        </div>
        <div className="setting-row">
          <div className="label">{t.launchAtLogin}</div>
          <Switch checked={s.launchAtLogin} onChange={(v) => setS({ ...s, launchAtLogin: v })} label={t.launchAtLogin} />
        </div>
      </div>

      <h2>{t.appearance}</h2>
      <div className="card">
        <div className="setting-row">
          <div className="label">{t.theme}</div>
          <select className="field" value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value as AppSettings['theme'] })}>
            <option value="system">{t.themeSystem}</option>
            <option value="light">{t.themeLight}</option>
            <option value="dark">{t.themeDark}</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="label">{t.language}</div>
          <select className="field" value={s.language} onChange={(e) => setS({ ...s, language: e.target.value as AppSettings['language'] })}>
            <option value="system">{t.languageSystem}</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="label">{t.popupSize}</div>
          <select className="field" value={s.popupSize} onChange={(e) => setS({ ...s, popupSize: e.target.value as AppSettings['popupSize'] })}>
            <option value="compact">{t.sizeCompact}</option>
            <option value="regular">{t.sizeRegular}</option>
            <option value="large">{t.sizeLarge}</option>
          </select>
        </div>
      </div>

      <h2>{t.diagnostics}</h2>
      <div className="card">
        <div className="setting-row">
          <div className="label">
            <div className="hint">{t.logHint}</div>
            <div className="hint nowrap" style={{ maxWidth: 420 }} title={snap.logPath}>
              {snap.logPath}
            </div>
          </div>
          <button className="btn compact" onClick={() => void api.openLog()}>
            {t.openLog}
          </button>
        </div>
        <div className="setting-row">
          <div className="label">
            <div className="hint">{t.clearCacheHint}</div>
            {cacheMsg && (
              <div className={`msg ${cacheMsg.ok ? 'ok' : 'bad'}`} role="status">
                {cacheMsg.text}
              </div>
            )}
          </div>
          <button className="btn compact" onClick={() => void resetCache()}>
            {t.clearCache}
          </button>
        </div>
      </div>

      <div className="settings-foot">
        <button className="btn primary" onClick={() => void save()}>
          {t.save}
        </button>
        <button className="btn" onClick={() => void api.closeWindow()}>
          {t.close}
        </button>
        <button className="btn" style={{ marginLeft: 'auto' }} title={t.quitHint} onClick={() => void api.quit()}>
          {t.quitApp}
        </button>
        {saved && (
          <span className="msg ok" role="status">
            {t.saved}
          </span>
        )}
      </div>
    </div>
  );
}
