import { Fragment, useLayoutEffect, useRef, useState } from 'react';

import { type Dict } from '../shared/i18n';
import {
    type CertInfo,
    type ConnectionDiagnostics as Progress,
    type ConnectionTestResult,
} from '../shared/types';

import { api } from './api';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { ipcMessage } from './hooks';

export function SettingsConnectionTest({
    t,
    hint,
    disabled,
    testConnection,
}: {
    t: Dict;
    hint: string;
    disabled: boolean;
    testConnection: () => Promise<ConnectionTestResult>;
}) {
    const [test, setTest] = useState<ConnectionTestResult | null>(null);
    const [testing, setTesting] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);

    useLayoutEffect(() => api.onConnectionProgress(setProgress), []);

    async function runTest() {
        setTesting(true);
        setTest(null);
        setProgress(null);
        try {
            const result = await testConnection();
            setTest(result);
            setProgress(result.diagnostics ?? null);
        } catch (e) {
            setTest({ ok: false, message: ipcMessage(e) });
        } finally {
            setTesting(false);
        }
    }

    async function trust(cert: CertInfo) {
        try {
            await api.trustCertificate(cert.fingerprint);
            setTest(null);
        } catch (error) {
            setTest({ ok: false, message: ipcMessage(error), untrustedCert: cert });
        }
    }

    return (
        <Fragment>
            <div className='setting-row'>
                <div className='label'>
                    {test && (
                        <div className={`msg ${test.ok ? 'ok' : 'bad'}`} role='status'>
                            {test.message}
                        </div>
                    )}
                    {!test && <div className='hint'>{hint}</div>}
                </div>
                <button
                    type='button'
                    className='btn'
                    disabled={testing || disabled}
                    onClick={() => {
                        void runTest();
                    }}
                >
                    {testing ? t.testing : t.testConnection}
                </button>
            </div>
            {progress && <ConnectionDiagnostics progress={progress} t={t} />}
            {test?.untrustedCert && (
                <div className='setting-row'>
                    <div className='label'>
                        <div className='hint'>
                            {t.certIssuer}: {test.untrustedCert.issuer}
                            <br />
                            {t.certFor}: {test.untrustedCert.subject}
                            <br />
                            {t.certValidTo}:{' '}
                            {new Date(test.untrustedCert.validTo).toLocaleDateString()}
                            <br />
                            <span className='nowrap' title={test.untrustedCert.fingerprint}>
                                {test.untrustedCert.fingerprint}
                            </span>
                        </div>
                        <div className='hint' style={{ marginTop: 6 }}>
                            {t.certHint}
                        </div>
                    </div>
                    <button
                        type='button'
                        className='btn'
                        onClick={() => {
                            void trust(test.untrustedCert!);
                        }}
                    >
                        {t.trustCert}
                    </button>
                </div>
            )}
        </Fragment>
    );
}

export function SettingsSupportReport({ t }: { t: Dict }) {
    const [report, setReport] = useState('');
    const [reportMessage, setReportMessage] = useState('');
    const active = useRef(false);

    useLayoutEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);

    async function copyReport() {
        setReportMessage('');
        try {
            const text = JSON.stringify(await api.getSupportReport(), null, 2);
            if (!active.current) return;
            setReport(text);
            await api.copyText(text);
            setReportMessage(t.supportCopied);
        } catch (e) {
            setReportMessage(ipcMessage(e));
        }
    }

    return (
        <Fragment>
            <div className='setting-row'>
                <div className='label'>
                    <div className='hint'>{t.supportHint}</div>
                    {reportMessage && (
                        <div role='status' className='hint'>
                            {reportMessage}
                        </div>
                    )}
                </div>
                <button
                    type='button'
                    className='btn compact'
                    onClick={() => {
                        void copyReport();
                    }}
                >
                    {t.supportCopy}
                </button>
            </div>
            {report && (
                <details className='support-preview'>
                    <summary>{t.supportPreview}</summary>
                    <pre>{report}</pre>
                </details>
            )}
        </Fragment>
    );
}
