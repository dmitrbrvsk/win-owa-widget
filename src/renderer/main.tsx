import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Popup } from './Popup';
import { Reminder } from './Reminder';
import { Settings } from './Settings';
import { useSnapshot, useTheme } from './hooks';

function App() {
  const snap = useSnapshot();
  useTheme(snap);
  if (!snap) return null;
  const route = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (route === 'settings') return <Settings snap={snap} />;
  if (route === 'reminder') return <Reminder snap={snap} />;
  return <Popup snap={snap} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
