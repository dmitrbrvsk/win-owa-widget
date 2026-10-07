// Draws the tray icon in the main process, with no browser behind it.
//
// The icon used to be painted on a canvas inside the popup window, which therefore had to stay alive,
// hidden, only for that: a whole browser process, about 60 MB, to draw a 32×32 picture. This is the
// same picture made from a few shapes: a calendar page, two rings, a countdown and a corner dot. It
// is pure arithmetic over a pixel buffer (no Electron, no DOM), so it runs in a unit test as well.
import type { TrayPresentation } from '../shared/status';

export const TRAY_ICON_SIZE = 32;

/** Sub-pixels per pixel along one axis; 4×4 = 16 levels of edge smoothing, like a canvas. */
const SS = 4;

const COLORS = {
  imminent: [0xe5, 0x48, 0x4d],
  inMeeting: [0x2f, 0x9e, 0x44],
  soon: [0x0f, 0x6c, 0xbd],
  overlap: [0xd9, 0x48, 0x0f],
} as const;
/** Unanswered invitations: a dot in the top right corner, a colour none of the states above uses. */
const INVITE_DOT = [0xff, 0xb4, 0x00] as const;
const WHITE = [0xff, 0xff, 0xff] as const;

type Rgb = readonly [number, number, number] | readonly number[];

// ---------- A tiny canvas ----------

/** Premultiplied RGBA at SS× resolution. Every operation takes a coverage test over canvas coordinates. */
class Canvas {
  private readonly n = TRAY_ICON_SIZE * SS;
  private readonly px = new Float32Array(this.n * this.n * 4);

  /** The sub-pixel range a box (in canvas units) touches, clamped to the picture. */
  private range(box: Box): [number, number, number, number] {
    const clamp = (v: number) => Math.max(0, Math.min(this.n, v));
    return [clamp(Math.floor(box[0] * SS)), clamp(Math.floor(box[1] * SS)), clamp(Math.ceil(box[2] * SS)), clamp(Math.ceil(box[3] * SS))];
  }

  /** Source-over: paints `rgb` wherever `covers(x, y)` holds inside `box` (x, y in 32×32 canvas units). */
  paint(covers: (x: number, y: number) => boolean, rgb: Rgb, box: Box) {
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const [i0, j0, i1, j1] = this.range(box);
    for (let j = j0; j < j1; j++) {
      const y = (j + 0.5) / SS;
      for (let i = i0; i < i1; i++) {
        if (!covers((i + 0.5) / SS, y)) continue;
        const k = (j * this.n + i) * 4;
        // alpha is 1 for the source, so the result is just the source colour.
        this.px[k] = r;
        this.px[k + 1] = g;
        this.px[k + 2] = b;
        this.px[k + 3] = 1;
      }
    }
  }

  /** destination-out: whatever the shape covers becomes transparent. */
  erase(covers: (x: number, y: number) => boolean, box: Box) {
    const [i0, j0, i1, j1] = this.range(box);
    for (let j = j0; j < j1; j++) {
      const y = (j + 0.5) / SS;
      for (let i = i0; i < i1; i++) {
        if (covers((i + 0.5) / SS, y)) this.px.fill(0, (j * this.n + i) * 4, (j * this.n + i) * 4 + 4);
      }
    }
  }

  /** The picture as 32×32 premultiplied BGRA bytes: what `nativeImage.createFromBitmap` takes. */
  bgra(): Buffer {
    const size = TRAY_ICON_SIZE;
    const out = Buffer.alloc(size * size * 4);
    const area = SS * SS;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const k = ((y * SS + sy) * this.n + x * SS + sx) * 4;
            r += this.px[k];
            g += this.px[k + 1];
            b += this.px[k + 2];
            a += this.px[k + 3];
          }
        }
        const o = (y * size + x) * 4;
        // Colours were stored un-premultiplied (alpha is 0 or 1 per sub-pixel), so the sum over the
        // covered sub-pixels is already the premultiplied value.
        out[o] = Math.round((b / area) * 255);
        out[o + 1] = Math.round((g / area) * 255);
        out[o + 2] = Math.round((r / area) * 255);
        out[o + 3] = Math.round((a / area) * 255);
      }
    }
    return out;
  }
}

// ---------- Shapes: each is a coverage test ----------

type Cover = (x: number, y: number) => boolean;
/** [left, top, right, bottom] in canvas units: where a shape can possibly be, so nothing else is tested. */
type Box = readonly [number, number, number, number];

const around = (cx: number, cy: number, r: number): Box => [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1];

/** Signed distance to a rounded rectangle (negative inside). */
function sdRoundRect(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const roundRectFill = (x: number, y: number, w: number, h: number, r: number): Cover => (px, py) => sdRoundRect(px, py, x, y, w, h, r) <= 0;
const roundRectStroke = (x: number, y: number, w: number, h: number, r: number, lw: number): Cover => (px, py) => Math.abs(sdRoundRect(px, py, x, y, w, h, r)) <= lw / 2;
const circle = (cx: number, cy: number, r: number): Cover => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** A polyline with round caps and joins, `lw` wide. */
function strokePath(points: ReadonlyArray<readonly [number, number]>, lw: number): Cover {
  const half = lw / 2;
  return (px, py) => {
    for (let i = 0; i + 1 < points.length; i++) {
      if (distToSegment(px, py, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]) <= half) return true;
    }
    return false;
  };
}

const any = (...covers: Cover[]): Cover => (x, y) => covers.some((c) => c(x, y));

// ---------- Digits ----------
//
// The countdown is a handful of characters: 0–9 and the "ч" of hours. They are drawn as strokes in a
// unit box (width GLYPH_W, height 1, y down), then scaled to the font size the canvas version used.

const GLYPH_W = 0.6;
type Pt = [number, number];

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 14): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

const flip = (path: Pt[]): Pt[] => path.map(([x, y]) => [GLYPH_W - x, 1 - y]);

const SIX: Pt[][] = [
  [[0.5, 0.0], [0.3, 0.04], [0.1, 0.22], [0.02, 0.5], [0.02, 0.72]],
  arc(0.3, 0.7, 0.28, 0.3, 0, 360, 20),
];

const GLYPHS: Record<string, Pt[][]> = {
  '0': [arc(0.3, 0.5, 0.28, 0.5, 0, 360, 24)],
  '1': [[[0.08, 0.22], [0.36, 0.0], [0.36, 1.0]]],
  '2': [[...arc(0.3, 0.27, 0.27, 0.27, 195, 400, 12), [0.02, 1.0], [0.58, 1.0]]],
  '3': [arc(0.29, 0.25, 0.25, 0.25, 205, 450, 12), arc(0.3, 0.74, 0.28, 0.26, 270, 515, 12)],
  '4': [[[0.46, 0.0], [0.0, 0.7], [0.6, 0.7]], [[0.46, 0.0], [0.46, 1.0]]],
  '5': [[[0.54, 0.0], [0.08, 0.0], [0.04, 0.44]], arc(0.29, 0.72, 0.29, 0.28, 235, 505, 14)],
  '6': SIX,
  '7': [[[0.0, 0.0], [0.58, 0.0], [0.2, 1.0]]],
  '8': [arc(0.3, 0.25, 0.24, 0.25, 0, 360, 18), arc(0.3, 0.74, 0.29, 0.26, 0, 360, 18)],
  '9': SIX.map(flip),
  // Cyrillic "ч": a short left stem that bends into the right stem, which runs the full height.
  'ч': [[[0.04, 0.3], [0.04, 0.52], [0.12, 0.66], [0.3, 0.72], [0.56, 0.66]], [[0.56, 0.3], [0.56, 1.0]]],
};

/** The width a glyph advances, in glyph units (a little more than the glyph itself). */
const ADVANCE = GLYPH_W + 0.2;

/** Strokes `text` centred on (cx, cy), `height` canvas units tall, shrunk to fit `maxWidth`. */
function textCover(text: string, cx: number, cy: number, height: number, stroke: number, maxWidth: number): { cover: Cover; box: Box } | undefined {
  const chars = [...text].filter((c) => GLYPHS[c]);
  if (chars.length === 0) return undefined;
  const natural = (chars.length * ADVANCE - (ADVANCE - GLYPH_W)) * height;
  const k = natural > maxWidth ? maxWidth / natural : 1;
  const h = height * k;
  const w = (chars.length * ADVANCE - (ADVANCE - GLYPH_W)) * h;
  const left = cx - w / 2;
  const top = cy - h / 2;
  const covers: Cover[] = [];
  chars.forEach((c, i) => {
    // "ч" is a lowercase letter: its top is at x-height, which the glyph already encodes (its box starts lower).
    const ox = left + i * ADVANCE * h;
    for (const path of GLYPHS[c]) covers.push(strokePath(path.map(([x, y]) => [ox + x * h, top + y * h] as [number, number]), stroke * k));
  });
  const pad = stroke * k + 1;
  return { cover: any(...covers), box: [left - pad, top - pad, left + w + pad, top + h + pad] };
}

// ---------- The icon ----------

/**
 * One 32×32 frame as premultiplied BGRA. `frame: 'pulse'` is the second picture of the "starts any
 * moment" pulse: the same icon hollowed out (outline and digits in the accent colour, no fill), so the
 * shape and the number stay readable in both frames and only the weight changes.
 */
export function drawTrayBitmap(p: TrayPresentation, taskbarLight: boolean, frame: 'base' | 'pulse' = 'base'): Buffer {
  const c = new Canvas();
  const ink: Rgb = taskbarLight ? [0x1b, 0x1b, 0x1b] : WHITE;
  const kind = p.kind;
  const accent: Rgb | undefined =
    kind === 'imminent' ? COLORS.imminent : kind === 'inMeeting' ? COLORS.inMeeting : kind === 'overlap' ? COLORS.overlap : kind === 'soon' ? COLORS.soon : undefined;
  const filled = !!accent && frame === 'base';

  // Calendar page.
  const x = 3;
  const y = 5;
  const w = 26;
  const h = 24;
  const page: Box = [x - 2, y - 2, x + w + 2, y + h + 2];
  if (filled) c.paint(roundRectFill(x, y, w, h, 4), accent, page);
  c.paint(roundRectStroke(x, y, w, h, 4, 2.4), accent ?? ink, page);
  if (!accent) c.paint(strokePath([[x, y + 7], [x + w, y + 7]], 2.4), ink, [x - 2, y + 5, x + w + 2, y + 9]);

  // Rings. The right one lies under the invitation dot, which clears that corner: skipped, not left peeking out.
  const ringColor: Rgb = filled ? WHITE : (accent ?? ink);
  for (const rx of p.invites > 0 ? [10] : [10, 22]) c.paint(strokePath([[rx, 2], [rx, 8]], 2.6), ringColor, [rx - 2.5, 0, rx + 2.5, 10]);

  const text = p.badge ?? '';
  if (accent && text) {
    // 16 px type for one or two characters, 12 px for three: the same sizes the canvas version used.
    const big = text.length <= 2;
    const t = textCover(text, x + w / 2, y + h / 2 + (big ? 2.1 : 1.8), big ? 11.6 : 8.8, big ? 2.5 : 2.0, w - 4);
    if (t) c.paint(t.cover, filled ? WHITE : accent, t.box);
  } else if (kind === 'idle' || kind === 'tomorrow' || kind === 'later') {
    // A dot for "something is coming", no number to read.
    c.paint(circle(x + w / 2, y + 16, 3.2), ink, around(x + w / 2, y + 16, 3.2));
  }

  if (p.invites > 0) {
    // The ring around the dot is erased first (not painted), so it stands apart from the page edge on a
    // light and on a dark taskbar alike.
    c.erase(circle(25.5, 6.5, 7.2), around(25.5, 6.5, 7.2));
    c.paint(circle(25.5, 6.5, 5.5), INVITE_DOT, around(25.5, 6.5, 5.5));
  }
  return c.bgra();
}
