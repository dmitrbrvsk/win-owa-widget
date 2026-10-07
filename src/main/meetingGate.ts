// The gate every "create meeting" request passes in the main process, in this order:
//   1. one request at a time (a double click or a flooding page is refused, not queued);
//   2. validation of everything the window sent (`parseCreateMeeting`);
//   3. rate limits (meetings and recipients per hour);
//   4. a native confirmation built from the validated data, when invitations would go out: the page
//      cannot click it, so a compromised window cannot send invitations by itself;
//   5. only then the server is called.
// It has no Electron imports: the dialog and the delivery are handed in, so the order above is tested.
import type { CreateMeetingInput, CreateMeetingResult } from '../shared/types';
import { parseCreateMeeting } from '../shared/validate';

/** At most this many meetings, and this many recipients in all, are sent per hour, whatever the window asks. */
export const MAX_MEETINGS_PER_HOUR = 10;
export const MAX_RECIPIENTS_PER_HOUR = 300;
/** A page that keeps asking cannot keep a dialog in the person's face either: this many questions per ten minutes. */
export const MAX_PROMPTS_PER_10_MIN = 12;
const HOUR_MS = 3_600_000;
const TEN_MIN_MS = 600_000;

/** Counts what happened within the last `windowMs`; `cost` lets one entry weigh more than one (recipients). */
export class SlidingWindow {
  private entries: Array<{ at: number; cost: number }> = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private prune(now: number) {
    this.entries = this.entries.filter((e) => now - e.at < this.windowMs);
  }

  used(now: number): number {
    this.prune(now);
    return this.entries.reduce((a, e) => a + e.cost, 0);
  }

  /** Whether `cost` more would stay within the limit. Does not count anything. */
  allows(now: number, cost = 1): boolean {
    return this.used(now) + cost <= this.limit;
  }

  take(now: number, cost = 1) {
    this.prune(now);
    this.entries.push({ at: now, cost });
  }
}

/** One thing to do once it has been validated: who would be told, how to ask, and how to do it. */
export interface Operation {
  /** How many people the server would mail. 0 means no confirmation is needed. */
  recipients: number;
  confirm(): Promise<boolean>;
  deliver(): Promise<CreateMeetingResult>;
}

export interface GateDeps {
  /** Shows the native dialog for what will be sent; true only when the person pressed "Send". */
  confirm(meeting: CreateMeetingInput): Promise<boolean>;
  /** Talks to the server. Called only after validation, limits and (when needed) confirmation. */
  deliver(meeting: CreateMeetingInput): Promise<void>;
  now?: () => number;
}

export class MeetingGate {
  private busy = false;
  private readonly meetings = new SlidingWindow(MAX_MEETINGS_PER_HOUR, HOUR_MS);
  private readonly recipients = new SlidingWindow(MAX_RECIPIENTS_PER_HOUR, HOUR_MS);
  private readonly prompts = new SlidingWindow(MAX_PROMPTS_PER_10_MIN, TEN_MIN_MS);

  constructor(private readonly deps: GateDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private checkLimits(count: number) {
    const now = this.now();
    if (!this.meetings.allows(now)) throw new Error(`Слишком много встреч за час (не больше ${MAX_MEETINGS_PER_HOUR}). Подождите немного`);
    if (!this.recipients.allows(now, count)) throw new Error(`Слишком много приглашений за час (не больше ${MAX_RECIPIENTS_PER_HOUR} получателей). Подождите немного`);
  }

  async submit(raw: unknown): Promise<CreateMeetingResult> {
    return this.run(async () => {
      const meeting = parseCreateMeeting(raw, new Date(this.now()));
      const count = meeting.requiredAttendees.length + meeting.optionalAttendees.length;
      return {
        recipients: count,
        confirm: () => this.deps.confirm(meeting),
        deliver: async () => {
          await this.deps.deliver(meeting);
          return { status: 'created', invited: count } as CreateMeetingResult;
        },
      };
    });
  }

  /**
   * Every operation that can put mail in other people's mailboxes — creating, changing, calling off —
   * goes through this one path, in this order:
   *   1. one at a time (a double click or a looping page is refused, not queued);
   *   2. `prepare` validates what the window sent and looks up whatever else is needed, inside the lock;
   *   3. rate limits;
   *   4. the native confirmation, when anyone would be told;
   *   5. the limits again, because the dialog was open for a while, and only then the server call.
   */
  async run(prepare: () => Promise<Operation>): Promise<CreateMeetingResult> {
    if (this.busy) throw new Error('Предыдущий запрос ещё выполняется — дождитесь ответа');
    this.busy = true;
    try {
      const op = await prepare();
      const count = op.recipients;
      this.checkLimits(count);
      // Nobody to tell: the change stays in the person's own calendar, so there is nothing to confirm.
      if (count > 0) {
        if (!this.prompts.allows(this.now())) throw new Error('Слишком много запросов на отправку — подождите несколько минут');
        this.prompts.take(this.now());
        if (!(await op.confirm())) return { status: 'cancelled' };
      }
      // Time passed while the dialog was open: the limits are checked again, and from here the send counts.
      this.checkLimits(count);
      this.meetings.take(this.now());
      this.recipients.take(this.now(), count);
      return await op.deliver();
    } finally {
      this.busy = false;
    }
  }
}
