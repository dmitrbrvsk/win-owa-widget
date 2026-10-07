// The short tour on the first run. Four steps, each answering one question a person has when a new
// icon appears in their tray; "Пропустить" is on every one of them, and the window remembers it was
// seen either way, so it never opens by itself twice.
import { useEffect, useState } from 'react';
import type { Snapshot } from '../shared/types';
import { api } from './api';
import { useI18n } from './hooks';
import { Icon } from './icons';
import type { Dict } from '../shared/i18n';

interface Step {
  icon: string;
  title: string;
  body: string;
  points: string[];
}

function steps(t: Dict): Step[] {
  return [
    { icon: 'calendar', title: t.welcome1Title, body: t.welcome1Body, points: [t.welcome1A, t.welcome1B, t.welcome1C] },
    { icon: 'person', title: t.welcome2Title, body: t.welcome2Body, points: [t.welcome2A, t.welcome2B, t.welcome2C] },
    { icon: 'clock', title: t.welcome3Title, body: t.welcome3Body, points: [t.welcome3A, t.welcome3B, t.welcome3C] },
    { icon: 'bell', title: t.welcome4Title, body: t.welcome4Body, points: [t.welcome4A, t.welcome4B, t.welcome4C] },
  ];
}

export function Welcome({ snap }: { snap: Snapshot }) {
  const { t } = useI18n(snap);
  const all = steps(t);
  const [at, setAt] = useState(0);
  const last = at === all.length - 1;
  const step = all[at];
  // The settings are what comes next only while there is nothing to connect to yet.
  const needsSetup = !snap.settings.account.serverUrl || !snap.settings.welcomeDone;

  const finish = (openSettings: boolean) => void api.finishWelcome(openSettings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !last) setAt((n) => n + 1);
      else if (e.key === 'ArrowLeft' && at > 0) setAt((n) => n - 1);
      else if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, last]);

  return (
    <div className="welcome">
      <div className="wc-top">
        <button className="icon-btn" aria-label={t.close} title={t.close} onClick={() => finish(false)}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="wc-body">
        <div className="wc-icon" aria-hidden="true">
          <Icon name={step.icon} size={30} />
        </div>
        <h1>{step.title}</h1>
        <p className="wc-lead">{step.body}</p>
        <ul className="wc-points">
          {step.points.map((p) => (
            <li key={p}>
              <span className="wc-tick" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="wc-foot">
        <button className="btn compact" onClick={() => finish(false)}>
          {t.welcomeSkip}
        </button>
        <div className="wc-dots" role="group" aria-label={t.welcomeStep(at + 1, all.length)}>
          {all.map((s, i) => (
            <button
              key={s.title}
              className={`wc-dot${i === at ? ' on' : ''}`}
              aria-label={t.welcomeStep(i + 1, all.length)}
              aria-current={i === at}
              onClick={() => setAt(i)}
            />
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {at > 0 && (
            <button className="btn compact" onClick={() => setAt(at - 1)}>
              {t.welcomeBack}
            </button>
          )}
          {last ? (
            <button className="btn primary" onClick={() => finish(needsSetup)}>
              {needsSetup ? t.welcomeToSettings : t.welcomeDone}
            </button>
          ) : (
            <button className="btn primary" onClick={() => setAt(at + 1)}>
              {t.welcomeNext}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
