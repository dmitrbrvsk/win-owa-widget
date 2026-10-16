import { type FullSnapshotMessage, type SnapshotMessage } from './snapshotTypes';

/** The renderer restores a full snapshot without copying unchanged events. */
export class SnapshotReceiver {
    private sequence = 0;
    current?: FullSnapshotMessage;

    accept(message: SnapshotMessage): FullSnapshotMessage | undefined {
        if (message.sequence <= this.sequence) return undefined;
        this.sequence = message.sequence;
        if (message.events) {
            this.current = { ...message, events: message.events };
        } else if (this.current?.eventsRevision === message.eventsRevision) {
            this.current = { ...message, events: this.current.events };
        } else {
            // A missed initial/full update must never attach another account's calendar to a delta.
            this.current = undefined;
        }
        return this.current;
    }
}
