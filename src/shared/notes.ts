// Personal notes on meetings: kept on this computer only, never part of anything sent to a server.
// This is the pure part (limits, cleaning, ageing); the main process stores it encrypted with the
// Windows account's own key (see store.ts).
import { MAX_NOTE } from './limits';
import { clean } from './text';
import { parseIsoInstant } from './validate';

/** A note is kept this long after its meeting: a quarter, then it goes by itself. */
export const NOTE_KEEP_MS = 92 * 24 * 3_600_000;
/** More notes than this is not a notebook but a leak: new ones are refused until some are removed. */
export const MAX_NOTES = 500;
const MAX_ID = 2048;

export interface StoredNote {
  text: string;
  /** When the meeting starts (ISO): what ages the note. */
  start: string;
  /** When the note was last changed (ISO). */
  at: string;
}

export type NoteOutcome = 'saved' | 'removed';

export class NoteBook {
  private readonly notes = new Map<string, StoredNote>();

  /**
   * Reads what the file held, strictly: the file is encrypted but anything running as this user can
   * rewrite it, so every field is checked and only what is valid, recent and within the limits is kept.
   */
  static parse(raw: unknown, now: Date): NoteBook {
    const book = new NoteBook();
    const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { notes?: unknown }).notes : undefined;
    if (!Array.isArray(list)) return book;
    for (const item of list.slice(0, MAX_NOTES * 2)) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id || r.id.length > MAX_ID || typeof r.text !== 'string') continue;
      const start = parseIsoInstant(r.start);
      const at = parseIsoInstant(r.at);
      const text = clean(r.text, MAX_NOTE);
      if (start === null || at === null || !text.trim()) continue;
      if (book.notes.size >= MAX_NOTES) break;
      book.notes.set(r.id, { text, start: new Date(start).toISOString(), at: new Date(at).toISOString() });
    }
    book.prune(now);
    return book;
  }

  get size(): number {
    return this.notes.size;
  }

  get(id: string): string {
    return this.notes.get(id)?.text ?? '';
  }

  /** The meetings that have a note, for the little marker in the list. */
  ids(): string[] {
    return [...this.notes.keys()];
  }

  /**
   * Keeps `text` for the meeting, or removes the note when it is empty. The text is cleaned of hidden
   * and control characters (line breaks stay) and must fit the limit; the count is capped.
   */
  set(id: string, text: string, meetingStart: string, now: Date): NoteOutcome {
    if (!id || id.length > MAX_ID) throw new Error('Недопустимый идентификатор');
    if (typeof text !== 'string' || text.length > MAX_NOTE * 4) throw new Error('Заметка слишком длинная');
    const cleaned = clean(text.replace(/\r\n?/g, '\n'), MAX_NOTE * 2);
    if (cleaned.length > MAX_NOTE) throw new Error(`Заметка не должна быть длиннее ${MAX_NOTE} символов`);
    if (!cleaned.trim()) {
      this.notes.delete(id);
      return 'removed';
    }
    if (!this.notes.has(id) && this.notes.size >= MAX_NOTES) throw new Error(`Слишком много заметок (не больше ${MAX_NOTES}): удалите ненужные`);
    const start = parseIsoInstant(meetingStart);
    this.notes.set(id, { text: cleaned, start: new Date(start ?? now.getTime()).toISOString(), at: now.toISOString() });
    return 'saved';
  }

  /** Forgets the notes of meetings that ended more than `NOTE_KEEP_MS` ago; returns how many went. */
  prune(now: Date): number {
    let removed = 0;
    for (const [id, n] of this.notes) {
      if (now.getTime() - Date.parse(n.start) > NOTE_KEEP_MS) {
        this.notes.delete(id);
        removed++;
      }
    }
    return removed;
  }

  clear(): number {
    const n = this.notes.size;
    this.notes.clear();
    return n;
  }

  toJSON(): { version: 1; notes: Array<StoredNote & { id: string }> } {
    return { version: 1, notes: [...this.notes].map(([id, n]) => ({ id, ...n })) };
  }
}
