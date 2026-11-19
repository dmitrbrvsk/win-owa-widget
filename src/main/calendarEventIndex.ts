import { randomUUID } from 'node:crypto';

import { type EventChange } from '../shared/changes';
import { type CalendarEvent } from '../shared/types';

import { profileLabel, type SavedAccount } from './accountProfiles';
import { type CalendarService } from './calendarService';

interface Projection {
    calendar: CalendarService;
    revision: number;
    source: CalendarEvent[];
    label: string;
    color: string;
    ids: Map<string, string>;
    events: CalendarEvent[];
}

/** Local IDs outlive ordinary refreshes, and have meaning only for their live profile and revision. */
export class CalendarEventIndex {
    private readonly projections = new Map<string, Projection>();
    private readonly targets = new Map<string, { calendar: CalendarService; id: string }>();
    events: CalendarEvent[] = [];

    target(id: string) {
        const target = this.targets.get(id);
        if (!target) throw new Error('Встреча не найдена — обновите календарь');
        return target;
    }

    noteIds() {
        return [...this.projections.values()].flatMap(({ calendar, ids }) =>
            calendar.noteIds().flatMap((rawId) => {
                const id = ids.get(rawId);
                return id ? [id] : [];
            }),
        );
    }

    projectChanges(accountId: string, changes: EventChange[]) {
        const projection = this.projections.get(accountId);
        if (!projection) return [];
        return changes.flatMap((change) => {
            const id = projection.ids.get(change.event.id);
            return id
                ? [
                      {
                          ...change,
                          event: {
                              ...change.event,
                              id,
                              accountId,
                              accountColor: projection.color,
                              accountLabel: projection.label,
                          },
                      },
                  ]
                : [];
        });
    }

    update(calendars: ReadonlyMap<string, CalendarService>, profiles: readonly SavedAccount[]) {
        let changed = false;
        for (const id of this.projections.keys()) {
            if (!calendars.has(id)) {
                this.projections.delete(id);
                changed = true;
            }
        }
        for (const profile of profiles) {
            const calendar = calendars.get(profile.id);
            if (!calendar) continue;
            const old = this.projections.get(profile.id);
            const label = profileLabel(profile);
            const { color } = profile;
            const same = old?.calendar === calendar && old.revision === calendar.accountRevision;
            if (
                same &&
                old.source === calendar.events &&
                old.label === label &&
                old.color === color
            )
                continue;
            const ids = new Map<string, string>();
            const events = calendar.events.map((event) => {
                const id = (same ? old.ids.get(event.id) : undefined) ?? randomUUID();
                ids.set(event.id, id);
                return {
                    ...event,
                    id,
                    accountId: profile.id,
                    accountColor: color,
                    accountLabel: label,
                };
            });
            this.projections.set(profile.id, {
                calendar,
                revision: calendar.accountRevision,
                source: calendar.events,
                label,
                color,
                ids,
                events,
            });
            changed = true;
        }
        if (!changed) return;
        this.targets.clear();
        for (const { ids, calendar } of this.projections.values()) {
            for (const [id, local] of ids) this.targets.set(local, { id, calendar });
        }
        this.events = [...this.projections.values()]
            .flatMap((entry) => entry.events)
            .toSorted((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    }
}
