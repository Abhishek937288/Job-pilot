import { prisma } from "./db/prisma.js";
import { logger } from "./lib/logger.js";
import { getBoss, QUEUES, stopBoss, type ExtractProfileJob, type SearchRunJob } from "./queue/boss.js";
import { extractProfileForResume, markExtractionFailed } from "./services/profile.service.js";
import { executeSearchRun, failInterruptedRuns } from "./services/search-run.service.js";

async function main(): Promise<void> {
  const boss = await getBoss({ worker: true });

  const opts = { includeMetadata: true } as const;
  await boss.work<ExtractProfileJob, void, typeof opts>(QUEUES.extractProfile, opts, async (jobs) => {
    for (const job of jobs) {
      try {
        await extractProfileForResume(job.data.resumeId);
      } catch (err) {
        logger.error({ err, jobId: job.id, retryCount: job.retryCount }, "extract-profile job failed");
        if (job.retryCount >= job.retryLimit) await markExtractionFailed(job.data.resumeId, err);
        throw err;
      }
    }
  });

  const interrupted = await failInterruptedRuns();
  if (interrupted) logger.warn({ interrupted }, "marked interrupted search runs as FAILED");

  await boss.work<SearchRunJob>(QUEUES.searchRun, async (jobs) => {
    for (const job of jobs) {
      logger.info({ searchRunId: job.data.searchRunId }, "search run started");
      await executeSearchRun(job.data.searchRunId);
      logger.info({ searchRunId: job.data.searchRunId }, "search run finished");
    }
  });

  logger.info({ queues: Object.values(QUEUES) }, "worker started");
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down worker");
  await stopBoss();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err: unknown) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
