import { type HotkeyAction } from './hotkeys';
import {
    type AppSettings,
    type CalendarEvent,
    type ParticipantGroupState,
    type SyncState,
} from './types';

export interface Snapshot {
    events: CalendarEvent[];
    sync: SyncState;
    settings: AppSettings;
    demo: boolean;
    version: string;
    /** Where the diagnostic log lives, for the settings page. */
    logPath: string;
    /** Windows taskbar uses the light theme (dark tray glyph needed). */
    taskbarLight: boolean;
    /** The meetings the person has written a note on (the notes themselves are asked for one at a time). */
    noteIds: string[];
    /** Legacy notes without an account owner are preserved and never opened automatically. */
    hasUnassignedNotes?: boolean;
    accountRecovery?: 'available' | 'retry';
    participantGroups: ParticipantGroupState;
    /** Combinations Windows refused (another program holds them), so the settings can say so. */
    hotkeyProblems?: HotkeyAction[];
}

/** Internal IPC update: unchanged calendars stay in the renderer instead of crossing IPC again. */
export type SnapshotState = Omit<Snapshot, 'events'>;
export type SnapshotMessage = SnapshotState & {
    sequence: number;
    eventsRevision: number;
    events?: CalendarEvent[];
};
export type FullSnapshotMessage = SnapshotMessage & { events: CalendarEvent[] };
