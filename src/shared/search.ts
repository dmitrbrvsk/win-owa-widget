// Search over the meetings that are already loaded. Purely local: the query never leaves the page,
// is never logged, and is never turned into a regular expression (plain substring checks only, so
// "(((" or ".*" are just characters and nothing a person types can stall the window).
import type { CalendarEvent } from './types';
import { isEffectivelyCancelled } from './events';

/** Longest query that is looked at; the rest is ignored. */
export const MAX_QUERY_LENGTH = 100;
/** Words of the query that count; the rest are ignored. */
export const MAX_QUERY_WORDS = 6;
export const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Longest piece of one field that is looked at (the loader keeps fields far shorter). */
const MAX_FIELD = 1000;

/** Lower case, `ё` as `е`: "Планёрка" is found by "планерка" and the other way round. */
export function fold(s: string): string {
  return s.normalize('NFC').toLowerCase().replaceAll('ё', 'е');
}

/** The words of a query: cut to {@link MAX_QUERY_LENGTH}, folded, split on whitespace, without repeats, at most {@link MAX_QUERY_WORDS}. */
export function queryWords(query: string): string[] {
  if (typeof query !== 'string') return [];
  const words = fold(query.slice(0, MAX_QUERY_LENGTH)).split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_QUERY_WORDS);
}

interface Folded {
  title: string;
  organizer: string;
  place: string;
  preview: string;
}

/** Folding a few hundred meetings on every keystroke is wasted work: a meeting object lives until the next sync replaces it. */
const folded = new WeakMap<CalendarEvent, Folded>();

function foldedFields(e: CalendarEvent): Folded {
  let f = folded.get(e);
  if (!f) {
    const cut = (s: string | undefined) => fold((s ?? '').slice(0, MAX_FIELD));
    f = {
      title: cut(e.title),
      organizer: cut(e.organizer),
      // Location and categories carry the same kind of information ("Байкал", "Красная категория").
      place: cut([e.location ?? '', ...(Array.isArray(e.categories) ? e.categories.slice(0, 20) : [])].join(' ')),
      preview: cut(e.bodyPreview),
    };
    folded.set(e, f);
  }
  return f;
}

// How much a word is worth by where it was found: the title first, then who and where, the preview last.
const W_TITLE = 4;
const W_ORGANIZER = 3;
const W_PLACE = 2;
const W_PREVIEW = 1;

/** Sum over the words of the best place each was found in, or 0 when some word is found nowhere (every word must match). */
function score(f: Folded, words: string[]): number {
  let total = 0;
  for (const w of words) {
    const s = f.title.includes(w) ? W_TITLE : f.organizer.includes(w) ? W_ORGANIZER : f.place.includes(w) ? W_PLACE : f.preview.includes(w) ? W_PREVIEW : 0;
    if (!s) return 0;
    total += s;
  }
  return total;
}

/**
 * Meetings that match every word of the query, best first.
 *
 * Matching: case-insensitive, `ё` = `е`, a word matches anywhere inside the title, the organizer,
 * the location, the categories or the body preview (several words may be found in different
 * fields). Attendees are not loaded with the list, so they cannot be searched.
 *
 * Order: where the words were found (title above organizer above location/category above the
 * preview), then live meetings before cancelled ones (these are kept, so that "was it cancelled?"
 * has an answer), then upcoming and running meetings (soonest first) before past ones (latest first).
 */
export function searchEvents(events: readonly CalendarEvent[], query: string, now: Date, limit = DEFAULT_LIMIT): CalendarEvent[] {
  const words = queryWords(query);
  const max = Number.isFinite(limit) ? Math.min(MAX_LIMIT, Math.max(0, Math.floor(limit))) : DEFAULT_LIMIT;
  if (!words.length || !max) return [];
  const nowMs = now.getTime();

  const hits: Array<{ event: CalendarEvent; score: number; cancelled: boolean; upcoming: boolean; start: number }> = [];
  for (const event of events) {
    const s = score(foldedFields(event), words);
    if (!s) continue;
    hits.push({
      event,
      score: s,
      cancelled: isEffectivelyCancelled(event),
      upcoming: Date.parse(event.end) > nowMs,
      start: Date.parse(event.start) || 0,
    });
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.cancelled !== b.cancelled) return a.cancelled ? 1 : -1;
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.upcoming ? a.start - b.start : b.start - a.start;
  });
  return hits.slice(0, max).map((h) => h.event);
}
