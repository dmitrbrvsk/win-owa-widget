import { describe, expect, it } from 'vitest';
import type { TrayPresentation } from '../src/shared/status';
import { drawTrayBitmap, TRAY_ICON_SIZE } from '../src/main/trayRaster';

const pres = (p: Partial<TrayPresentation> & Pick<TrayPresentation, 'kind'>): TrayPresentation => ({ hasJoin: false, invites: 0, ...p });
/** [r, g, b, a] of one pixel of a premultiplied BGRA buffer. */
const at = (b: Buffer, x: number, y: number) => {
  const i = (y * TRAY_ICON_SIZE + x) * 4;
  return [b[i + 2], b[i + 1], b[i], b[i + 3]];
};
const opaque = (b: Buffer) => b.filter((_, i) => i % 4 === 3 && b[i] > 0).length;

describe('tray icon raster', () => {
  it('is a 32×32 premultiplied picture, whatever it shows', () => {
    const states: TrayPresentation[] = [
      pres({ kind: 'nothing' }),
      pres({ kind: 'idle' }),
      pres({ kind: 'later', days: 3 }),
      pres({ kind: 'soon', badge: '12' }),
      pres({ kind: 'imminent', badge: '1', invites: 3 }),
      pres({ kind: 'inMeeting', badge: '2ч' }),
      pres({ kind: 'overlap', badge: '120ч', invites: 1 }),
    ];
    states.forEach((p, n) => {
      // Every state on both taskbars; the pulse frame only where it exists (the countdown states).
      for (const light of [false, true]) {
        for (const frame of n >= 3 && !light ? (['base', 'pulse'] as const) : (['base'] as const)) {
          const b = drawTrayBitmap(p, light, frame);
          expect(b.length).toBe(TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4);
          for (let i = 0; i < b.length; i += 4) expect(Math.max(b[i], b[i + 1], b[i + 2])).toBeLessThanOrEqual(b[i + 3]); // premultiplied
          expect(opaque(b)).toBeGreaterThan(40); // something is drawn
        }
      }
    });
  });

  it('draws the same picture every time', () => {
    const p = pres({ kind: 'soon', badge: '7', invites: 1 });
    expect(drawTrayBitmap(p, false).equals(drawTrayBitmap(p, false))).toBe(true);
  });

  it('keeps the corners clear and draws the calendar outline in the ink of the taskbar', () => {
    const dark = drawTrayBitmap(pres({ kind: 'nothing' }), false);
    const light = drawTrayBitmap(pres({ kind: 'nothing' }), true);
    expect(at(dark, 0, 0)[3]).toBe(0);
    expect(at(dark, 31, 31)[3]).toBe(0);
    // The left edge of the page (x 3 ± 1.2) at mid height.
    expect(at(dark, 3, 17)).toEqual([255, 255, 255, 255]); // white on a dark taskbar
    expect(at(light, 3, 17)).toEqual([0x1b, 0x1b, 0x1b, 255]); // dark on a light one
    expect(at(dark, 16, 20)[3]).toBe(0); // the inside of the page is empty
  });

  it('fills the page with the colour of the state and writes the number in white', () => {
    const soon = drawTrayBitmap(pres({ kind: 'soon', badge: '8' }), false);
    expect(at(soon, 6, 25)).toEqual([0x0f, 0x6c, 0xbd, 255]); // a corner of the page, away from the digit
    expect(opaque(soon)).toBeGreaterThan(opaque(drawTrayBitmap(pres({ kind: 'nothing' }), false)));
    let white = 0;
    for (let y = 12; y < 28; y++) for (let x = 8; x < 24; x++) if (at(soon, x, y).join() === '255,255,255,255') white++;
    expect(white).toBeGreaterThan(10);
    expect(at(drawTrayBitmap(pres({ kind: 'imminent', badge: '1' }), false), 6, 25).slice(0, 3)).toEqual([0xe5, 0x48, 0x4d]);
    expect(at(drawTrayBitmap(pres({ kind: 'inMeeting', badge: '30' }), false), 6, 25).slice(0, 3)).toEqual([0x2f, 0x9e, 0x44]);
    expect(at(drawTrayBitmap(pres({ kind: 'overlap', badge: '30' }), false), 6, 25).slice(0, 3)).toEqual([0xd9, 0x48, 0x0f]);
  });

  it('hollows the pulse frame out: same outline, no fill', () => {
    const p = pres({ kind: 'imminent', badge: '1' });
    const base = drawTrayBitmap(p, false, 'base');
    const pulse = drawTrayBitmap(p, false, 'pulse');
    expect(base.equals(pulse)).toBe(false);
    expect(at(pulse, 6, 25)[3]).toBe(0); // the inside is clear
    expect(at(pulse, 3, 17).slice(0, 3)).toEqual([0xe5, 0x48, 0x4d]); // the outline keeps the colour
    expect(opaque(pulse)).toBeLessThan(opaque(base));
  });

  it('marks unanswered invitations with a dot in the corner and clears the right ring for it', () => {
    const without = drawTrayBitmap(pres({ kind: 'soon', badge: '12' }), false);
    const withDot = drawTrayBitmap(pres({ kind: 'soon', badge: '12', invites: 2 }), false);
    expect(at(withDot, 25, 6)).toEqual([0xff, 0xb4, 0x00, 255]);
    expect(at(without, 25, 6)[2]).not.toBe(0); // no dot without invitations
    expect(at(without, 25, 6).join()).not.toBe('255,180,0,255');
    expect(at(without, 22, 4)[3]).toBe(255); // the right ring is there without the dot
    expect(at(withDot, 22, 4).join()).not.toBe(at(without, 22, 4).join());
  });

  it('shows a dot, not a number, for a meeting that is not close', () => {
    for (const kind of ['idle', 'tomorrow', 'later'] as const) {
      const b = drawTrayBitmap(pres({ kind }), false);
      expect(at(b, 16, 21)).toEqual([255, 255, 255, 255]);
    }
  });

  it('fits a long countdown inside the page', () => {
    const b = drawTrayBitmap(pres({ kind: 'inMeeting', badge: '1000ч' }), false);
    for (let y = 8; y < 28; y++) {
      expect(at(b, 4, y).slice(0, 3)).not.toEqual([255, 255, 255]); // nothing white spills over the left edge of the page
      expect(at(b, 27, y).slice(0, 3)).not.toEqual([255, 255, 255]);
    }
  });
});
