/**
 * In-memory sliding-window limiter keyed by e.g. client IP. Single process, single user:
 * good enough to blunt password guessing; resets on restart.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Returns ms until the key may try again, or 0 if not blocked. */
  retryAfterMs(key: string): number {
    const list = this.recent(key);
    if (list.length < this.maxHits) return 0;
    const oldest = list[0] ?? this.now();
    return Math.max(0, oldest + this.windowMs - this.now());
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Drop expired entries; call periodically. */
  sweep(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}
