// A cap on how often a renderer may make the main process call the server. The renderer is our own
// code, but a page that loops (or a bug) must not turn into a flood of requests to Exchange.

export class RequestGate {
  private starts: number[] = [];
  private running = 0;

  constructor(
    private readonly maxConcurrent = 1,
    private readonly maxPerWindow = 30,
    private readonly windowMs = 10 * 60_000,
  ) {}

  /** Lets one request begin and returns what to call when it ends, or throws when the caps are reached. */
  enter(now = Date.now()): () => void {
    this.starts = this.starts.filter((t) => now - t < this.windowMs);
    if (this.running >= this.maxConcurrent) throw new Error('Предыдущий запрос ещё выполняется');
    if (this.starts.length >= this.maxPerWindow) {
      const wait = Math.max(1, Math.ceil((this.starts[0] + this.windowMs - now) / 1000));
      throw new Error(`Слишком много запросов к серверу — подождите ${wait} с`);
    }
    this.running += 1;
    this.starts.push(now);
    let done = false;
    return () => {
      if (!done) {
        done = true;
        this.running -= 1;
      }
    };
  }
}
