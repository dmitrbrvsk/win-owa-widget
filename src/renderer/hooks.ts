import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, MeetingPlatform, Snapshot } from '../shared/types';
import { urlHost } from '../shared/meetingUrl';
import { api } from './api';
import { dict, resolveLang, type Dict, type Lang } from '../shared/i18n';

/** The first snapshot, or the reason it never came: a page must never stay silently blank. */
/** Electron prefixes errors from the main process with "Error invoking remote method '…': Error: "; the person needs only the rest. */
export function ipcMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/, '');
}

export function useSnapshot(): { snap: Snapshot | null; error: string | null } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (attempt: number) =>
      api
        .getSnapshot()
        .then((s) => alive && setSnap(s))
        .catch((e) => {
          if (!alive) return;
          if (attempt < 3) setTimeout(() => load(attempt + 1), 400 * (attempt + 1));
          else setError(e instanceof Error ? e.message : String(e));
        });
    void load(0);
    const off = api.onSnapshot((s) => {
      setSnap(s);
      setError(null);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { snap, error };
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

/**
 * What a Join button adds after "Join": nothing for a link to a known service (Teams, Zoom, Webex,
 * Google Meet, KTalk), and the real host for a link to any other site, so the person sees where it goes.
 */
export function joinHost(platform: MeetingPlatform, link: string | undefined): string {
  return platform === 'generic' ? urlHost(link) ?? '' : '';
}
