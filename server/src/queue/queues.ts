import { Queue } from "bullmq";
import { env } from "../config/env.js";
import { createRedis } from "../lib/redis.js";

export const QUEUES = { search: "search", watchlist: "watchlist" } as const;

/** Payloads carry userId so the worker can re-check ownership before writing. */
export interface SearchJobData {
  userId: string;
  profileId: string;
  runId: string;
}

export type WatchlistJobData = { kind: "refresh-all" } | { kind: "refresh-company"; companyId: string };

let searchQueue: Queue<SearchJobData> | null = null;
let watchlistQueue: Queue<WatchlistJobData> | null = null;

export function getSearchQueue(): Queue<SearchJobData> {
  searchQueue ??= new Queue<SearchJobData>(QUEUES.search, {
    connection: createRedis("queue:search"),
    defaultJobOptions: {
      // The pipeline records its own failures on the run; the user re-runs from the UI.
      attempts: 1,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });
  return searchQueue;
}

export function getWatchlistQueue(): Queue<WatchlistJobData> {
  watchlistQueue ??= new Queue<WatchlistJobData>(QUEUES.watchlist, {
    connection: createRedis("queue:watchlist"),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  });
  return watchlistQueue;
}

export async function enqueueSearch(data: SearchJobData): Promise<void> {
  await getSearchQueue().add("search", data, { jobId: `run-${data.runId}` });
}

export async function enqueueCompanyRefresh(companyId: string): Promise<void> {
  // De-duplicate refreshes of the same company that are still waiting.
  await getWatchlistQueue().add("refresh-company", { kind: "refresh-company", companyId }, { jobId: `company-${companyId}-${Math.floor(Date.now() / 60_000)}` });
}

/** The repeatable job that refreshes the whole watchlist every WATCHLIST_REFRESH_HOURS. */
export async function scheduleWatchlistRefresh(): Promise<void> {
  await getWatchlistQueue().upsertJobScheduler(
    "refresh-all",
    { every: Math.round(env.WATCHLIST_REFRESH_HOURS * 3_600_000) },
    { name: "refresh-all", data: { kind: "refresh-all" } },
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([searchQueue?.close(), watchlistQueue?.close()]);
  searchQueue = null;
  watchlistQueue = null;
}
