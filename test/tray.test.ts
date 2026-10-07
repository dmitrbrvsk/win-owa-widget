import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../src/shared/types';
import { pendingInvitations } from '../src/shared/events';
import { composeTooltip, TRAY_TOOLTIP_MAX, trayPresentation } from '../src/shared/status';
import { parseTrayStatus } from '../src/shared/validate';
import { MAX_PULSE_MS, PULSE_INTERVAL_MS, TrayPulse } from '../src/main/trayPulse';

const NOW = new Date(2026, 9, 7, 10, 48, 0);
/** An ISO time `sec` seconds from NOW. */
const after = (sec: number) => new Date(NOW.getTime() + sec * 1000).toISOString();
let i = 0;
const ev = (startSec: number, endSec: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `t${++i}`,
  changeKey: 'ck',
  title: `Meeting ${i}`,
  start: after(startSec),
  end: after(endSec),
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
const invite = (startSec = 3600, extra: Partial<CalendarEvent> = {}) => ev(startSec, startSec + 1800, { responseType: 'notResponded', ...extra });

describe('tray: unanswered invitations', () => {
  it('counts exactly what the popup lists under "Новые приглашения"', () => {
    const events = [
      invite(3600),
      invite(7200),
      invite(3600, { isOrganizer: true }), // my own meeting
      invite(3600, { isCancelled: true }),
      invite(3600, { title: 'Отменено: Ретро' }),
      invite(3600, { changeKey: undefined }), // cannot be answered
      invite(-7200), // already over
      ev(3600, 5400, { responseType: 'tentative' }),
      ev(3600, 5400, { responseType: 'declined' }),
    ];
    expect(trayPresentation(events, NOW).invites).toBe(2);
    expect(trayPresentation(events, NOW).invites).toBe(pendingInvitations(events, NOW).length);
  });

  it('is zero without invitations and does not change the status itself', () => {
    expect(trayPresentation([], NOW)).toMatchObject({ kind: 'nothing', invites: 0 });
    const meeting = ev(10 * 60, 40 * 60);
    const withInvite = trayPresentation([meeting, invite()], NOW);
    expect(withInvite).toMatchObject({ kind: 'soon', badge: '10', invites: 1 });
    // The minutes badge is the same with and without the marker.
    expect(withInvite.badge).toBe(trayPresentation([meeting], NOW).badge);
    expect(trayPresentation([ev(-600, 600), invite()], NOW)).toMatchObject({ kind: 'inMeeting', badge: '10', invites: 1 });
  });

  it('counts an invitation that has started but not ended, and drops it when it ends', () => {
    const running = invite(-600);
    expect(trayPresentation([running], NOW).invites).toBe(1);
    expect(trayPresentation([running], new Date(NOW.getTime() + 3600_000)).invites).toBe(0);
  });
});

describe('tray: when the icon pulses', () => {
  const start = (sec: number) => NOW.getTime() + sec * 1000;

  it('pulses in the last two minutes before a meeting the person is going to, until it starts', () => {
    const p = trayPresentation([ev(90, 3600)], NOW);
    expect(p).toMatchObject({ kind: 'imminent', badge: '2' });
    expect(p.pulseUntil).toBe(start(90));
    expect(trayPresentation([ev(120, 3600)], NOW).pulseUntil).toBe(start(120)); // exactly two minutes
    expect(trayPresentation([ev(1, 3600)], NOW).pulseUntil).toBe(start(1));
  });

  it('does not pulse earlier, nor once the meeting has started', () => {
    expect(trayPresentation([ev(121, 3600)], NOW)).toMatchObject({ kind: 'soon' });
    expect(trayPresentation([ev(121, 3600)], NOW).pulseUntil).toBeUndefined();
    expect(trayPresentation([ev(0, 3600)], NOW)).toMatchObject({ kind: 'inMeeting' });
    expect(trayPresentation([ev(0, 3600)], NOW).pulseUntil).toBeUndefined();
    expect(trayPresentation([ev(-30, 3600), ev(-10, 1800)], NOW).pulseUntil).toBeUndefined(); // overlap
    expect(trayPresentation([ev(3 * 3600, 4 * 3600)], NOW).pulseUntil).toBeUndefined(); // idle
  });

  it('pulses for a meeting without a link and for one the person organizes or accepted tentatively', () => {
    expect(trayPresentation([ev(60, 3600, { joinUrl: undefined, platform: 'generic' })], NOW).pulseUntil).toBe(start(60));
    expect(trayPresentation([ev(60, 3600, { responseType: 'organizer', isOrganizer: true })], NOW).pulseUntil).toBe(start(60));
    expect(trayPresentation([ev(60, 3600, { responseType: 'tentative' })], NOW).pulseUntil).toBe(start(60));
  });

  it('leaves an unanswered invitation, a declined or a cancelled meeting alone', () => {
    const p = trayPresentation([invite(60)], NOW);
    expect(p).toMatchObject({ kind: 'imminent', badge: '1', invites: 1 }); // the countdown stays
    expect(p.pulseUntil).toBeUndefined();
    expect(trayPresentation([ev(60, 3600, { responseType: 'declined' })], NOW).kind).toBe('nothing');
    expect(trayPresentation([ev(60, 3600, { isCancelled: true })], NOW).pulseUntil).toBeUndefined();
  });

  it('pulses when one of several meetings starting together is the person’s own', () => {
    expect(trayPresentation([invite(60), ev(60, 3600)], NOW).pulseUntil).toBe(start(60));
    expect(trayPresentation([invite(60), ev(100, 3600)], NOW).pulseUntil).toBeUndefined(); // the later one is not next
  });
});

describe('tray tooltip', () => {
  const build = (title: string) => `${title} — через 2 мин`;

  it('keeps the text as it is when it fits', () => {
    expect(composeTooltip(build, 'Дизайн-ревью', ['2 новых приглашения'])).toBe(`${build('Дизайн-ревью')}\n2 новых приглашения`);
    expect(composeTooltip(build, 'Дизайн-ревью', [undefined])).toBe(build('Дизайн-ревью'));
    expect(composeTooltip(build, 'Дизайн-ревью', [])).toBe(build('Дизайн-ревью'));
  });

  it('shortens a long title so that the invitations line is not cut off', () => {
    const out = composeTooltip(build, 'Очень длинное название встречи '.repeat(10), ['3 новых приглашения']);
    expect(out.length).toBeLessThanOrEqual(TRAY_TOOLTIP_MAX);
    expect(out.endsWith('\n3 новых приглашения')).toBe(true);
    expect(out).toContain('… — через 2 мин');
    expect(out.startsWith('Очень длинное')).toBe(true);
  });

  it('does not split an emoji and survives no room at all', () => {
    const out = composeTooltip(build, '😀'.repeat(200), ['1 new invitation']);
    expect(out.length).toBeLessThanOrEqual(TRAY_TOOLTIP_MAX);
    expect([...out].every((ch) => ch.length === 2 || ch.charCodeAt(0) < 0xd800 || ch.charCodeAt(0) > 0xdfff)).toBe(true);
    const tight = composeTooltip(build, 'x'.repeat(50), ['y'.repeat(120)]);
    expect(tight.endsWith('y'.repeat(120))).toBe(true);
    expect(tight.startsWith(' — через 2 мин')).toBe(true); // title dropped, the rest kept
  });
});

describe('tray status from the page', () => {
  /** A data URL that starts like a PNG of the given size (the rest is irrelevant to the header check). */
  function png(w: number, h: number): string {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return 'data:image/png;base64,' + b.toString('base64');
  }
  const icon = png(32, 32);

  it('passes the pulse frame and its end time through', () => {
    expect(parseTrayStatus({ iconDataUrl: icon, tooltip: 't', pulseIconDataUrl: png(32, 32), pulseUntil: 1_800_000_000_000.4 })).toEqual({
      iconDataUrl: icon,
      tooltip: 't',
      pulseIconDataUrl: png(32, 32),
      pulseUntil: 1_800_000_000_000,
    });
    expect(parseTrayStatus({ iconDataUrl: icon, tooltip: 't' })).toEqual({ iconDataUrl: icon, tooltip: 't' });
  });

  it('holds the pulse frame to the same rules as the icon, and drops only the pulse when it is bad', () => {
    const base = { iconDataUrl: icon, tooltip: 't' };
    for (const bad of [png(4000, 4000), png(129, 32), 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'data:text/html;base64,AAAA', 42, null, { x: 1 }, 'data:image/png;base64,' + 'A'.repeat(70_000)]) {
      expect(parseTrayStatus({ ...base, pulseIconDataUrl: bad, pulseUntil: 1 })).toEqual(base);
    }
    for (const until of [undefined, NaN, Infinity, '1', null, {}]) {
      expect(parseTrayStatus({ ...base, pulseIconDataUrl: png(32, 32), pulseUntil: until })).toEqual(base);
    }
    // The first picture is still mandatory.
    expect(parseTrayStatus({ iconDataUrl: png(4000, 4000), tooltip: 't', pulseIconDataUrl: png(32, 32), pulseUntil: 1 })).toBeNull();
    expect(parseTrayStatus({ tooltip: 't', pulseIconDataUrl: png(32, 32), pulseUntil: 1 })).toBeNull();
  });

  it('keeps the tooltip clean and short', () => {
    const out = parseTrayStatus({ iconDataUrl: icon, tooltip: `a‮b\u0007${'c'.repeat(300)}` });
    expect(out?.tooltip.startsWith('abcc')).toBe(true); // the bidi override and the bell are gone
    expect(out?.tooltip.length).toBeLessThanOrEqual(127);
  });
});

describe('TrayPulse', () => {
  afterEach(() => vi.useRealTimers());

  function setup(opts: { allowed?: () => boolean } = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const frames: number[] = [];
    const pulse = new TrayPulse({ show: (f) => frames.push(f), allowed: opts.allowed });
    return { pulse, frames };
  }

  it('has no timer until a pulse starts', () => {
    const { pulse } = setup();
    expect(pulse.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('alternates the two frames with a single timer and stops, restoring the normal icon, when the meeting starts', () => {
    const { pulse, frames } = setup();
    expect(pulse.start(NOW.getTime() + 3000)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(frames).toEqual([1]);
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(frames).toEqual([1, 0]);
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(frames).toEqual([1, 0, 1]);
    expect(vi.getTimerCount()).toBe(1);
    // 3000 ms: the next tick after the end shows the normal icon again and clears the timer.
    vi.advanceTimersByTime(PULSE_INTERVAL_MS * 2);
    expect(frames.at(-1)).toBe(0);
    expect(pulse.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const shown = frames.length;
    vi.advanceTimersByTime(60_000);
    expect(frames).toHaveLength(shown); // nothing ticks any more
  });

  it('does not touch the tray when it ends on a normal frame', () => {
    const { pulse, frames } = setup();
    pulse.start(NOW.getTime() + 1500);
    vi.advanceTimersByTime(PULSE_INTERVAL_MS * 2); // 1 then 0
    vi.advanceTimersByTime(PULSE_INTERVAL_MS); // past the end
    expect(frames).toEqual([1, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start for an end in the past or when animations are switched off', () => {
    const { pulse } = setup();
    expect(pulse.start(NOW.getTime())).toBe(false);
    expect(pulse.start(NOW.getTime() - 5000)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const off = setup({ allowed: () => false });
    expect(off.pulse.start(NOW.getTime() + 60_000)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops as soon as animations are switched off while it runs', () => {
    let allowed = true;
    const { pulse, frames } = setup({ allowed: () => allowed });
    pulse.start(NOW.getTime() + 60_000);
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(frames).toEqual([1]);
    allowed = false;
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(frames).toEqual([1, 0]); // back to the normal icon
    expect(pulse.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() clears the timer without drawing, and a restart never leaves two timers', () => {
    const { pulse, frames } = setup();
    pulse.start(NOW.getTime() + 60_000);
    pulse.start(NOW.getTime() + 90_000);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    pulse.stop();
    expect(pulse.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames).toEqual([1]);
    vi.advanceTimersByTime(10_000);
    expect(frames).toEqual([1]);
  });

  it('never pulses longer than the cap, whatever end time it is given', () => {
    const { pulse, frames } = setup();
    expect(pulse.start(NOW.getTime() + 24 * 3600_000)).toBe(true);
    vi.advanceTimersByTime(MAX_PULSE_MS + PULSE_INTERVAL_MS);
    expect(pulse.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.at(-1)).toBe(0);
    expect(frames.length).toBeLessThanOrEqual(Math.ceil(MAX_PULSE_MS / PULSE_INTERVAL_MS) + 1);
  });
});
