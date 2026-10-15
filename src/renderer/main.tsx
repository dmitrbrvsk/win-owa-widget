import { Component, type ReactNode, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { RENDERER_READY_MESSAGE } from '../shared/types';

import { Availability } from './Availability';
import { Calendar } from './Calendar';
import { Create } from './Create';
import { useSnapshot, useTheme } from './hooks';
import { Popup } from './Popup';
import { PrivateCalendar } from './PrivateCalendar';
import { Reminder } from './Reminder';
import { Settings } from './Settings';
import { Stats } from './Stats';
import { Welcome } from './Welcome';

import './styles.css';

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

function App() {
    const { snap, error } = useSnapshot();
    useTheme(snap);
    const ready = !!snap && !error;
    useEffect(() => {
        // Packaged startup checks verify JS, CSS and the preload bridge, not just a living process.
        // eslint-disable-next-line no-console -- The main process consumes this constant readiness marker to verify renderer startup without exposing an additional IPC channel.
        if (ready && document.styleSheets.length > 0) console.info(RENDERER_READY_MESSAGE);
    }, [ready]);
    if (error) return <Trouble title='Нет связи с приложением' text={error} />;
    if (!snap) return null;
    if (snap.settings.privacyMode) return <PrivateCalendar snap={snap} />;
    const route = location.hash.replace(/^#\/?/, '').split('?', 1)[0];
    if (route === 'calendar') return <Calendar key={snap.participantGroups.account} snap={snap} />;
    if (route === 'settings') return <Settings snap={snap} />;
    if (route === 'welcome') return <Welcome snap={snap} />;
    if (route === 'reminder') return <Reminder snap={snap} />;
    if (route === 'create') return <Create snap={snap} />;
    if (route === 'availability')
        return <Availability key={snap.participantGroups.account} snap={snap} />;
    if (route === 'stats') return <Stats snap={snap} />;
    return <Popup snap={snap} />;
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Boundary>
            <App />
        </Boundary>
    </StrictMode>,
);
