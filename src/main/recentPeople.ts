// The people and places of the meetings this app created, for one account at a time. Read from disk
// only when the form first asks for them, so starting the app costs nothing.
import { isEmail, normalizeEmail } from '../shared/email';
import {
    frequentPeople,
    frequentPlaces,
    type FrequentSuggestions,
    RecentBook,
} from '../shared/frequent';
import {
    type CalendarEvent,
    type CreateMeetingInput,
    type PersonSuggestion,
} from '../shared/types';

import { demoRecent } from './demoRecent';
import { log } from './log';
import { loadRecent, removeRecent, saveRecent } from './store';

const MAX_NAMES = 500;

export class RecentPeople {
    private book = new RecentBook();
    private owner = '';
    private loadedFor?: string;
    /**
     * Names the directory gave for addresses in this run (bounded): a meeting is created from bare
     * addresses, and this is how a remembered recipient keeps the name the person picked it by.
     */
    private readonly names = new Map<string, string>();

    constructor(private readonly demo: boolean) {}

    /** Another account: nothing of the previous one stays in memory. */
    setOwner(owner: string): void {
        this.owner = owner;
        this.loadedFor = undefined;
        this.book = new RecentBook();
        this.names.clear();
    }

    /** Directory answers pass through here so their names can be remembered with the address. */
    keepNames(people: PersonSuggestion[]): PersonSuggestion[] {
        for (const p of people) {
            if (!p.name || !isEmail(p.email)) continue;
            if (this.names.size >= MAX_NAMES) this.names.clear();
            this.names.set(normalizeEmail(p.email), p.name);
        }
        return people;
    }

    remember(m: CreateMeetingInput, events: readonly CalendarEvent[]): void {
        const organizer = (email: string) =>
            events.find(
                (e) =>
                    e.organizer && e.organizerEmail && normalizeEmail(e.organizerEmail) === email,
            )?.organizer;
        const people = [...m.requiredAttendees, ...m.optionalAttendees].map((raw) => {
            const email = normalizeEmail(raw);
            return { email, name: this.names.get(email) ?? organizer(email) };
        });
        const book = this.current();
        book.record(people, m.location, new Date());
        if (!this.demo && !saveRecent(book, this.owner))
            log.warn(
                'recent: not saved (no OS encryption or unreadable file); kept in memory only',
            );
    }

    frequent(events: readonly CalendarEvent[]): FrequentSuggestions {
        const book = this.current();
        return {
            people: frequentPeople(book.listPeople(), events),
            places: frequentPlaces(book.listPlaces(), events),
        };
    }

    /** Forgets this account's remembered people and places; returns how many there were. */
    forget(): number {
        const n = this.current().clear();
        if (!this.demo) removeRecent(this.owner);
        return n;
    }

    private current(): RecentBook {
        if (this.loadedFor !== this.owner) {
            this.book = this.demo
                ? RecentBook.parse(demoRecent(), new Date())
                : loadRecent(this.owner);
            this.loadedFor = this.owner;
        }
        return this.book;
    }
}
