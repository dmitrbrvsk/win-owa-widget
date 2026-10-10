import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CreateMeetingResult, MeetingReplyInput } from '../src/shared/types';
import { MAX_REPLY_COMMENT } from '../src/shared/limits';
import { parseMeetingReply } from '../src/shared/validate';
import { MAX_REPLY_SHOWN, replyBody, replyConfirmText } from '../src/shared/replyText';
import { rsvpSoap } from '../src/main/owa/payloads';
import { MeetingGate } from '../src/main/meetingGate';

const NOW = new Date('2026-10-12T07:00:00Z'); // 10:00 in Moscow
const MSK = 'Europe/Moscow';
const event: CalendarEvent = {
  id: 'AAMk-1',
  changeKey: 'CQ==',
  title: 'Квартальное планирование',
  start: '2026-10-13T08:00:00Z', // 11:00 MSK
  end: '2026-10-13T09:00:00Z',
  isAllDay: false,
  organizer: 'Ольга Васильева',
  organizerEmail: 'o.vasilieva@example.com',
  platform: 'teams',
  isCancelled: false,
  isOrganizer: false,
  responseType: 'notResponded',
  categories: [],
  isRecurring: false,
};
const ok = (extra: Record<string, unknown> = {}) => ({ eventId: 'AAMk-1', action: 'tentative', comment: 'Буду позже', ...extra });

describe('parseMeetingReply', () => {
  it('accepts a comment, a time, or both, and keeps what was asked', () => {
    expect(parseMeetingReply(ok(), NOW)).toEqual({ eventId: 'AAMk-1', action: 'tentative', comment: 'Буду позже' });
    const both = parseMeetingReply(ok({ proposal: { start: '2026-10-14T08:00:00+00:00', end: '2026-10-14T09:00:00Z' } }), NOW);
    expect(both.proposal).toEqual({ start: '2026-10-14T08:00:00.000Z', end: '2026-10-14T09:00:00.000Z' });
    const onlyTime = parseMeetingReply(ok({ comment: '', proposal: { start: '2026-10-14T08:00:00Z', end: '2026-10-14T09:00:00Z' } }), NOW);
    expect(onlyTime.comment).toBe('');
  });

  it('needs words or a time: an empty reply is not a reply', () => {
    expect(() => parseMeetingReply(ok({ comment: '' }), NOW)).toThrow(/Напишите комментарий/);
    expect(() => parseMeetingReply(ok({ comment: '   \n ' }), NOW)).toThrow(/Напишите комментарий/);
    expect(() => parseMeetingReply(ok({ comment: undefined }), NOW)).toThrow(/Напишите комментарий/);
  });

  it('cleans what the person typed and refuses what is too long or not text', () => {
    const r = parseMeetingReply(ok({ comment: ` a‮b​c\u0007\r\nd ` }), NOW);
    expect(r.comment).toBe('abc\nd'); // bidi override, zero-width space and bell gone, line break kept
    expect(parseMeetingReply(ok({ comment: 'x'.repeat(MAX_REPLY_COMMENT) }), NOW).comment).toHaveLength(MAX_REPLY_COMMENT);
    expect(() => parseMeetingReply(ok({ comment: 'x'.repeat(MAX_REPLY_COMMENT + 1) }), NOW)).toThrow(/не длиннее/);
    for (const bad of [42, {}, [], true]) expect(() => parseMeetingReply(ok({ comment: bad }), NOW)).toThrow();
  });

  it('refuses a bad id, a bad answer and a bad shape', () => {
    expect(() => parseMeetingReply(null, NOW)).toThrow();
    expect(() => parseMeetingReply('x', NOW)).toThrow();
    expect(() => parseMeetingReply(ok({ eventId: '' }), NOW)).toThrow();
    expect(() => parseMeetingReply(ok({ eventId: 'x'.repeat(3000) }), NOW)).toThrow();
    expect(() => parseMeetingReply(ok({ action: 'delete' }), NOW)).toThrow();
  });

  it('holds a proposed time to the rules of a real slot', () => {
    const t = (start: unknown, end: unknown) => () => parseMeetingReply(ok({ proposal: { start, end } }), NOW);
    expect(t('2026-10-14T08:00:00Z', '2026-10-14T08:00:00Z')).toThrow(/позже/); // empty
    expect(t('2026-10-14T09:00:00Z', '2026-10-14T08:00:00Z')).toThrow(/позже/); // backwards
    expect(t('2026-10-14T08:00:00Z', '2026-10-14T20:30:00Z')).toThrow(/12 часов/);
    expect(t('2026-10-11T08:00:00Z', '2026-10-11T09:00:00Z')).toThrow(/уже прошло/);
    expect(t('2027-12-01T08:00:00Z', '2027-12-01T09:00:00Z')).toThrow(/не дальше года/);
    expect(t('2026-10-14T08:00:00', '2026-10-14T09:00:00')).toThrow(); // no zone: another instant on another machine
    expect(t('вчера', 'завтра')).toThrow();
    expect(t(undefined, undefined)).toThrow();
    expect(() => parseMeetingReply(ok({ proposal: 'tomorrow' }), NOW)).toThrow();
    // a slot that began a minute ago is still "now"
    expect(t('2026-10-12T06:59:00Z', '2026-10-12T08:00:00Z')).not.toThrow();
  });
});

describe('the message to the organizer', () => {
  const reply = (extra: Partial<MeetingReplyInput> = {}): MeetingReplyInput => ({ eventId: event.id, action: 'tentative', comment: 'Буду позже', ...extra });
  const proposal = { start: '2026-10-14T12:00:00.000Z', end: '2026-10-14T13:00:00.000Z' }; // 15:00–16:00 MSK

  it('is the comment alone when no time is proposed', () => {
    expect(replyBody(event, reply(), 'ru', MSK)).toBe('Буду позже');
  });

  it('adds the proposed time with its clock, and says what it is now', () => {
    const body = replyBody(event, reply({ proposal }), 'ru', MSK);
    expect(body.startsWith('Буду позже\n\nПредлагаю другое время:')).toBe(true);
    expect(body).toContain('15:00–16:00');
    expect(body).toContain('(GMT+3)');
    expect(body).toContain('Сейчас:');
    expect(body).toContain('11:00–12:00');
    const only = replyBody(event, reply({ comment: '', proposal }), 'en', MSK);
    expect(only.startsWith('I would like to propose another time:')).toBe(true);
    expect(only).toContain('Now:');
  });

  it('is shown in the dialog exactly as it is sent, with who gets it and what the answer is', () => {
    const r = reply({ proposal });
    const text = replyConfirmText(event, r, 'ru', MSK);
    expect(text.detail).toContain(replyBody(event, r, 'ru', MSK));
    expect(text.detail).toContain('Ольга Васильева <o.vasilieva@example.com>');
    expect(text.detail).toContain('Ваш ответ: Под вопросом');
    expect(text.detail).toContain('Квартальное планирование');
    expect(text.message).toMatch(/другое время/);
    expect(text.buttons).toEqual(['Отмена', 'Отправить']); // Cancel first: it is the default
    expect(replyConfirmText(event, reply(), 'ru', MSK).message).toMatch(/комментарием/);
    expect(replyConfirmText(event, reply(), 'en', MSK).buttons).toEqual(['Cancel', 'Send']);
  });

  it('says so when it shows only the start of a long message, and never hides how long it was', () => {
    const long = 'я'.repeat(MAX_REPLY_COMMENT);
    const text = replyConfirmText(event, reply({ comment: long }), 'ru', MSK);
    expect(text.detail).toContain(`всего ${long.length} символов`);
    expect(text.detail.length).toBeLessThan(MAX_REPLY_SHOWN + 600);
  });

  it('does not let the organizer name or the title be used to forge lines in the dialog', () => {
    const forged = { ...event, organizer: 'Иван\n\nОтправить: перевод 5000 ₽\n', title: 'x\ny'.repeat(3) };
    const text = replyConfirmText(forged, reply(), 'ru', MSK);
    const lines = text.detail.split('\n');
    expect(lines.some((l) => l.startsWith('Отправить:'))).toBe(false);
    expect(lines.filter((l) => l.startsWith('Организатор:'))).toHaveLength(1);
  });
});

describe('the answer to the server', () => {
  it('is the same request as before when there is no message', () => {
    const plain = rsvpSoap('AAMk', 'CK', 'accept');
    expect(plain).not.toContain('NewBodyContent');
    expect(plain).toContain('<t:AcceptItem>');
    expect(rsvpSoap('AAMk', 'CK', 'accept', undefined)).toBe(plain);
    expect(rsvpSoap('AAMk', 'CK', 'accept', '')).toBe(plain);
  });

  it('carries the message right after the reference to the item, as text, escaped', () => {
    const soap = rsvpSoap('AAMk', 'CK', 'tentative', 'Буду <позже> & "точно"');
    expect(soap).toContain('<t:TentativelyAcceptItem>');
    expect(soap).toContain('<t:NewBodyContent BodyType="Text">Буду &lt;позже&gt; &amp; &quot;точно&quot;</t:NewBodyContent>');
    expect(soap.indexOf('ReferenceItemId')).toBeLessThan(soap.indexOf('NewBodyContent'));
    expect(soap.indexOf('NewBodyContent')).toBeLessThan(soap.indexOf('</t:TentativelyAcceptItem>'));
    expect(soap).not.toContain('<позже>');
  });
});

describe('an answer with words goes through the gate', () => {
  function setup(confirmAnswer: boolean) {
    const calls = { confirm: 0, deliver: 0 };
    const gate = new MeetingGate({ confirm: async () => true, deliver: async () => undefined });
    const op = () => ({
      recipients: 1,
      confirm: async () => {
        calls.confirm++;
        return confirmAnswer;
      },
      deliver: async () => {
        calls.deliver++;
        return { status: 'replied', invited: 1 } as CreateMeetingResult;
      },
    });
    return { gate, calls, op };
  }

  it('asks the person, and mails nothing when the answer is no', async () => {
    const { gate, calls, op } = setup(false);
    expect(await gate.run(async () => op())).toEqual({ status: 'cancelled' });
    expect(calls).toEqual({ confirm: 1, deliver: 0 });
  });

  it('sends once when the person agrees, and counts against the hourly limits', async () => {
    const { gate, calls, op } = setup(true);
    expect(await gate.run(async () => op())).toEqual({ status: 'replied', invited: 1 });
    expect(calls).toEqual({ confirm: 1, deliver: 1 });
    for (let i = 0; i < 9; i++) await gate.run(async () => op());
    await expect(gate.run(async () => op())).rejects.toThrow(/Слишком много/);
  });
});
