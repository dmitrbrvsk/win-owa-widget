// Account changes and authorization failures must isolate every calendar request.
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/main/store.defaults';
import { NoteBook } from '../src/shared/notes';
import { ParticipantGroupBook } from '../src/shared/participantGroups';
import { OwaError } from '../src/main/owa/errors';
import type { CalendarEvent } from '../src/shared/types';
const wire = vi.hoisted(() => ({
  jobs: [] as Array<{ resolve: (events: CalendarEvent[]) => void; reject: (error: unknown) => void }>,
  clearFails: false, settingsFail: false, notesFail: false,
  clients: [] as string[], details: vi.fn(), respond: vi.fn(), availability: vi.fn(), cache: vi.fn(),
}));
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() }, describeError: () => 'redacted' }));
vi.mock('../src/main/store', () => ({ loadSettings: () => structuredClone(DEFAULT_SETTINGS), loadNotes: () => new NoteBook(), loadParticipantGroups: () => new ParticipantGroupBook(), loadEventCache: () => [], loadPassword: () => undefined, saveSettings: () => { if (wire.settingsFail) throw new Error('Disk full'); }, saveParticipantGroups: () => true, saveNotes: () => { if (wire.notesFail) throw new Error('Notes unavailable'); return true; }, saveEventCache: (...args: unknown[]) => wire.cache(...args), clearEventCache: () => { if (wire.clearFails) throw new Error('Access denied'); }, savePassword: () => true }));
vi.mock('../src/main/owa/http', () => ({ OwaError }));
vi.mock('../src/main/owa/client', () => ({ OwaClient: class {
  constructor(opts: { username?: string }) { wire.clients.push(opts.username ?? 'SSO'); }
  fetchCalendarView() { return new Promise<CalendarEvent[]>((resolve, reject) => wire.jobs.push({ resolve, reject })); }
  fetchDetails() { return wire.details(); }
  respond() { return wire.respond(); }
  getAvailability() { return wire.availability(); }
  dispose() {}
} }));
import { CalendarService } from '../src/main/calendarService';
const event: CalendarEvent = { id: 'old-account-meeting', changeKey: 'ck', title: 'Old account private meeting', start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), isAllDay: false, isCancelled: false, isOrganizer: false, responseType: 'accepted', isRecurring: false, categories: [], platform: 'generic' };
beforeEach(() => { wire.jobs.length = 0; wire.clients.length = 0; wire.clearFails = false; wire.settingsFail = false; wire.notesFail = false; vi.clearAllMocks(); for (const call of [wire.details, wire.respond, wire.availability]) call.mockRejectedValue(new OwaError('auth', 'Rejected')); });
it('clears meetings and ignores an old sync after switching accounts', async () => {
  const service = new CalendarService(false);
  service.events = [event];
  const oldSync = service.syncNow();
  await service.applySettings({ settings: { ...service.settings, account: { ...service.settings.account, username: 'new-account' } } });
  expect(service.settings.account.username).toBe('new-account');
  expect(service.events).toEqual([]);
  expect(wire.clients).toEqual(['SSO', 'new-account']);
  expect(wire.jobs).toHaveLength(2);
  const laterOldMeeting = { ...event, id: 'late-old-account-reply' };
  wire.jobs[0].resolve([laterOldMeeting]); await oldSync;
  expect(service.events).toEqual([]);
  expect(wire.cache.mock.calls.some(([events]) => events?.some((e: CalendarEvent) => e.id === laterOldMeeting.id))).toBe(false);
  const newMeeting = { ...event, id: 'new-account-meeting' };
  wire.jobs[1].resolve([newMeeting]); await service.syncNow();
  expect(service.events).toEqual([newMeeting]);
});
it('does not latch the replacement account after an old authentication error', async () => {
  const service = new CalendarService(false); const oldSync = service.syncNow();
  await service.applySettings({ settings: { ...service.settings, account: { ...service.settings.account, username: 'new-account' } } });
  wire.jobs[0].reject(new OwaError('auth', 'Old credentials failed')); await oldSync;
  expect(wire.jobs).toHaveLength(2);
  wire.jobs[1].resolve([]); await service.syncNow();
  expect(service.sync.phase).toBe('ok');
});
it('blocks details, replies and availability after a wrong password', async () => {
  const service = new CalendarService(false); service.events = [event];
  const sync = service.syncNow(); wire.jobs[0].reject(new OwaError('auth', 'Rejected')); await sync;
  await service.syncNow(); expect(wire.jobs).toHaveLength(1); // Latch works for refresh.
  for (let i = 0; i < 2; i++) {
    await expect(service.details(event.id)).rejects.toThrow(/Вход в Exchange/);
    await expect(service.respond(event.id, 'accept')).rejects.toThrow(/Вход в Exchange/);
    await expect(service.availability({ emails: ['test@example.com'], start: event.start, end: event.end })).rejects.toThrow(/Вход в Exchange/);
  }
  expect(wire.details).not.toHaveBeenCalled(); expect(wire.respond).not.toHaveBeenCalled(); expect(wire.availability).not.toHaveBeenCalled();
});

it.each(['details', 'respond', 'availability'] as const)('latches all subsequent operations after %s rejects credentials', async operation => {
  const service = new CalendarService(false); service.events = [event];
  const sync = service.syncNow(); wire.jobs[0].resolve([event]); await sync;
  const call = () => operation === 'details' ? service.details(event.id) : operation === 'respond' ? service.respond(event.id, 'accept') : service.availability({ emails: ['test@example.com'], start: event.start, end: event.end });
  await expect(call()).rejects.toThrow('Rejected');
  await expect(call()).rejects.toThrow(/Вход в Exchange/);
  await service.syncNow();
  expect(wire[operation]).toHaveBeenCalledOnce(); expect(wire.jobs).toHaveLength(1);
  expect(service.sync.errorKind).toBe('auth');
});
it.each([false, true])('discards late details and their errors after an account change (error=%s)', async fail => {
  const service = new CalendarService(false); service.events = [event];
  const first = service.syncNow(); wire.jobs[0].resolve([event]); await first;
  let resolve!: (value: unknown) => void; let reject!: (error: unknown) => void;
  wire.details.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  const pending = service.details(event.id);
  const checked = expect(pending).rejects.toThrow(/Аккаунт изменился/);
  await service.applySettings({ settings: { ...service.settings, account: { ...service.settings.account, username: 'new-account' } } });
  if (fail) reject(new OwaError('auth', 'Old password')); else resolve({ attendees: [], bodyText: 'Old private details' });
  await checked;
  wire.jobs[1].resolve([]); await service.syncNow(); expect(service.sync.phase).toBe('ok');
});
it('an old sync finalizer cannot remove the replacement sync lock', async () => {
  const service = new CalendarService(false); const old = service.syncNow();
  await service.applySettings({ settings: { ...service.settings, account: { ...service.settings.account, username: 'new-account' } } });
  wire.jobs[0].resolve([]); await old;
  const current = service.syncNow(); expect(wire.jobs).toHaveLength(2);
  wire.jobs[1].resolve([]); await current;
});

it('still invalidates the previous account when optional cache removal fails', async () => {
  const service = new CalendarService(false); service.events = [event]; const old = service.syncNow();
  wire.clearFails = true;
  await service.applySettings({ settings: { ...service.settings, account: { ...service.settings.account, username: 'new-account' } } });
  wire.jobs[0].resolve([event]); await old;
  expect(service.events).toEqual([]); expect(wire.jobs).toHaveLength(2);
  wire.jobs[1].resolve([]); await service.syncNow(); expect(service.sync.phase).toBe('ok');
});
it('keeps the active identity intact when saving settings fails', async () => {
  const service = new CalendarService(false); const oldAccount = { ...service.settings.account };
  wire.settingsFail = true;
  await expect(service.applySettings({ settings: { ...service.settings, account: { ...service.settings.account, username: 'new-account' } } })).rejects.toThrow('Disk full');
  expect(service.settings.account).toEqual(oldAccount); expect(wire.clients).toEqual([]);
});
it('keeps existing notes intact when persistence throws during editing or clearing', () => {
  const service = new CalendarService(false); service.events = [event];
  service.setNote(event.id, 'Original note'); wire.notesFail = true;
  expect(() => service.setNote(event.id, 'Replacement')).toThrow('Notes unavailable');
  expect(service.getNote(event.id)).toBe('Original note');
  expect(() => service.clearNotes()).toThrow('Notes unavailable');
  expect(service.getNote(event.id)).toBe('Original note');
});

it('does not accept a credential update as an implicit retry after authentication fails', async () => {
  const service = new CalendarService(false); const sync = service.syncNow();
  wire.jobs[0].reject(new OwaError('auth', 'Rejected')); await sync;
  await expect(service.applySettings({ settings: service.settings, password: 'synthetic-password' })).rejects.toThrow(/подтвердите/);
  await service.clearCache(); await service.syncNow(); expect(wire.jobs).toHaveLength(1);
});
it('retains the latch when settings cannot be saved after native retry consent', async () => {
  const service = new CalendarService(false); const sync = service.syncNow();
  wire.jobs[0].reject(new OwaError('auth', 'Rejected')); await sync;
  wire.settingsFail = true;
  await expect(service.applySettings({ settings: service.settings, password: 'synthetic-password' }, async () => true)).rejects.toThrow('Disk full');
  await service.clearCache(); await service.syncNow(); expect(wire.jobs).toHaveLength(1);
});
