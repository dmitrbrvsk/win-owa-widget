// Changing a meeting and calling it off both put mail in other people's mailboxes, so they are held
// to the same rules as creating one: validated in the main process, confirmed in a window the page
// cannot click, counted against the same limits, and never repeated by themselves.
import { describe, expect, it } from 'vitest';
import { cancelMeetingSoap, changedFields, recurrenceXml, updateMeetingSoap, type MeetingField } from '../src/main/owa/ewsMeeting';
import { meetingCancelText, meetingChangeText, recurrenceText } from '../src/shared/meetingConfirm';
import { MAX_OCCURRENCES, parseEditMeeting, parseRecurrence } from '../src/shared/validate';
import { MeetingGate, type Operation } from '../src/main/meetingGate';
import type { CreateMeetingResult, EditMeetingInput, MeetingBefore } from '../src/shared/types';

const NOW = new Date('2026-10-07T08:00:00Z');

const before = (over: Partial<MeetingBefore> = {}): MeetingBefore => ({
  id: 'AAMk1',
  changeKey: 'CK1',
  title: 'Синк',
  start: '2026-10-08T07:00:00.000Z',
  end: '2026-10-08T07:30:00.000Z',
  location: 'Байкал',
  body: 'Повестка',
  requiredAttendees: ['a@example.com'],
  optionalAttendees: [],
  ...over,
});

const after = (over: Partial<EditMeetingInput> = {}): EditMeetingInput => ({
  id: 'AAMk1',
  title: 'Синк',
  start: '2026-10-08T07:00:00.000Z',
  end: '2026-10-08T07:30:00.000Z',
  location: 'Байкал',
  body: 'Повестка',
  requiredAttendees: ['a@example.com'],
  optionalAttendees: [],
  recurrence: { kind: 'none' },
  ...over,
});

describe('what a change actually touches', () => {
  it('finds nothing to send when nothing moved', () => {
    expect(changedFields(before(), after())).toEqual([]);
  });

  it('sends the time as a pair, because moving one end past the other would be refused', () => {
    expect(changedFields(before(), after({ start: '2026-10-08T08:00:00.000Z', end: '2026-10-08T08:30:00.000Z' }))).toEqual(['start', 'end']);
    expect(changedFields(before(), after({ end: '2026-10-08T08:30:00.000Z' }))).toEqual(['start', 'end']);
  });

  it('notices each field on its own', () => {
    expect(changedFields(before(), after({ title: 'Другой синк' }))).toEqual(['title']);
    expect(changedFields(before(), after({ body: '' }))).toEqual(['body']);
    expect(changedFields(before(), after({ location: '' }))).toEqual(['location']);
    expect(changedFields(before(), after({ requiredAttendees: ['a@example.com', 'b@example.com'] }))).toEqual(['requiredAttendees']);
    expect(changedFields(before(), after({ optionalAttendees: ['c@example.com'] }))).toEqual(['optionalAttendees']);
  });

  it('does not call a different spelling of the same address a change', () => {
    expect(changedFields(before(), after({ requiredAttendees: ['A@Example.com'] }))).toEqual([]);
  });
});

describe('the UpdateItem request', () => {
  const build = (fields: MeetingField[], over: Partial<EditMeetingInput> = {}, b = before()) => updateMeetingSoap(b, after(over), fields);

  it('carries the item and its change key, so a race is refused instead of overwriting', () => {
    const xml = build(['title'], { title: 'Новая тема' });
    expect(xml).toContain('<t:ItemId Id="AAMk1" ChangeKey="CK1"/>');
    expect(xml).toContain('<t:Subject>Новая тема</t:Subject>');
  });

  it('sets only the fields that changed', () => {
    const xml = build(['title'], { title: 'Новая тема' });
    expect(xml).not.toContain('calendar:Start');
    expect(xml).not.toContain('calendar:RequiredAttendees');
    expect(xml.match(/<t:SetItemField>/g)).toHaveLength(1);
  });

  it('tells everyone when the meeting has attendees, and nobody when it has none', () => {
    expect(build(['title'], { title: 'X' })).toContain('SendMeetingInvitationsOrCancellations="SendToAllAndSaveCopy"');
    const alone = before({ requiredAttendees: [], optionalAttendees: [] });
    expect(updateMeetingSoap(alone, after({ title: 'X', requiredAttendees: [] }), ['title'])).toContain('SendMeetingInvitationsOrCancellations="SendToNone"');
  });

  it('still tells the people who are being removed', () => {
    // They are attendees of the meeting as it stands, so the cancellation has to reach them.
    expect(updateMeetingSoap(before(), after({ requiredAttendees: [] }), ['requiredAttendees'])).toContain('SendToAllAndSaveCopy');
  });

  it('deletes a description or a place that became empty instead of setting it to nothing', () => {
    expect(build(['body'], { body: '' })).toContain('<t:DeleteItemField><t:FieldURI FieldURI="item:Body"/></t:DeleteItemField>');
    expect(build(['location'], { location: '' })).toContain('<t:DeleteItemField><t:FieldURI FieldURI="calendar:Location"/></t:DeleteItemField>');
    expect(build(['body'], { body: 'Новая повестка' })).toContain('<t:Body BodyType="Text">Новая повестка</t:Body>');
  });

  it('writes the times as UTC instants, as creating does', () => {
    const xml = build(['start', 'end'], { start: '2026-10-08T08:00:00+03:00', end: '2026-10-08T09:00:00+03:00' });
    expect(xml).toContain('<t:Start>2026-10-08T05:00:00Z</t:Start>');
    expect(xml).toContain('<t:End>2026-10-08T06:00:00Z</t:End>');
  });

  it('leaves a hostile subject as text', () => {
    const xml = build(['title'], { title: '</t:Subject><t:Evil a="1"/>' });
    expect(xml).not.toContain('<t:Evil');
    expect(xml).toContain('&lt;/t:Subject&gt;');
  });

  it('refuses to build a request that changes nothing', () => {
    expect(() => updateMeetingSoap(before(), after(), [])).toThrow();
  });
});

describe('the cancellation request', () => {
  it('is a CancelCalendarItem that is sent, not a quiet delete', () => {
    const xml = cancelMeetingSoap('AAMk1', 'CK1');
    expect(xml).toContain('MessageDisposition="SendAndSaveCopy"');
    expect(xml).toContain('<t:CancelCalendarItem>');
    expect(xml).toContain('<t:ReferenceItemId Id="AAMk1" ChangeKey="CK1"/>');
  });

  it('works without a change key and escapes a hostile id', () => {
    expect(cancelMeetingSoap('AAMk1', undefined)).toContain('<t:ReferenceItemId Id="AAMk1"/>');
    expect(cancelMeetingSoap('"/><t:Evil/>', undefined)).not.toContain('<t:Evil/>');
  });
});

describe('how often a meeting repeats', () => {
  const start = '2026-10-08T07:00:00.000Z'; // a Thursday in Moscow, where the tests run

  it('is a daily pattern for every day and a weekly one over Mon-Fri for working days', () => {
    expect(recurrenceXml({ kind: 'daily', end: { kind: 'count', count: 5 } }, start)).toContain('<t:DailyRecurrence><t:Interval>1</t:Interval></t:DailyRecurrence>');
    const weekdays = recurrenceXml({ kind: 'weekdays', end: { kind: 'count', count: 5 } }, start);
    expect(weekdays).toContain('<t:DaysOfWeek>Monday Tuesday Wednesday Thursday Friday</t:DaysOfWeek>');
    expect(weekdays).not.toContain('DailyRecurrence'); // a daily pattern would also book Saturday and Sunday
  });

  it('repeats weekly on the day the meeting starts, every week or every second one', () => {
    expect(recurrenceXml({ kind: 'weekly', end: { kind: 'count', count: 3 } }, start)).toContain('<t:WeeklyRecurrence><t:Interval>1</t:Interval><t:DaysOfWeek>Thursday</t:DaysOfWeek>');
    expect(recurrenceXml({ kind: 'biweekly', end: { kind: 'count', count: 3 } }, start)).toContain('<t:Interval>2</t:Interval>');
  });

  it('carries the end as a count or as a date', () => {
    expect(recurrenceXml({ kind: 'daily', end: { kind: 'count', count: 7 } }, start)).toContain('<t:NumberOfOccurrences>7</t:NumberOfOccurrences>');
    expect(recurrenceXml({ kind: 'daily', end: { kind: 'until', date: '2026-12-01' } }, start)).toContain('<t:EndDate>2026-12-01</t:EndDate>');
  });

  it('is nothing at all when the meeting does not repeat', () => {
    expect(recurrenceXml({ kind: 'none' }, start)).toBe('');
    expect(recurrenceXml(undefined, start)).toBe('');
    expect(recurrenceXml({ kind: 'weekly' }, start)).toBe(''); // no end: not a series
  });
});

describe('a series is bounded before it is sent', () => {
  const startMs = Date.parse('2026-10-08T07:00:00.000Z');

  it('needs an end', () => {
    expect(() => parseRecurrence({ kind: 'weekly' }, startMs, NOW)).toThrow(/окончание/i);
    expect(parseRecurrence(undefined, startMs, NOW)).toEqual({ kind: 'none' });
    expect(parseRecurrence({ kind: 'nonsense' }, startMs, NOW)).toEqual({ kind: 'none' });
  });

  it('refuses more occurrences than a person would ever check', () => {
    expect(parseRecurrence({ kind: 'daily', end: { kind: 'count', count: MAX_OCCURRENCES } }, startMs, NOW).end).toEqual({ kind: 'count', count: MAX_OCCURRENCES });
    expect(() => parseRecurrence({ kind: 'daily', end: { kind: 'count', count: MAX_OCCURRENCES + 1 } }, startMs, NOW)).toThrow();
    expect(() => parseRecurrence({ kind: 'daily', end: { kind: 'count', count: 500 } }, startMs, NOW)).toThrow();
    expect(() => parseRecurrence({ kind: 'daily', end: { kind: 'count', count: 0 } }, startMs, NOW)).toThrow();
    expect(() => parseRecurrence({ kind: 'daily', end: { kind: 'count', count: 2.5 } }, startMs, NOW)).toThrow();
  });

  it('refuses an end date that is nonsense, in the past or beyond two years', () => {
    expect(() => parseRecurrence({ kind: 'weekly', end: { kind: 'until', date: 'завтра' } }, startMs, NOW)).toThrow();
    expect(() => parseRecurrence({ kind: 'weekly', end: { kind: 'until', date: '2026-10-01' } }, startMs, NOW)).toThrow(/раньше/);
    expect(() => parseRecurrence({ kind: 'weekly', end: { kind: 'until', date: '2030-01-01' } }, startMs, NOW)).toThrow(/двух лет/);
    expect(parseRecurrence({ kind: 'weekly', end: { kind: 'until', date: '2026-12-31' } }, startMs, NOW).kind).toBe('weekly');
  });
});

describe('a change is validated like a new meeting, plus its id', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    id: 'AAMk1',
    title: 'Синк',
    start: '2026-10-08T07:00:00.000Z',
    end: '2026-10-08T07:30:00.000Z',
    requiredAttendees: ['a@example.com'],
    ...over,
  });

  it('keeps the id and rebuilds everything else', () => {
    const m = parseEditMeeting(input({ title: '  Синк  ' }), NOW);
    expect(m.id).toBe('AAMk1');
    expect(m.title).toBe('Синк');
  });

  it('refuses a missing id and a look-alike address, the way creating does', () => {
    expect(() => parseEditMeeting(input({ id: undefined }), NOW)).toThrow();
    expect(() => parseEditMeeting(input({ requiredAttendees: ['ivаn@example.com'] }), NOW)).toThrow();
    expect(() => parseEditMeeting('нет', NOW)).toThrow();
  });
});

describe('the dialogs a person answers', () => {
  it('shows the old and the new time when the meeting moves', () => {
    const t = meetingChangeText(before(), after({ start: '2026-10-09T07:00:00.000Z', end: '2026-10-09T07:30:00.000Z' }), ['start', 'end'], 'ru', 'UTC');
    expect(t.detail).toMatch(/Было: .*8 октября.*07:00–07:30/);
    expect(t.detail).toMatch(/Станет: .*9 октября.*07:00–07:30/);
    expect(t.buttons).toEqual(['Отмена', 'Сохранить']);
  });

  it('names who was added and who is no longer invited', () => {
    const t = meetingChangeText(before(), after({ requiredAttendees: ['b@example.com'] }), ['requiredAttendees'], 'ru');
    expect(t.detail).toContain('Добавлены: b@example.com');
    expect(t.detail).toContain('Больше не приглашены: a@example.com');
  });

  it('says plainly that a cancellation reaches everybody and cannot be undone', () => {
    const t = meetingCancelText(before(), 3, 'ru', 'UTC');
    expect(t.message).toBe('Отменить встречу?');
    expect(t.detail).toContain('Встреча: Синк');
    expect(t.detail).toMatch(/3 участникам придёт уведомление/);
    expect(t.detail).toContain('Вернуть её будет нельзя');
    // The safe answer is first and is what Esc chooses.
    expect(t.buttons).toEqual(['Не отменять', 'Отменить встречу']);
  });

  it('spells a series out, so nobody sends fifty invitations without seeing it', () => {
    const m = after({ recurrence: { kind: 'weekly', end: { kind: 'count', count: 10 } } });
    expect(recurrenceText(m, 'ru')).toMatch(/Каждую неделю по \S+, 10 повторений/);
    expect(recurrenceText(after({ recurrence: { kind: 'weekdays', end: { kind: 'until', date: '2026-12-01' } } }), 'ru', 'UTC')).toBe('Каждый будний день, до 1 декабря 2026 г.');
    expect(recurrenceText(after({ recurrence: { kind: 'daily', end: { kind: 'count', count: 1 } } }), 'ru')).toBe('Каждый день, 1 повторение');
    expect(recurrenceText(after({ recurrence: { kind: 'daily', end: { kind: 'count', count: 3 } } }), 'ru')).toBe('Каждый день, 3 повторения');
    expect(recurrenceText(after(), 'ru')).toBe('');
  });

  it('keeps a hostile subject out of the dialog it would imitate', () => {
    const t = meetingCancelText(before({ title: 'A\n\nОтменить встречу?‮​'.repeat(5) }), 1, 'ru', 'UTC');
    expect(t.detail.split('\n')[0]).toMatch(/^Встреча: /);
    expect(t.detail).not.toMatch(/[‮​]/);
  });
});

describe('the gate holds for changes and cancellations too', () => {
  function setup(answer: boolean | 'pending' = true) {
    const calls = { confirm: 0, deliver: 0 };
    let release: (v: boolean) => void = () => {};
    let clock = Date.parse('2026-10-07T08:00:00Z');
    const gate = new MeetingGate({
      now: () => clock,
      confirm: () => Promise.resolve(true),
      deliver: async () => {},
    });
    const op = (recipients: number): Operation => ({
      recipients,
      confirm: () => {
        calls.confirm++;
        if (answer === 'pending') return new Promise<boolean>((r) => (release = r));
        return Promise.resolve(answer);
      },
      deliver: async () => {
        calls.deliver++;
        return { status: 'updated', invited: recipients } as CreateMeetingResult;
      },
    });
    return { gate, calls, op, release: (v: boolean) => release(v), advance: (ms: number) => (clock += ms) };
  }

  it('asks before it sends, and sends nothing when the answer is no', async () => {
    const { gate, calls, op } = setup(false);
    expect(await gate.run(async () => op(3))).toEqual({ status: 'cancelled' });
    expect(calls).toEqual({ confirm: 1, deliver: 0 });
  });

  it('does not ask when nobody would be told', async () => {
    const { gate, calls, op } = setup();
    expect(await gate.run(async () => op(0))).toEqual({ status: 'updated', invited: 0 });
    expect(calls).toEqual({ confirm: 0, deliver: 1 });
  });

  it('runs one at a time, whatever the operation is', async () => {
    const { gate, calls, op, release } = setup('pending');
    const first = gate.run(async () => op(2));
    for (let i = 0; i < 50 && !calls.confirm; i++) await Promise.resolve();
    await expect(gate.run(async () => op(2))).rejects.toThrow(/ещё выполняется/);
    expect(calls.deliver).toBe(0);
    release(true);
    expect(await first).toEqual({ status: 'updated', invited: 2 });
  });

  it('counts changes against the same hourly limits as new meetings', async () => {
    const { gate, op } = setup();
    for (let i = 0; i < 10; i++) await gate.run(async () => op(1));
    await expect(gate.run(async () => op(1))).rejects.toThrow(/Слишком много встреч/);
  });

  it('spends no quota when the data turns out to be bad', async () => {
    const { gate, calls, op } = setup();
    await expect(
      gate.run(async () => {
        throw new Error('Во встрече ничего не изменилось');
      }),
    ).rejects.toThrow(/ничего не изменилось/);
    expect(calls.confirm).toBe(0);
    // and the gate is free again
    expect(await gate.run(async () => op(1))).toEqual({ status: 'updated', invited: 1 });
  });

  it('checks the limits again after the dialog, because it was open for a while', async () => {
    const { gate, op, release, advance } = setup('pending');
    const running = gate.run(async () => op(250));
    for (let i = 0; i < 50; i++) await Promise.resolve();
    advance(1000);
    release(true);
    await expect(running).resolves.toEqual({ status: 'updated', invited: 250 });
    // 250 of the 300 recipients an hour are spent: another 100 do not fit
    await expect(gate.run(async () => op(100))).rejects.toThrow(/Слишком много приглашений/);
  });
});

describe('a change is never repeated by itself', () => {
  it('calls the server once: the guarantee is that there is no second request to find', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/main/owa/client.ts', 'utf8'));
    const update = source.slice(source.indexOf('async updateMeeting('), source.indexOf('async cancelMeeting('));
    const cancel = source.slice(source.indexOf('async cancelMeeting('), source.indexOf('async resolveNames('));
    // createMeeting has exactly one repeat, and only for a meeting that mails nobody (see ews.test.ts).
    expect(update.match(/this\.ews\(/g)).toHaveLength(1);
    expect(cancel.match(/this\.ews\(/g)).toHaveLength(1);
  });
});
