// "Who and where you meet most": suggestions for the "Create meeting" form. Two sources, both local:
// the people and rooms of the meetings this app created (remembered in an encrypted file, see
// store.ts), and the organizers and rooms of the meetings already loaded. Nothing here asks a server.
import { emailKey, isEmail, normalizeEmail } from './email';
import { isEffectivelyCancelled } from './events';
import { clean, oneLine } from './text';
import { type CalendarEvent, type PersonSuggestion } from './types';
import { parseIsoInstant } from './validate';

/** A person or a room not used for this long is forgotten. */
export const RECENT_KEEP_MS = 180 * 24 * 3_600_000;
export const MAX_RECENT_PEOPLE = 200;
export const MAX_RECENT_PLACES = 50;
/** A place longer than this is a sentence, not a room. */
export const MAX_PLACE_LENGTH = 120;
const MAX_NAME = 200;
/** One meeting this app sent counts like three seen in the calendar: the person chose these people. */
const OWN_WEIGHT = 3;

export interface RecentPerson {
    email: string;
    name: string;
    count: number;
    /** ISO time of the last meeting created with this person. */
    last: string;
}

export interface RecentPlace {
    text: string;
    count: number;
    last: string;
}

export interface FrequentSuggestions {
    people: PersonSuggestion[];
    places: string[];
}

export interface FrequentApi {
    /** People and places for the "Create meeting" form, from this computer only (no request is made). */
    getFrequent(): Promise<FrequentSuggestions>;
    /** Forgets the people and places remembered from the meetings this app created, for this account. */
    forgetFrequent(): Promise<number>;
}

const placeKey = (s: string) => s.toLowerCase().replaceAll(/\s+/g, ' ').trim();

/**
 * A meeting's location that is worth offering as a place: a room or an address, not a call link and
 * not the boilerplate Outlook puts there for an online meeting.
 */
export function placeText(raw: string | undefined): string | null {
    if (!raw) return null;
    const s = oneLine(raw, MAX_PLACE_LENGTH + 1);
    if (s.length < 2 || s.length > MAX_PLACE_LENGTH) return null;
    if (/:\/\/|\bwww\.|@/i.test(s)) return null;
    if (/microsoft teams|собрание (?:в )?teams|zoom meeting|встреча (?:в )?zoom/i.test(s))
        return null;
    return s;
}

export class RecentBook {
    private readonly people = new Map<string, RecentPerson>();
    private readonly places = new Map<string, RecentPlace>();

    /**
     * Reads the file strictly: it is encrypted, but anything running as this user could rewrite it, so
     * only valid addresses, short clean names and places, sane counts and recent dates are kept.
     */
    static parse(raw: unknown, now: Date): RecentBook {
        const book = new RecentBook();
        const r =
            raw && typeof raw === 'object' && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : {};
        const people = Array.isArray(r.people) ? r.people.slice(0, MAX_RECENT_PEOPLE * 2) : [];
        for (const item of people) {
            const p = parsePerson(item);
            if (p && book.people.size < MAX_RECENT_PEOPLE) book.people.set(emailKey(p.email), p);
        }
        const places = Array.isArray(r.places) ? r.places.slice(0, MAX_RECENT_PLACES * 2) : [];
        for (const item of places) {
            const p = parsePlace(item);
            if (p && book.places.size < MAX_RECENT_PLACES) book.places.set(placeKey(p.text), p);
        }
        book.prune(now);
        return book;
    }

    get size(): number {
        return this.people.size + this.places.size;
    }

    /** Remembers the people and the place of a meeting the person has just created. */
    record(
        people: ReadonlyArray<{ email: string; name?: string }>,
        location: string,
        now: Date,
    ): void {
        const at = now.toISOString();
        for (const p of people) {
            if (!isEmail(p.email)) continue;
            const email = normalizeEmail(p.email);
            const key = emailKey(email);
            const known = this.people.get(key);
            const name = p.name ? oneLine(p.name, MAX_NAME) : '';
            if (known) {
                known.count = Math.min(known.count + 1, 10_000);
                known.last = at;
                if (name) known.name = name;
            } else this.people.set(key, { email, name, count: 1, last: at });
        }
        const text = placeText(location);
        if (text) {
            const key = placeKey(text);
            const known = this.places.get(key);
            if (known) {
                known.count = Math.min(known.count + 1, 10_000);
                known.last = at;
                known.text = text;
            } else this.places.set(key, { text, count: 1, last: at });
        }
        this.prune(now);
    }

    /** Forgets what has not been used for half a year, then the least used beyond the limits. */
    prune(now: Date): void {
        const cutoff = now.getTime() - RECENT_KEEP_MS;
        for (const [k, v] of this.people) if (Date.parse(v.last) < cutoff) this.people.delete(k);
        for (const [k, v] of this.places) if (Date.parse(v.last) < cutoff) this.places.delete(k);
        trim(this.people, MAX_RECENT_PEOPLE);
        trim(this.places, MAX_RECENT_PLACES);
    }

    /** Forgets everything; returns how many entries there were. */
    clear(): number {
        const n = this.size;
        this.people.clear();
        this.places.clear();
        return n;
    }

    listPeople(): RecentPerson[] {
        return [...this.people.values()].map((p) => ({ ...p }));
    }

    listPlaces(): RecentPlace[] {
        return [...this.places.values()].map((p) => ({ ...p }));
    }

    toJSON() {
        return { people: this.listPeople(), places: this.listPlaces() };
    }
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A whole positive count, capped; 0 for anything else. */
const countOf = (v: unknown): number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, 10_000) : 0;

function parsePerson(item: unknown): RecentPerson | null {
    const p = asRecord(item);
    if (!p || !isEmail(p.email)) return null;
    const last = parseIsoInstant(p.last);
    const count = countOf(p.count);
    if (last === null || !count) return null;
    const name = typeof p.name === 'string' ? oneLine(p.name, MAX_NAME) : '';
    return { email: normalizeEmail(p.email), name, count, last: new Date(last).toISOString() };
}

function parsePlace(item: unknown): RecentPlace | null {
    const p = asRecord(item);
    const text =
        p && typeof p.text === 'string' ? placeText(clean(p.text, MAX_PLACE_LENGTH + 1)) : null;
    const last = p ? parseIsoInstant(p.last) : null;
    const count = p ? countOf(p.count) : 0;
    return text && last !== null && count
        ? { text, count, last: new Date(last).toISOString() }
        : null;
}

function trim<T extends { count: number; last: string }>(map: Map<string, T>, max: number) {
    if (map.size <= max) return;
    const order = [...map.entries()].toSorted(
        (a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last),
    );
    for (const [k] of order.slice(max)) map.delete(k);
}

/**
 * The people to offer first: those this app has sent meetings to (weighted up) and the organizers of
 * the meetings in the calendar (not the person's own meetings: that would be the person).
 */
export function frequentPeople(
    recent: readonly RecentPerson[],
    events: readonly CalendarEvent[],
    max = 8,
): PersonSuggestion[] {
    const score = new Map<string, { person: PersonSuggestion; score: number; last: string }>();
    for (const p of recent)
        score.set(emailKey(p.email), {
            person: { name: p.name || p.email, email: p.email },
            score: p.count * OWN_WEIGHT,
            last: p.last,
        });
    for (const e of events) {
        if (e.isOrganizer || !e.organizerEmail || !isEmail(e.organizerEmail)) continue;
        const key = emailKey(e.organizerEmail);
        const known = score.get(key);
        if (known) {
            known.score += 1;
            if (known.person.name === known.person.email && e.organizer)
                known.person = { ...known.person, name: oneLine(e.organizer, MAX_NAME) };
            if (e.start > known.last) known.last = e.start;
        } else
            score.set(key, {
                person: {
                    name: e.organizer ? oneLine(e.organizer, MAX_NAME) : e.organizerEmail,
                    email: normalizeEmail(e.organizerEmail),
                },
                score: 1,
                last: e.start,
            });
    }
    return [...score.values()]
        .toSorted(
            (a, b) =>
                b.score - a.score ||
                b.last.localeCompare(a.last) ||
                a.person.name.localeCompare(b.person.name),
        )
        .slice(0, max)
        .map((x) => x.person);
}

/** The rooms and addresses to offer: those of meetings this app created (weighted up) and of the meetings in the calendar. */
export function frequentPlaces(
    recent: readonly RecentPlace[],
    events: readonly CalendarEvent[],
    max = 6,
): string[] {
    const score = new Map<string, { text: string; score: number; last: string }>();
    for (const p of recent)
        score.set(placeKey(p.text), { text: p.text, score: p.count * OWN_WEIGHT, last: p.last });
    for (const e of events) {
        if (e.isAllDay || isEffectivelyCancelled(e)) continue;
        const text = placeText(e.location);
        if (!text) continue;
        const key = placeKey(text);
        const known = score.get(key);
        if (known) {
            known.score += 1;
            if (e.start > known.last) known.last = e.start;
        } else score.set(key, { text, score: 1, last: e.start });
    }
    return [...score.values()]
        .toSorted(
            (a, b) =>
                b.score - a.score || b.last.localeCompare(a.last) || a.text.localeCompare(b.text),
        )
        .slice(0, max)
        .map((x) => x.text);
}

/** Two suggestion lists as one, the first list first, one entry per address. */
export function mergePeople(
    first: readonly PersonSuggestion[],
    then: readonly PersonSuggestion[],
): PersonSuggestion[] {
    const seen = new Set<string>();
    return [...first, ...then].filter((p) => {
        const key = emailKey(p.email);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
