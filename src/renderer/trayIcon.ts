// Draws the tray icon on a canvas and hands it to the main process.
// Windows tray icons are tiny, so the glyph is a calendar page that carries the countdown.
import type { CalendarEvent, TrayStatus } from '../shared/types';
import { composeTooltip, trayPresentation, type TrayPresentation } from '../shared/status';
import { displayTitle } from '../shared/events';
import { oneLine } from '../shared/text';
import type { Dict } from './i18n';
import { duration, hm } from './format';
import type { Lang } from './i18n';

const SIZE = 32;

const COLORS = {
  imminent: '#e5484d',
  inMeeting: '#2f9e44',
  soon: '#0f6cbd',
  overlap: '#d9480f',
};

/** Unanswered invitations: a dot in the top right corner, a colour none of the states above uses. */
const INVITE_DOT = '#ffb400';

/**
 * Draws one 32×32 frame. `frame: 'pulse'` is the second picture of the "starts any moment" pulse:
 * the same icon hollowed out (outline and digits in the accent colour, no fill), so the shape and the
 * number stay readable in both frames and only the weight changes.
 */
export function drawTrayIcon(p: TrayPresentation, taskbarLight: boolean, frame: 'base' | 'pulse' = 'base'): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  const ink = taskbarLight ? '#1b1b1b' : '#ffffff';
  const kind = p.kind;
  const accent = kind === 'imminent' ? COLORS.imminent : kind === 'inMeeting' ? COLORS.inMeeting : kind === 'overlap' ? COLORS.overlap : kind === 'soon' ? COLORS.soon : undefined;
  const filled = !!accent && frame === 'base';

  // Calendar page.
  const x = 3;
  const y = 5;
  const w = 26;
  const h = 24;
  g.lineWidth = 2.4;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = accent ?? ink;
  g.fillStyle = accent ?? 'transparent';
  roundRect(g, x, y, w, h, 4);
  if (filled) g.fill();
  g.stroke();
  if (!accent) {
    g.beginPath();
    g.moveTo(x, y + 7);
    g.lineTo(x + w, y + 7);
    g.stroke();
  }
  // Rings. The right one lies under the invitation dot, which clears that corner: skipped, not left peeking out.
  g.strokeStyle = filled ? '#ffffff' : (accent ?? ink);
  g.lineWidth = 2.6;
  for (const rx of p.invites > 0 ? [10] : [10, 22]) {
    g.beginPath();
    g.moveTo(rx, 2);
    g.lineTo(rx, 8);
    g.stroke();
  }

  const text = p.badge ?? '';
  if (accent && text) {
    g.fillStyle = filled ? '#ffffff' : accent;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${text.length > 2 ? 12 : 16}px "Segoe UI Variable Display", "Segoe UI", sans-serif`;
    g.fillText(text, x + w / 2, y + h / 2 + 3, w - 4);
  } else if (kind === 'idle' || kind === 'tomorrow' || kind === 'later') {
    // A dot for "something is coming", no number to read.
    g.fillStyle = ink;
    g.beginPath();
    g.arc(x + w / 2, y + 16, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  if (p.invites > 0) drawInviteDot(g);
  return c.toDataURL('image/png');
}

/**
 * The corner dot for unanswered invitations. The top right corner is free of the minutes number,
 * which sits in the lower two thirds of the page. A ring around the dot is erased first (not painted),
 * so it stands apart from the page edge on a light and on a dark taskbar alike.
 */
function drawInviteDot(g: CanvasRenderingContext2D) {
  const cx = 25.5;
  const cy = 6.5;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(cx, cy, 7.2, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.fillStyle = INVITE_DOT;
  g.beginPath();
  g.arc(cx, cy, 5.5, 0, Math.PI * 2);
  g.fill();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function tooltipFor(p: TrayPresentation, t: Dict, lang: Lang): string {
  // The title comes from an invitation: one line, no control characters, shortened to leave room for the lines after it.
  const title = p.event ? oneLine(displayTitle(p.event), 100) : '';
  const joinHint = p.hasJoin ? `\n${t.trayJoinHint}` : '';
  const build = (title: string): string => {
    switch (p.kind) {
      case 'nothing':
        return t.trayNothing;
      case 'overlap':
        return t.trayOverlap(p.count ?? 2, duration(p.minutes ?? 0, t)) + joinHint;
      case 'inMeeting':
        return t.trayDuring(title, duration(p.minutes ?? 0, t)) + joinHint;
      case 'imminent':
        return (p.minutes ? t.trayIn(title, duration(p.minutes, t)) : t.trayNow(title)) + joinHint;
      case 'soon':
        return t.trayIn(title, duration(p.minutes ?? 0, t)) + joinHint;
      case 'idle':
        return `${t.trayFreeUntil(hm(p.event!.start, lang))}\n${title}`;
      case 'tomorrow':
        return t.trayTomorrow(hm(p.event!.start, lang));
      case 'later':
        return t.trayLater(p.days ?? 2);
    }
  };
  return composeTooltip(build, title, [p.invites > 0 ? t.trayInvites(p.invites) : undefined]);
}

export function trayStatus(events: CalendarEvent[], now: Date, taskbarLight: boolean, t: Dict, lang: Lang): TrayStatus {
  const p = trayPresentation(events, now);
  const status: TrayStatus = { iconDataUrl: drawTrayIcon(p, taskbarLight), tooltip: tooltipFor(p, t, lang) };
  // Both frames are drawn here, once; the main process only swaps them while the pulse lasts.
  if (p.pulseUntil !== undefined) {
    status.pulseIconDataUrl = drawTrayIcon(p, taskbarLight, 'pulse');
    status.pulseUntil = p.pulseUntil;
  }
  return status;
}
