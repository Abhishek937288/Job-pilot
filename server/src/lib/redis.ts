import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/** A new connection. BullMQ workers and pub/sub subscribers each need their own. */
export function createRedis(name: string): Redis {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, connectionName: `jobpilot:${name}` });
  client.on("error", (err) => logger.warn({ err: err.message, redis: name }, "redis error"));
  return client;
}

let shared: Redis | null = null;

/** Shared connection for caches, quotas and publishing events. */
export function redis(): Redis {
  shared ??= createRedis("shared");
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) await shared.quit().catch(() => undefined);
  shared = null;
}

/** JSON cache helpers. A Redis failure degrades to a cache miss, never to a failed request. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const v = await redis().get(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch (err) {
    logger.warn({ err, key }, "cache read failed");
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  try {
    await redis().set(key, JSON.stringify(value), "EX", Math.round(ttlSeconds));
  } catch (err) {
    logger.warn({ err, key }, "cache write failed");
  }
}
