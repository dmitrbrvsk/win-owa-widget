import { NoteBook } from '../shared/notes';
import { ParticipantGroupBook } from '../shared/participantGroups';
import { type CalendarEvent, type CreateMeetingInput } from '../shared/types';

import { incompleteAccountMigration, migrateAccountData } from './accountMigration';
import { log } from './log';
import { RecentPeople } from './recentPeople';
import { loadNotes, loadParticipantGroups } from './store';

/** Account-local storage is loaded only after migration has settled or failed closed. */
export class AccountData {
    notes = new NoteBook();
    groups = new ParticipantGroupBook();
    /** People and places of the meetings created in the app, for the form's suggestions. */
    readonly recent: RecentPeople;
    recovery?: 'available' | 'retry';
    private blocked = false;
    private owner = '';

    constructor(
        owner: string,
        private readonly demo: boolean,
    ) {
        this.recent = new RecentPeople(demo);
        this.load(owner);
    }

    load(owner: string): void {
        this.owner = owner;
        this.recent.setOwner(owner);
        if (this.demo) {
            this.notes = new NoteBook();
            return;
        }
        try {
            this.recovery = migrateAccountData(owner);
            this.blocked = false;
        } catch {
            this.recovery = 'retry';
            this.blocked = incompleteAccountMigration(owner);
            log.warn('account migration: original data preserved; recovery required');
        }
        this.notes = loadNotes(owner);
        this.groups = loadParticipantGroups();
    }

    /** After a meeting was created: its people and place come first among the suggestions next time. */
    rememberMeeting(m: CreateMeetingInput, events: readonly CalendarEvent[]): void {
        if (!this.blocked) this.recent.remember(m, events); // waits until the account's data is recovered
    }

    recover(): void {
        if (this.demo || !this.recovery) throw new Error('Нет сохраненных данных для переноса');
        try {
            migrateAccountData(this.owner, true);
            this.load(this.owner);
        } catch {
            this.recovery = 'retry';
            this.blocked = incompleteAccountMigration(this.owner);
            throw new Error(
                'Перенос не завершен. Исходные данные сохранены. Проверьте доступ к профилю и шифрованию или лимиты групп и заметок, затем повторите',
            );
        }
    }

    assertWritable(): void {
        if (this.blocked)
            throw new Error('Сначала завершите восстановление данных аккаунта в настройках');
    }
}
