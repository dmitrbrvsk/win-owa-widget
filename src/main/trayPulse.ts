// The "meeting starts any moment" pulse of the tray icon. A Windows tray icon cannot animate, so the
// renderer draws two frames once and this swaps them with a single timer. The timer exists only while
// the pulse runs (at most two minutes before a meeting); otherwise nothing ticks and idle CPU is zero.

/** One swap every 700 ms: slow enough to stay calm, well under the 3 flashes a second that accessibility guidance warns about. */
export const PULSE_INTERVAL_MS = 700;
/** Whatever the page says, a pulse never lasts longer than this: IMMINENT_MINUTES plus a margin. */
export const MAX_PULSE_MS = 150_000;

export interface PulseHost {
  /** Puts frame 0 (the normal icon) or frame 1 (the alternate one) in the tray. */
  show(frame: 0 | 1): void;
  /** False when the person asked Windows for fewer animations. Asked before the first swap and on every one. */
  allowed?(): boolean;
  now?(): number;
}

export class TrayPulse {
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame: 0 | 1 = 0;
  private until = 0;

  constructor(private readonly host: PulseHost) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Starts swapping frames until `untilMs` (clamped to MAX_PULSE_MS from now). Returns whether it
   * runs: not when the end is already past or animations are off. Any earlier pulse is replaced
   * without touching the tray, because the caller has just put its frame 0 there.
   */
  start(untilMs: number): boolean {
    this.stop();
    const now = this.now();
    this.until = Math.min(untilMs, now + MAX_PULSE_MS);
    if (!(this.until > now) || !this.isAllowed()) return false;
    this.timer = setInterval(() => this.tick(), PULSE_INTERVAL_MS);
    return true;
  }

  /** Stops the timer and forgets the pulse; leaves the picture in the tray as it is. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.frame = 0;
  }

  private tick(): void {
    if (this.now() >= this.until || !this.isAllowed()) {
      const wasAlternate = this.frame === 1;
      this.stop();
      if (wasAlternate) this.host.show(0); // back to the normal icon
      return;
    }
    this.frame = this.frame === 0 ? 1 : 0;
    this.host.show(this.frame);
  }

  private now(): number {
    return this.host.now ? this.host.now() : Date.now();
  }

  private isAllowed(): boolean {
    return this.host.allowed ? this.host.allowed() : true;
  }
}
