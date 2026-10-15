// Local attendee lists. No Exchange requests or Electron dependencies live here.
import { MAX_PEOPLE } from './availability';
import { dedupeEmails, isEmail, normalizeEmail } from './email';
import { serverKey } from './serverUrl';
import { clean } from './text';
import { type AccountSettings, type ParticipantGroup, type ParticipantGroupInput } from './types';

export const MAX_GROUP_NAME = 80;
export const MAX_GROUPS_PER_ACCOUNT = 30;
export const MAX_STORED_GROUPS = 120;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

export function participantGroupAccount(
    account: Pick<AccountSettings, 'serverUrl' | 'username' | 'useWindowsAuth'>,
): string {
    return JSON.stringify([
        serverKey(account.serverUrl),
        account.useWindowsAuth ? 'windows' : account.username.trim().toLowerCase(),
    ]);
}

export function parseParticipantGroupId(value: unknown): string {
    if (typeof value !== 'string' || !ID.test(value))
        throw new Error('Недопустимая группа участников');
    return value.toLowerCase();
}

export function parseParticipantGroup(value: unknown): ParticipantGroupInput {
    if (
        !object(value) ||
        typeof value.name !== 'string' ||
        value.name.length > MAX_GROUP_NAME * 4
    ) {
        throw new Error('Укажите название группы');
    }
    const name = clean(value.name, MAX_GROUP_NAME * 4)
        .replaceAll(/\s+/g, ' ')
        .trim();
    if (!name || name.length > MAX_GROUP_NAME)
        throw new Error(`Название группы: от 1 до ${MAX_GROUP_NAME} символов`);
    if (
        !Array.isArray(value.emails) ||
        !value.emails.length ||
        value.emails.length > MAX_PEOPLE ||
        !value.emails.every(isEmail)
    ) {
        throw new Error(`В группе должно быть от 1 до ${MAX_PEOPLE} корректных адресов почты`);
    }
    return {
        id: value.id === undefined ? undefined : parseParticipantGroupId(value.id),
        name,
        emails: dedupeEmails(value.emails.map(normalizeEmail)),
    };
}

interface StoredGroup extends ParticipantGroup {
    account: string;
}

export class ParticipantGroupBook {
    private groups: StoredGroup[] = [];

    static parse(value: unknown): ParticipantGroupBook {
        const book = new ParticipantGroupBook();
        if (!object(value) || value.version !== 1 || !Array.isArray(value.groups)) return book;
        for (const entry of value.groups.slice(0, MAX_STORED_GROUPS * 2)) {
            if (
                !object(entry) ||
                typeof entry.account !== 'string' ||
                !entry.account ||
                entry.account.length > 2048
            )
                continue;
            try {
                const id = parseParticipantGroupId(entry.id);
                if (book.groups.some((g) => g.account === entry.account && g.id === id)) continue;
                book.save(entry.account, { name: entry.name, emails: entry.emails }, () => id);
            } catch {
                /* Ignore invalid, duplicated or excessive records on disk. */
            }
        }
        return book;
    }

    list(account: string): ParticipantGroup[] {
        return this.groups
            .filter((g) => g.account === account)
            .map(({ id, name, emails }) => ({ id, name, emails: [...emails] }));
    }

    save(account: string, raw: unknown, makeId: () => string): ParticipantGroup {
        const input = parseParticipantGroup(raw);
        const own = this.groups.filter((g) => g.account === account);
        const previous = input.id ? own.find((g) => g.id === input.id) : undefined;
        if (input.id && !previous) throw new Error('Группа не найдена: выберите ее заново');
        if (
            own.some((g) => g.id !== input.id && g.name.toLowerCase() === input.name.toLowerCase())
        ) {
            throw new Error('Группа с таким названием уже существует');
        }
        if (
            !previous &&
            (own.length >= MAX_GROUPS_PER_ACCOUNT || this.groups.length >= MAX_STORED_GROUPS)
        ) {
            throw new Error('Достигнут лимит сохраненных групп: удалите ненужные');
        }
        const id = previous?.id ?? parseParticipantGroupId(makeId());
        if (!previous && own.some((g) => g.id === id))
            throw new Error('Не удалось создать группу: повторите сохранение');
        const group = { account, id, name: input.name, emails: [...input.emails] };
        this.groups = previous
            ? this.groups.map((g) => (g === previous ? group : g))
            : [...this.groups, group];
        return { id, name: group.name, emails: [...group.emails] };
    }

    remove(account: string, rawId: unknown): void {
        const id = parseParticipantGroupId(rawId);
        if (!this.groups.some((g) => g.account === account && g.id === id))
            throw new Error('Группа не найдена');
        this.groups = this.groups.filter((g) => g.account !== account || g.id !== id);
    }

    toJSON(): { version: 1; groups: StoredGroup[] } {
        return { version: 1, groups: this.groups.map((g) => ({ ...g, emails: [...g.emails] })) };
    }
}
