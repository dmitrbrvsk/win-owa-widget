import { Component, lazy, type ReactNode, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { RENDERER_READY_MESSAGE } from '../shared/types';

import { preloadError } from './api';
import { useSnapshot, useTheme } from './hooks';

import './styles.css';

const Popup = lazy(() => import('./Popup').then((m) => ({ default: m.Popup })));
const Calendar = lazy(() => import('./Calendar').then((m) => ({ default: m.Calendar })));
const Settings = lazy(() => import('./Settings').then((m) => ({ default: m.Settings })));
const Welcome = lazy(() => import('./Welcome').then((m) => ({ default: m.Welcome })));
const Reminder = lazy(() => import('./Reminder').then((m) => ({ default: m.Reminder })));
const Create = lazy(() => import('./Create').then((m) => ({ default: m.Create })));
const Availability = lazy(() =>
    import('./Availability').then((m) => ({ default: m.Availability })),
);
const Stats = lazy(() => import('./Stats').then((m) => ({ default: m.Stats })));
const PrivateCalendar = lazy(() =>
    import('./PrivateCalendar').then((m) => ({ default: m.PrivateCalendar })),
);

function Loading() {
    return (
        <div className='trouble' role='status'>
            Загрузка… / Loading…
        </div>
    );
}

function Trouble({ title, text }: { title: string; text: string }) {
    return (
        <div className='trouble' role='alert'>
            <h1>{title}</h1>
            <p>{text}</p>
            <p className='sec'>
                Подробности в файле журнала: Настройки → Диагностика. / Details are in the log file:
                Settings → Diagnostics.
            </p>
        </div>
    );
}

/** A render error shows a message instead of unmounting the whole page into a blank window. */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
    state: { error?: Error } = {};
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- React invokes this lifecycle instance method; diagnostics do not need to mutate boundary state.
    componentDidCatch(error: Error) {
        // eslint-disable-next-line no-console -- The error boundary keeps renderer failures visible in developer diagnostics after showing the fallback UI.
        console.error('render error', error);
    }
    render() {
        if (this.state.error)
            return (
                <Trouble
                    title='Окно не удалось отрисовать'
                    text={`${this.state.error.name}: ${this.state.error.message}`}
                />
            );
        return this.props.children;
    }
}

function MountedRoute({ children }: { children: ReactNode }) {
    useEffect(() => {
        // Suspense commits this subtree only after the actual route chunk and its styles loaded.
        // Packaged startup checks must not pass while the loading fallback is still on screen.
        // eslint-disable-next-line no-console -- The main process consumes this constant readiness marker to verify renderer startup without exposing an additional IPC channel.
        if (document.styleSheets.length > 0) console.info(RENDERER_READY_MESSAGE);
    }, []);
    return children;
}

function ConnectedApp() {
    const { snap, error } = useSnapshot();
    useTheme(snap);
    if (error) return <Trouble title='Нет связи с приложением' text={error} />;
    if (!snap) return <Loading />;
    const route = snap.settings.privacyMode
        ? 'private'
        : location.hash.replace(/^#\/?/, '').split('?', 1)[0];
    const routes = {
        calendar: Calendar,
        settings: Settings,
        welcome: Welcome,
        reminder: Reminder,
        create: Create,
        availability: Availability,
        stats: Stats,
        private: PrivateCalendar,
    };
    const Route = routes[route as keyof typeof routes] ?? Popup;
    return (
        <Suspense fallback={<Loading />}>
            <MountedRoute key={route}>
                <Route
                    key={
                        route === 'calendar' || route === 'availability'
                            ? snap.participantGroups.account
                            : undefined
                    }
                    snap={snap}
                />
            </MountedRoute>
        </Suspense>
    );
}

function App() {
    return preloadError ? (
        <Trouble title='Нет связи с приложением' text={preloadError} />
    ) : (
        <ConnectedApp />
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Boundary>
            <App />
        </Boundary>
    </StrictMode>,
);
