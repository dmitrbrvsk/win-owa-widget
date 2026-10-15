import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_GROUPS_PER_ACCOUNT, ParticipantGroupBook, parseParticipantGroup, participantGroupAccount } from '../src/shared/participantGroups';
const account = participantGroupAccount({ serverUrl: 'HTTPS://MAIL.EXAMPLE.COM/owa', useWindowsAuth: false, username: ' USER ' });
const input = { name: ' Моя  команда ', emails: ['A@example.com', 'a@example.com', 'b@example.com'] };
describe('saved groups', () => {
  it('roundtrips addresses, normalizes duplicates and isolates accounts', () => {
    const book = new ParticipantGroupBook();
    const saved = book.save(account, input, randomUUID);
    expect(saved.name).toBe('Моя команда'); expect(saved.emails).toEqual(['a@example.com', 'b@example.com']);
    const restored = ParticipantGroupBook.parse(JSON.parse(JSON.stringify(book)));
    expect(restored.list(account)).toEqual([saved]);
    expect(restored.list('another-account')).toEqual([]);
    expect(() => restored.save('another-account', { ...input, id: saved.id }, randomUUID)).toThrow();
    expect(() => restored.remove('another-account', saved.id)).toThrow();
    restored.list(account)[0].emails.push('injected@example.com');
    expect(restored.list(account)[0].emails).toHaveLength(2);
    const changed = restored.save(account, { ...input, id: saved.id, name: 'Team', emails: ['c@example.com'] }, randomUUID);
    expect(restored.list(account)).toEqual([changed]);
    restored.remove(account, saved.id); expect(restored.list(account)).toEqual([]);
  });
  it('scopes normalized accounts by server and login method', () => {
    expect(participantGroupAccount({ serverUrl: 'mail.example.com', username: 'user', useWindowsAuth: false })).toBe(account);
    expect(participantGroupAccount({ serverUrl: 'other.example.com', username: 'user', useWindowsAuth: false })).not.toBe(account);
    expect(participantGroupAccount({ serverUrl: 'mail.example.com', username: 'user', useWindowsAuth: true })).not.toBe(account);
  });
  it('rejects bad addresses, oversized inputs, duplicate names and excess groups', () => {
    for (const raw of [null, { ...input, emails: [] }, { ...input, emails: ['Name <a@example.com>'] }, { ...input, emails: Array(21).fill('a@example.com') }, { ...input, name: 'a'.repeat(81) }, { ...input, id: '__proto__' }]) expect(() => parseParticipantGroup(raw)).toThrow();
    const book = new ParticipantGroupBook();
    const first = book.save(account, input, randomUUID);
    expect(() => book.save(account, { ...input, name: 'моя команда' }, randomUUID)).toThrow(/существует/);
    for (let i = 1; i < MAX_GROUPS_PER_ACCOUNT; i++) book.save(account, { ...input, name: `group${i}` }, randomUUID);
    expect(() => book.save(account, { ...input, name: 'one more' }, randomUUID)).toThrow(/лимит/);
    expect(() => book.save(account, { ...input, id: first.id, name: 'edited' }, randomUUID)).not.toThrow();
  });
  it('recovers valid records from damaged storage without accepting unknown fields', () => {
    const book = new ParticipantGroupBook(); book.save(account, input, randomUUID);
    const disk = book.toJSON();
    const restored = ParticipantGroupBook.parse({ ...disk, groups: [null, { ...disk.groups[0], emails: ['bad'] }, disk.groups[0], disk.groups[0]] });
    expect(restored.list(account)).toEqual(book.list(account));
    expect(ParticipantGroupBook.parse({ ...disk, version: 2 }).list(account)).toEqual([]);
  });
});
