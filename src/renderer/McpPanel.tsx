import { useCallback, useEffect, useRef, useState } from 'react';

import { type McpAccess, type McpUiState } from '../shared/mcp';
import { type Snapshot } from '../shared/types';

import { api } from './api';
import { useI18n } from './hooks';

const TEXT = {
    ru: {
        enable: 'Разрешить доступ через Local MCP',
        titles: 'Разрешить названия встреч (необязательно)',
        scope: 'Только чтение времени и занятости из уже загруженных встреч. Данные неполные: пустой список не означает, что время свободно. Нет изменения календаря, участников, описаний, ссылок и личных заметок.',
        consent:
            'По умолчанию выключено. Изменения применяются сразу, без кнопки «Сохранить». Включение доступа и разрешение названий требуют системного подтверждения Windows. Выключение сразу прекращает доступ.',
        privacy: 'Режим приватности скрывает названия, даже если доступ к ним разрешен.',
        provider:
            'AI-клиент может передать прочитанные данные своему провайдеру. Используйте подключение только в соответствии с политикой вашей компании.',
        prerequisite:
            'Для запуска локального MCP-помощника AI-клиенту нужен Node.js 24.22 или новее в ветке 24.x. Добавьте эту конфигурацию в клиент с поддержкой MCP; OWA Widget должен оставаться запущенным.',
        loading: 'Проверяем состояние Local MCP…',
        applying: 'Применяем разрешения…',
        running: 'Local MCP работает',
        disabled: 'Доступ выключен',
        unavailable: 'Local MCP недоступен. Обновите состояние или выключите доступ.',
        demo: 'Демо: передаются только вымышленные данные.',
        browserDemo: 'Local MCP недоступен в браузерном демо.',
        refresh: 'Обновить состояние',
        configuration: 'Конфигурация подключения',
        copy: 'Скопировать конфигурацию',
        copied: 'Конфигурация скопирована',
        loadError: 'Не удалось проверить состояние Local MCP. Повторите попытку.',
        updateError:
            'Не удалось изменить разрешения Local MCP. Обновите состояние и повторите попытку.',
        copyError: 'Не удалось скопировать конфигурацию. Повторите попытку.',
    },
    en: {
        enable: 'Allow access through Local MCP',
        titles: 'Allow meeting titles (optional)',
        scope: 'Read-only access to time and availability from already loaded meetings. Results are incomplete: an empty list does not mean a time is free. No calendar changes, attendees, descriptions, links, or personal notes.',
        consent:
            'Off by default. Changes apply immediately, without the Save button. Enabling access or allowing titles requires a native Windows confirmation. Turning access off stops it immediately.',
        privacy: 'Privacy mode hides titles even when access to them is allowed.',
        provider:
            'The AI client may send the data it reads to its provider. Use this connection only in accordance with your company policy.',
        prerequisite:
            'The AI client needs Node.js 24.22 or later within 24.x to start the local MCP helper. Add this configuration to an MCP-compatible client; OWA Widget must remain running.',
        loading: 'Checking Local MCP…',
        applying: 'Applying access settings…',
        running: 'Local MCP is running',
        disabled: 'Access is off',
        unavailable: 'Local MCP is unavailable. Refresh its status or turn access off.',
        demo: 'Demo: only fictional data is shared.',
        browserDemo: 'Local MCP is unavailable in the browser demo.',
        refresh: 'Refresh status',
        configuration: 'Connection configuration',
        copy: 'Copy configuration',
        copied: 'Configuration copied',
        loadError: 'Could not check Local MCP status. Try again.',
        updateError: 'Could not change Local MCP access. Refresh its status and try again.',
        copyError: 'Could not copy the configuration. Try again.',
    },
} as const;

type PanelError = 'loadError' | 'updateError' | 'copyError';
type PanelText = (typeof TEXT)[keyof typeof TEXT];

function panelStatus(state: McpUiState | null, loading: boolean, busy: boolean, text: PanelText) {
    if (loading) return text.loading;
    if (busy) return text.applying;
    if (browserDemo(state)) return text.browserDemo;
    if (!state || state.error === 'unavailable') return text.unavailable;
    if (state.demo) return `${state.running ? text.running : text.disabled}. ${text.demo}`;
    return state.running ? text.running : text.disabled;
}

function browserDemo(state: McpUiState | null) {
    return !!state?.demo && state.error === 'unavailable' && !state.running;
}

function controlsLocked(state: McpUiState | null, loading: boolean, busy: boolean) {
    return loading || busy || !state || browserDemo(state);
}

export function McpPanel({ snap }: { snap: Snapshot }) {
    const { lang } = useI18n(snap);
    const text = TEXT[lang];
    const [state, setState] = useState<McpUiState | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<PanelError | null>(null);
    const [copied, setCopied] = useState(false);
    const mounted = useRef(false);
    const changing = useRef(false);
    const revision = useRef(0);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            revision.current += 1;
        };
    }, []);

    const refresh = useCallback(() => {
        if (!mounted.current || changing.current) return Promise.resolve();
        revision.current += 1;
        const { current } = revision;
        return api
            .getMcpState()
            .then((next) => {
                if (!mounted.current || revision.current !== current) return;
                setState(next);
                setError(null);
                setCopied(false);
            })
            .catch(() => {
                if (!mounted.current || revision.current !== current) return;
                setState(null);
                setError('loadError');
            })
            .finally(() => {
                if (mounted.current && revision.current === current) setLoading(false);
            });
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh, snap.settings.privacyMode, snap.sync.phase, snap.sync.lastSuccess]);

    async function changeAccess(access: McpAccess) {
        if (!state || browserDemo(state) || changing.current) return;
        changing.current = true;
        revision.current += 1;
        const { current } = revision;
        setBusy(true);
        setError(null);
        setCopied(false);
        if (!access.enabled) setState({ ...state, access, running: false, configuration: '' });
        try {
            const next = await api.setMcpAccess(access);
            if (mounted.current && revision.current === current) setState(next);
        } catch {
            if (mounted.current && revision.current === current) {
                setState(null);
                setError('updateError');
            }
        } finally {
            changing.current = false;
            if (mounted.current && revision.current === current) setBusy(false);
        }
    }

    async function copyConfiguration() {
        if (!state?.running || !state.access.enabled || !state.configuration || busy) return;
        const { current } = revision;
        setError(null);
        setCopied(false);
        try {
            await api.copyText(state.configuration);
            if (mounted.current && revision.current === current) setCopied(true);
        } catch {
            if (mounted.current && revision.current === current) setError('copyError');
        }
    }

    const enabled = state?.access.enabled ?? false;
    const unavailable = !state || state.error === 'unavailable';
    const status = panelStatus(state, loading, busy, text);
    const controlsDisabled = controlsLocked(state, loading, busy);
    const configuration = state?.running && enabled ? state.configuration : '';

    return (
        <section aria-label='Local MCP'>
            <h2>Local MCP</h2>
            <div className='card' aria-busy={loading || busy}>
                <div className='setting-row'>
                    <div className='label'>
                        <div>{text.enable}</div>
                        <div className='hint'>{text.scope}</div>
                    </div>
                    <button
                        type='button'
                        role='switch'
                        aria-checked={enabled}
                        aria-label={text.enable}
                        className='switch'
                        disabled={controlsDisabled}
                        onClick={() => {
                            void changeAccess({ enabled: !enabled, allowTitles: false });
                        }}
                    />
                </div>
                <div className='setting-row'>
                    <label>
                        <input
                            type='checkbox'
                            checked={state?.access.allowTitles ?? false}
                            disabled={controlsDisabled || !enabled}
                            onChange={(event) => {
                                void changeAccess({
                                    enabled: true,
                                    allowTitles: event.target.checked,
                                });
                            }}
                        />{' '}
                        {text.titles}
                    </label>
                </div>
                <div className='setting-row'>
                    <div className='hint'>{text.privacy}</div>
                </div>
                <div className='setting-row'>
                    <div className='hint'>{text.consent}</div>
                </div>
                <div className='setting-row'>
                    <div className='hint'>{text.provider}</div>
                </div>
                <div className='setting-row'>
                    <div
                        className={`msg ${unavailable && !loading && !state?.demo ? 'bad' : ''}`}
                        role='status'
                    >
                        {status}
                    </div>
                    <button
                        type='button'
                        className='btn compact'
                        disabled={loading || busy}
                        onClick={() => {
                            setLoading(true);
                            void refresh();
                        }}
                    >
                        {text.refresh}
                    </button>
                </div>
                {error && (
                    <div className='setting-row msg bad' role='alert'>
                        {text[error]}
                    </div>
                )}
                {configuration && (
                    <div className='support-preview'>
                        <div className='hint'>{text.prerequisite}</div>
                        <h3>{text.configuration}</h3>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {configuration}
                        </pre>
                        <button
                            type='button'
                            className='btn compact'
                            disabled={busy}
                            onClick={() => {
                                void copyConfiguration();
                            }}
                        >
                            {text.copy}
                        </button>
                        {copied && (
                            <div className='hint' role='status'>
                                {text.copied}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
