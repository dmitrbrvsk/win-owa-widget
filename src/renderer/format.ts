import type { Dict, Lang } from './i18n';

const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'ru-RU');

export function hm(d: Date | string, lang: Lang): string {
  return new Date(d).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function range(start: string, end: string, lang: Lang): string {
  return `${hm(start, lang)}–${hm(end, lang)}`;
}

export function dayTitle(day: Date, today: Date, t: Dict, lang: Lang): string {
  const date = day.toLocaleDateString(locale(lang), { day: 'numeric', month: 'long' });
  const diff = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return `${t.today}, ${date}`;
  if (diff === 1) return `${t.tomorrow}, ${date}`;
  if (diff === -1) return `${t.yesterday}, ${date}`;
  const weekday = day.toLocaleDateString(locale(lang), { weekday: 'long' });
  return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${date}`;
}

export function shortDay(d: Date | string, lang: Lang): string {
  return new Date(d).toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' });
}

export function duration(min: number, t: Dict): string {
  if (min < 60) return t.minShort(min);
  return t.hoursShort(Math.floor(min / 60), min % 60);
}
