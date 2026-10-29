import { env } from "../config/env.js";
import type { UserDoc } from "../db/models/user.js";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";

const day = () => new Date().toISOString().slice(0, 10);
const key = (userId: string) => `quota:search:${userId}:${day()}`;

export function dailySearchLimit(user: UserDoc): number {
  return user.isGuest ? env.GUEST_DAILY_SEARCH_QUOTA : env.DAILY_SEARCH_QUOTA;
}

export async function searchesUsedToday(userId: string): Promise<number> {
  try {
    return Number((await redis().get(key(userId))) ?? 0);
  } catch {
    return 0;
  }
}

/** Takes one search from today's quota (UTC day), or throws 429. Controls OpenAI and JSearch spend. */
export async function consumeSearch(user: UserDoc): Promise<void> {
  const limit = dailySearchLimit(user);
  const k = key(String(user._id));
  let used: number;
  try {
    used = await redis().incr(k);
    if (used === 1) await redis().expire(k, 2 * 86_400);
  } catch (err) {
    // Without Redis the queue doesn't work either; refuse rather than run unmetered.
    logger.error({ err }, "quota check failed");
    throw new HttpError(503, "Search is temporarily unavailable");
  }
  if (used > limit) {
    await redis().decr(k).catch(() => undefined);
    throw new HttpError(429, `Daily search limit reached (${limit} per day). Try again tomorrow.`);
  }
}

/** Gives a search back when the run could not be started. */
export async function refundSearch(userId: string): Promise<void> {
  await redis().decr(key(userId)).catch(() => undefined);
}
