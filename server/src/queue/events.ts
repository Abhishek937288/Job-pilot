import type { Redis } from "ioredis";
import type { ServerEvent } from "@jobpilot/shared";
import { logger } from "../lib/logger.js";
import { createRedis, redis } from "../lib/redis.js";

/** Each user has a private channel. Nothing is ever published on a shared channel. */
export const userChannel = (userId: string) => `user:${userId}`;

export async function publishToUser(userId: string, event: ServerEvent): Promise<void> {
  try {
    await redis().publish(userChannel(userId), JSON.stringify(event));
  } catch (err) {
    // Streaming is best effort; the data is already saved and the page reloads it.
    logger.warn({ err, userId, type: event.type }, "event publish failed");
  }
}

type Listener = (payload: string) => void;

/**
 * One Redis subscriber per API process, fanned out to the SSE connections of each user.
 * A user's channel is subscribed while at least one of their connections is open.
 */
class EventHub {
  private sub: Redis | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  private client(): Redis {
    if (!this.sub) {
      this.sub = createRedis("events:sub");
      this.sub.on("message", (channel: string, payload: string) => {
        for (const l of this.listeners.get(channel) ?? []) l(payload);
      });
    }
    return this.sub;
  }

  async subscribe(userId: string, listener: Listener): Promise<() => Promise<void>> {
    const channel = userChannel(userId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.client().subscribe(channel);
    }
    set.add(listener);
    return async () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(channel);
        await this.client().unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    await this.sub?.quit().catch(() => undefined);
    this.sub = null;
  }
}

export const eventHub = new EventHub();
