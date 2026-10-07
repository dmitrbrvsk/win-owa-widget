import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Popup } from './Popup';
import { Reminder } from './Reminder';
import { Settings } from './Settings';
import { useSnapshot, useTheme } from './hooks';

function Trouble({ title, text }: { title: string; text: string }) {
  return (
    <div className="trouble" role="alert">
      <h1>{title}</h1>
      <p>{text}</p>
      <p className="sec">Подробности в файле журнала: Настройки → Диагностика. / Details are in the log file: Settings → Diagnostics.</p>
    </div>
  );
}

/** A render error shows a message instead of unmounting the whole page into a blank window. */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('render error', error);
  }
  render() {
    if (this.state.error) return <Trouble title="Окно не удалось отрисовать" text={`${this.state.error.name}: ${this.state.error.message}`} />;
    return this.props.children;
  }
}

function App() {
  const { snap, error } = useSnapshot();
  useTheme(snap);
  if (error) return <Trouble title="Нет связи с приложением" text={error} />;
  if (!snap) return null;
  const route = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (route === 'settings') return <Settings snap={snap} />;
  if (route === 'reminder') return <Reminder snap={snap} />;
  return <Popup snap={snap} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
