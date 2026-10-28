import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../src/lib/rate-limiter.js";

describe("SlidingWindowLimiter", () => {
  it("blocks after maxHits within the window and unblocks after it slides", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(5, 15 * 60_000, () => now);

    for (let i = 0; i < 5; i++) {
      expect(limiter.retryAfterMs("ip")).toBe(0);
      limiter.hit("ip");
      now += 1_000;
    }
    expect(limiter.retryAfterMs("ip")).toBeGreaterThan(0);
    expect(limiter.retryAfterMs("other-ip")).toBe(0);

    now = 15 * 60_000 + 1; // first hit (t=0) has left the window
    expect(limiter.retryAfterMs("ip")).toBe(0);
  });

  it("reset clears a key", () => {
    const limiter = new SlidingWindowLimiter(1, 60_000);
    limiter.hit("ip");
    expect(limiter.retryAfterMs("ip")).toBeGreaterThan(0);
    limiter.reset("ip");
    expect(limiter.retryAfterMs("ip")).toBe(0);
  });
});
