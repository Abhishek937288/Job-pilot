import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { Company } from "./db/models/company.js";
import { SearchRun } from "./db/models/searchRun.js";
import { logger } from "./lib/logger.js";
import { closeRedis, createRedis } from "./lib/redis.js";
import { runSearchPipeline } from "./pipeline/searchPipeline.js";
import { closeQueues, enqueueCompanyRefresh, QUEUES, scheduleWatchlistRefresh, type SearchJobData, type WatchlistJobData } from "./queue/queues.js";
import { refreshCompany } from "./watchlist/companies.js";

async function main(): Promise<void> {
  await connectMongo();

  // Runs left "running" by a crashed worker can't resume: close them so the user can start again.
  const stale = await SearchRun.updateMany(
    { status: "running", startedAt: { $lt: new Date(Date.now() - 30 * 60_000) } },
    { $set: { status: "failed", error: "Interrupted (worker restarted)", finishedAt: new Date() } },
  );
  if (stale.modifiedCount) logger.warn({ count: stale.modifiedCount }, "marked interrupted runs as failed");

  const search = new Worker<SearchJobData>(
    QUEUES.search,
    async (job) => {
      await runSearchPipeline(job.data);
    },
    { connection: createRedis("worker:search"), concurrency: env.SEARCH_CONCURRENCY },
  );

  const watchlist = new Worker<WatchlistJobData>(
    QUEUES.watchlist,
    async (job) => {
      if (job.data.kind === "refresh-company") {
        await refreshCompany(job.data.companyId);
        return;
      }
      // Fan out one job per company so one slow or broken board doesn't hold up the rest.
      const companies = await Company.find({}, { _id: 1 });
      for (const c of companies) await enqueueCompanyRefresh(String(c._id));
      logger.info({ companies: companies.length }, "watchlist refresh queued");
    },
    { connection: createRedis("worker:watchlist"), concurrency: 3 },
  );

  for (const w of [search, watchlist]) {
    w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"));
  }
  await scheduleWatchlistRefresh();
  logger.info({ queues: Object.values(QUEUES), refreshHours: env.WATCHLIST_REFRESH_HOURS }, "worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down worker");
    await Promise.allSettled([search.close(), watchlist.close()]);
    await Promise.allSettled([closeQueues(), closeRedis(), disconnectMongo()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
