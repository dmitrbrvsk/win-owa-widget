import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/shared/types';
import { detectMeetingUrl, safeUrl } from '../src/shared/meetingUrl';
import { displayTitle, joinCandidates, nextMeetingGroup, pendingInvitations } from '../src/shared/events';
import { dueReminders } from '../src/main/reminders';
import { layoutDay } from '../src/shared/timeline';
import { trayPresentation } from '../src/shared/status';

const NOW = new Date(2026, 9, 7, 10, 48);
const t = (h: number, m = 0, day = 7) => new Date(2026, 9, day, h, m).toISOString();
let i = 0;
const ev = (start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e${++i}`,
  changeKey: 'ck',
  title: `Meeting ${i}`,
  start,
  end,
  isAllDay: false,
  platform: 'teams',
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
  isCancelled: false,
  isOrganizer: false,
  responseType: 'accepted',
  categories: [],
  isRecurring: false,
  ...extra,
});

describe('meeting links', () => {
  it('detects platforms and unescapes JSON/HTML', () => {
    expect(detectMeetingUrl('<a href="https:\\/\\/meet.google.com\\/abc-defg-hij">x</a>')).toEqual({
      url: 'https://meet.google.com/abc-defg-hij',
      platform: 'googleMeet',
    });
    expect(detectMeetingUrl('Join https://acme.webex.com/meet/joe).')?.url).toBe('https://acme.webex.com/meet/joe');
    expect(detectMeetingUrl('https://us02web.zoom.us/j/8?pwd=a&amp;b=1')?.url).toBe('https://us02web.zoom.us/j/8?pwd=a&b=1');
    expect(detectMeetingUrl('no link here')).toBeNull();
  });

  it('only allows http(s)', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('team.ktalk.ru/x')).toBe('https://team.ktalk.ru/x');
  });
});

describe('events', () => {
  it('strips cancellation prefixes', () => {
    expect(displayTitle(ev(t(9), t(10), { title: 'Отменено: Ретро' }))).toBe('Ретро');
  });

  it('lists pending invitations only for others’ future meetings', () => {
    const pending = ev(t(15), t(16), { responseType: 'notResponded' });
    const mine = ev(t(15), t(16), { responseType: 'notResponded', isOrganizer: true });
    const past = ev(t(8), t(9), { responseType: 'notResponded' });
    const cancelled = ev(t(15), t(16), { responseType: 'notResponded', isCancelled: true });
    expect(pendingInvitations([pending, mine, past, cancelled], NOW).map((e) => e.id)).toEqual([pending.id]);
  });

  it('groups meetings that start together', () => {
    const a = ev(t(11), t(12));
    const b = ev(t(11), t(11, 30));
    const c = ev(t(13), t(14));
    expect(nextMeetingGroup([c, a, b], NOW).map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('offers a running meeting and one starting soon for Join', () => {
    const running = ev(t(10, 30), t(11, 30));
    const soon = ev(t(10, 55), t(11, 30));
    const later = ev(t(12), t(13));
    const noLink = ev(t(10, 50), t(11), { joinUrl: undefined });
    expect(joinCandidates([running, soon, later, noLink], NOW).map((e) => e.id)).toEqual([running.id, soon.id]);
  });
});

describe('reminders', () => {
  it('fires at the lead time and clusters close starts', () => {
    const a = ev(t(10, 49), t(11, 30));
    const b = ev(t(10, 55), t(11, 30));
    const c = ev(t(11, 30), t(12));
    const shown = new Set<string>();
    expect(dueReminders([a, b, c], NOW, 1, shown).map((e) => e.id)).toEqual([a.id, b.id]);
    expect(dueReminders([c], NOW, 1, shown)).toEqual([]);
  });

  it('can be disabled and skips declined meetings', () => {
    const a = ev(t(10, 49), t(11, 30), { responseType: 'declined' });
    expect(dueReminders([a], NOW, 1, new Set())).toEqual([]);
    expect(dueReminders([ev(t(10, 49), t(11))], NOW, -1, new Set())).toEqual([]);
  });
});

describe('timeline layout', () => {
  it('puts overlapping meetings in side-by-side lanes', () => {
    const a = ev(t(9), t(9, 30));
    const b = ev(t(9, 30), t(10, 30));
    const c = ev(t(10), t(11));
    const d = ev(t(11), t(11, 45));
    const blocks = layoutDay([a, b, c, d], new Date(2026, 9, 7));
    const by = Object.fromEntries(blocks.map((x) => [x.event.id, x]));
    expect([by[a.id].lane, by[a.id].lanes]).toEqual([0, 1]);
    expect([by[b.id].lane, by[b.id].lanes]).toEqual([0, 2]);
    expect([by[c.id].lane, by[c.id].lanes]).toEqual([1, 2]);
    expect([by[d.id].lane, by[d.id].lanes]).toEqual([0, 1]);
    expect(by[b.id].startMin).toBe(570);
    expect(by[b.id].endMin).toBe(630);
  });

  it('clips meetings that cross midnight', () => {
    const night = ev(t(23), t(1, 0, 8));
    const [blk] = layoutDay([night], new Date(2026, 9, 7));
    expect([blk.startMin, blk.endMin]).toEqual([1380, 1440]);
  });
});

describe('tray status', () => {
  it('counts down before a meeting and shows time left during one', () => {
    expect(trayPresentation([ev(t(10, 58), t(11, 30))], NOW)).toMatchObject({ badge: '10', kind: 'soon' });
    expect(trayPresentation([ev(t(10, 49), t(11, 30))], NOW)).toMatchObject({ badge: '1', kind: 'imminent' });
    expect(trayPresentation([ev(t(10, 30), t(11, 0))], NOW)).toMatchObject({ badge: '12', kind: 'inMeeting' });
    expect(trayPresentation([ev(t(13), t(14))], NOW)).toMatchObject({ kind: 'idle' });
    expect(trayPresentation([], NOW).kind).toBe('nothing');
  });
});
