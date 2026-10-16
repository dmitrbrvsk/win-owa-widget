import {
    type FullSnapshotMessage,
    type SnapshotMessage,
    type SnapshotState,
} from './snapshotTypes';
import { type AppSettings, type CalendarEvent } from './types';

interface SnapshotSource {
    state: SnapshotState;
    events: CalendarEvent[];
    /** Includes account generation, privacy and the language used by the privacy projection. */
    scope: string;
    project: () => CalendarEvent[];
}

/** Account generation and visible projection settings must invalidate the wire baseline together. */
export function snapshotScope(revision: number, settings: AppSettings, language: string): string {
    return JSON.stringify([revision, settings.account, settings.privacyMode, language]);
}

/** Only a changed calendar or visibility scope needs to cross IPC again. */
export class SnapshotPublisher {
    private sourceEvents?: CalendarEvent[];
    private scope?: string;
    private projected: CalendarEvent[] = [];
    private eventsRevision = 0;
    private sequence = 0;

    capture(source: SnapshotSource, full: true): FullSnapshotMessage;
    capture(source: SnapshotSource, full?: false): SnapshotMessage;
    capture(source: SnapshotSource, full = false): SnapshotMessage {
        const changed = source.events !== this.sourceEvents || source.scope !== this.scope;
        if (changed) {
            this.projected = source.project();
            this.sourceEvents = source.events;
            this.scope = source.scope;
            this.eventsRevision += 1;
        }
        this.sequence += 1;
        return {
            ...source.state,
            sequence: this.sequence,
            eventsRevision: this.eventsRevision,
            ...(full || changed ? { events: this.projected } : {}),
        };
    }
}
