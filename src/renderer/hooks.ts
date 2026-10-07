import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, MeetingPlatform, Snapshot } from '../shared/types';
import { api } from './api';
import { dict, resolveLang, type Dict, type Lang } from './i18n';

export function useSnapshot(): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getSnapshot().then((s) => alive && setSnap(s));
    const off = api.onSnapshot((s) => setSnap(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return snap;
}

/** Re-renders on a timer so countdowns, "now" lines and the tray icon stay current. */
export function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    const onVisible = () => setNow(new Date());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}

export function useI18n(snap: Snapshot | null): { t: Dict; lang: Lang } {
  const lang = resolveLang(snap?.settings.language ?? 'system');
  return useMemo(() => ({ t: dict(lang), lang }), [lang]);
}

/** Sets data-theme from the settings; "system" follows the OS preference. */
export function useTheme(snap: Snapshot | null) {
  const pref = snap?.settings.theme ?? 'system';
  useEffect(() => {
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

export const PLATFORM_COLOR: Record<MeetingPlatform, string> = {
  teams: 'var(--teams)',
  zoom: 'var(--zoom)',
  webex: 'var(--webex)',
  googleMeet: 'var(--meet)',
  ktalk: 'var(--ktalk)',
  generic: 'var(--generic)',
};

export const eventColor = (e: CalendarEvent) => PLATFORM_COLOR[e.platform];

export const PLATFORM_NAME: Record<MeetingPlatform, string> = {
  teams: 'Teams',
  zoom: 'Zoom',
  webex: 'Webex',
  googleMeet: 'Google Meet',
  ktalk: 'KTalk',
  generic: '',
};
