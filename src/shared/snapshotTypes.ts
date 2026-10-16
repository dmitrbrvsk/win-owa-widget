import { type CalendarEvent, type Snapshot } from './types';

/** Internal IPC update: unchanged calendars stay in the renderer instead of crossing IPC again. */
export type SnapshotState = Omit<Snapshot, 'events'>;
export type SnapshotMessage = SnapshotState & {
    sequence: number;
    eventsRevision: number;
    events?: CalendarEvent[];
};
export type FullSnapshotMessage = SnapshotMessage & { events: CalendarEvent[] };
