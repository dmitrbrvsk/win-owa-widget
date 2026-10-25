// Browser demo data is built only for development or the explicit browser-demo target.
import { version as appVersion } from '../../package.json';
import * as demo from '../main/demo';
import { initialDiagnostics, supportReport } from '../shared/diagnostics';
import { DEFAULT_HOTKEYS } from '../shared/hotkeys';
import { participantGroupAccount, ParticipantGroupBook } from '../shared/participantGroups';
import { privateEvent } from '../shared/privacy';
import {
    type AppSettings,
    type CalendarSelection,
    type ConnectionDiagnostics,
    type OwaApi,
    type Snapshot,
} from '../shared/types';

import { mockMcpApi } from './mcpMock';
import { mockShortcutsApi } from './shortcutsMock';

export function mockApi(): OwaApi {
    const params = new URLSearchParams(location.search);
    const settings: AppSettings = {
        account: {
            serverUrl: 'mail.example.ru',
            useWindowsAuth: true,
            username: '',
            hasPassword: false,
        },
        syncIntervalMinutes: 5,
        reminderMinutes: 1,
        workdayStartHour: 8,
        workdayEndHour: 20,
        notifyChanges: true,
        reminderStyle: 'auto',
        launchAtLogin: true,
        theme: (params.get('theme') as AppSettings['theme']) ?? 'system',
        language: (params.get('lang') as AppSettings['language']) ?? 'ru',
        popupSize: 'regular',
        welcomeDone: true,
        privacyMode: false,
        hotkeys: { ...DEFAULT_HOTKEYS },
        showFreeTime: params.get('free') !== 'off',
    };
    let snap: Snapshot = {
        events: demo.demoEvents(),
        sync: { phase: 'ok', lastSuccess: new Date().toISOString() },
        settings,
        demo: true,
        version: appVersion,
        taskbarLight: false,
        logPath: String.raw`C:\Users\you\AppData\Roaming\OWA Widget\logs\owa-widget.log`,
        noteIds: [],
        participantGroups: { account: participantGroupAccount(settings.account), groups: [] },
        // `?hotkey=busy` rehearses a combination another program holds.
        hotkeyProblems: params.get('hotkey') === 'busy' ? ['create'] : [],
    };
    let calendarSelection: CalendarSelection | null = null;
    const calendarListeners = new Set<(value: CalendarSelection) => void>();
    const groups = new ParticipantGroupBook();
    let diagnostic: ConnectionDiagnostics | undefined;
    const progress = new Set<(d: ConnectionDiagnostics) => void>();
    const view = (): Snapshot => ({
        ...snap,
        events: snap.settings.privacyMode
            ? snap.events.map((e) => privateEvent(e, snap.settings.language === 'en' ? 'en' : 'ru'))
            : snap.events,
        noteIds: snap.settings.privacyMode ? [] : snap.noteIds,
        participantGroups: {
            account: participantGroupAccount(snap.settings.account),
            groups: snap.settings.privacyMode
                ? []
                : groups.list(participantGroupAccount(snap.settings.account)),
        },
    });
    const notes = new Map<string, string>();
    if (params.get('error') === 'network')
        snap.sync = {
            phase: 'error',
            error: 'Сервер недоступен — возможно, выключен VPN',
            errorKind: 'network',
            lastSuccess: new Date(Date.now() - 42 * 60_000).toISOString(),
        };
    const listeners = new Set<(s: Snapshot) => void>();
    const emit = () => {
        for (const l of listeners) l(view());
    };
    window.addEventListener('hashchange', emit);
    return {
        ...mockMcpApi(),
        ...mockShortcutsApi(() => snap.events),
        recoverAccountData: async () => {},
        getSnapshot: async () => view(),
        setPrivacyMode: async (enabled) => {
            snap = { ...snap, settings: { ...snap.settings, privacyMode: enabled } };
            emit();
        },
        saveParticipantGroup: async (account, input) => {
            const group = groups.save(account, input, () => crypto.randomUUID());
            emit();
            return group;
        },
        deleteParticipantGroup: async (account, id) => {
            groups.remove(account, id);
            emit();
        },
        onConnectionProgress: (cb) => {
            progress.add(cb);
            return () => {
                progress.delete(cb);
            };
        },
        getSupportReport: async () =>
            supportReport(snap.version, 'browser', 'browser', true, snap.sync, diagnostic),
        checkForUpdates: async () => ({
            status: params.get('update') === 'available' ? 'available' : 'current',
            currentVersion: snap.version,
            latestVersion: params.get('update') === 'available' ? '1.3.0' : snap.version,
        }),
        openUpdatePage: async () => {},
        onSnapshot: (cb) => {
            listeners.add(cb);
            return () => {
                listeners.delete(cb);
            };
        },
        syncNow: async () => {
            snap = { ...snap, sync: { phase: 'ok', lastSuccess: new Date().toISOString() } };
            emit();
        },
        getDetails: async (id) => demo.demoDetails(snap.events.find((e) => e.id === id)!),
        respond: async (id, action) => {
            snap = {
                ...snap,
                events: snap.events.map((e) =>
                    e.id === id
                        ? {
                              ...e,
                              responseType:
                                  action === 'accept'
                                      ? 'accepted'
                                      : action === 'tentative'
                                        ? 'tentative'
                                        : 'declined',
                          }
                        : e,
                ),
            };
            emit();
        },
        // `?error=reply` and `?cancel=reply` rehearse the other outcomes of an answer with words.
        replyToMeeting: async (input) => {
            if (params.get('cancel') === 'reply') return { status: 'cancelled' };
            if (params.get('error') === 'reply') throw new Error('Exchange: ErrorAccessDenied');
            snap = {
                ...snap,
                events: snap.events.map((e) =>
                    e.id === input.eventId
                        ? {
                              ...e,
                              responseType:
                                  input.action === 'accept'
                                      ? 'accepted'
                                      : input.action === 'tentative'
                                        ? 'tentative'
                                        : 'declined',
                          }
                        : e,
                ),
            };
            emit();
            return { status: 'replied', invited: 1 };
        },
        getNote: async (id) => notes.get(id) ?? '',
        setNote: async (id, text) => {
            if (text.trim()) notes.set(id, text);
            else notes.delete(id);
            snap = { ...snap, noteIds: [...notes.keys()] };
            emit();
        },
        clearNotes: async () => {
            const n = notes.size;
            notes.clear();
            snap = { ...snap, noteIds: [] };
            emit();
            return n;
        },
        openUrl: async (url) => {
            void window.open(url, '_blank');
        },
        copyText: async (text) => navigator.clipboard?.writeText(text),
        // The native menu exists only in the app; the browser mock has none.
        meetingMenu: async () => {},
        saveSettings: async (u) => {
            snap = { ...snap, settings: u.settings };
            emit();
            return { passwordRemoved: false };
        },
        testConnection: async () => {
            diagnostic = initialDiagnostics();
            for (const stage of Object.keys(diagnostic.stages) as Array<
                keyof ConnectionDiagnostics['stages']
            >)
                diagnostic.stages[stage] = 'skipped';
            for (const cb of progress) cb(diagnostic);
            return {
                ok: true,
                message: 'Демо-режим: подключение не проверялось',
                diagnostics: diagnostic,
            };
        },
        trustCertificate: async () => {},
        forgetCertificate: async () => {},
        clearCache: async () => {},
        openLog: async () => {},
        openSettings: async () => {
            void (location.hash = '#/settings');
        },
        openEditMeeting: async () => {
            void (location.hash = '#/create');
        },
        editMeeting: async (input) => ({
            status: 'updated',
            invited: input.requiredAttendees.length + input.optionalAttendees.length,
        }),
        cancelMeeting: async () => ({ status: 'cancelledMeeting', invited: 2 }),
        openWelcome: async () => {
            void (location.hash = '#/welcome');
        },
        finishWelcome: async (openSettings) => {
            void (location.hash = openSettings ? '#/settings' : '#/popup');
        },
        openAvailability: async () => {
            void (location.hash = '#/availability');
        },
        openCalendar: async (selection) => {
            calendarSelection = selection ?? null;
            if (selection) for (const cb of calendarListeners) cb(selection);
            location.hash = '#/calendar';
        },
        getCalendarSelection: async () => calendarSelection,
        onCalendarSelection: (cb) => {
            calendarListeners.add(cb);
            return () => {
                calendarListeners.delete(cb);
            };
        },
        getAvailability: async (r) => demo.demoAvailability(r),
        openStats: async () => {
            void (location.hash = '#/stats');
        },
        getStatsEvents: async (r) => demo.demoStatsEvents(r),
        closeWindow: async () => {},
        quit: async () => {},
        onReminder: () => () => {},
        getReminder: async () => ({
            events: snap.events
                .filter((e) => e.title.startsWith('Дизайн') || e.title.startsWith('Синк'))
                .slice(0, params.get('many') ? 2 : 1),
        }),
        snoozeReminder: async () => {},
        onPopupShown: () => () => {},
        onOpenEvent: () => () => {},
        resizePopup: () => {},
        openCreateMeeting: async () => {},
        // `?prefill=1` opens the form as if the availability grid had picked a slot; `?error=create` and `?cancel=1` rehearse the other outcomes.
        getCreatePrefill: async () => {
            if (!params.get('prefill')) return null;
            const start = new Date();
            start.setDate(start.getDate() + 1);
            start.setHours(14, 0, 0, 0);
            return {
                start: start.toISOString(),
                end: new Date(start.getTime() + 45 * 60_000).toISOString(),
                attendees: ['i.ivanov@example.com', 'm.sokolova@example.com'],
                title: 'Синк по релизу',
            };
        },
        onCreatePrefill: () => () => {},
        resolvePeople: async (q) => {
            await new Promise<void>((r) => {
                setTimeout(r, 150);
            });
            return demo.demoPeople(q);
        },
        createMeeting: async (input) => {
            await new Promise<void>((r) => {
                setTimeout(r, 700);
            });
            if (params.get('error') === 'create')
                throw new Error('Exchange не принял адреса получателей. Проверьте их');
            if (params.get('cancel')) return { status: 'cancelled' };
            const invited = input.requiredAttendees.length + input.optionalAttendees.length;
            return { status: 'created', invited };
        },
    };
}
