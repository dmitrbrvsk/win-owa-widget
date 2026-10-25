// Browser demo: system-wide combinations and frequent people (no Electron, no Exchange).
import { demoRecent } from '../main/demoRecent';
import { type FrequentApi, frequentPeople, frequentPlaces } from '../shared/frequent';
import { type HotkeyApi } from '../shared/hotkeys';
import { type CalendarEvent } from '../shared/types';

export function mockShortcutsApi(events: () => CalendarEvent[]): HotkeyApi & FrequentApi {
    let recent = demoRecent();
    return {
        pauseHotkeys: async () => {},
        getFrequent: async () => ({
            people: frequentPeople(recent.people, events()),
            places: frequentPlaces(recent.places, events()),
        }),
        forgetFrequent: async () => {
            const n = recent.people.length + recent.places.length;
            recent = { people: [], places: [] };
            return n;
        },
    };
}
