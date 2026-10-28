import { PgBoss } from "pg-boss";
import { directDatabaseUrl } from "../config/env.js";
import { logger } from "../lib/logger.js";

/** pg-boss owns this schema. Prisma's DATABASE_URL is pinned to `public`, so migrations never see it. */
export const PGBOSS_SCHEMA = "pgboss";

export const QUEUES = {
  extractProfile: "resume.extract-profile",
  searchRun: "search.run",
} as const;

export interface ExtractProfileJob {
  resumeId: string;
}

export interface SearchRunJob {
  searchRunId: string;
}

function connectionStringWithoutPrismaParams(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("schema");
  return u.toString();
}

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

/**
 * Lazily started pg-boss singleton. The API process only sends jobs, so it runs
 * without supervision/scheduling; the worker process passes `{ worker: true }`.
 */
export function getBoss(opts: { worker?: boolean } = {}): Promise<PgBoss> {
  if (instance) return Promise.resolve(instance);
  starting ??= (async () => {
    const boss = new PgBoss({
      // Direct endpoint: pg-boss needs session-level features a transaction pooler doesn't provide.
      connectionString: connectionStringWithoutPrismaParams(directDatabaseUrl),
      schema: PGBOSS_SCHEMA,
      supervise: opts.worker ?? false,
      schedule: opts.worker ?? false,
    });
    boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
    await boss.start();
    await boss.createQueue(QUEUES.extractProfile, {
      retryLimit: 2,
      retryDelay: 10,
      retryBackoff: true,
      expireInSeconds: 300,
    });
    // Never retried: a retry would re-send every Serper query and spend the credits again.
    await boss.createQueue(QUEUES.searchRun, { retryLimit: 0, expireInSeconds: 1800 });
    instance = boss;
    return boss;
  })();
  return starting;
}

export async function stopBoss(): Promise<void> {
  if (instance) await instance.stop({ graceful: true });
  instance = null;
  starting = null;
}
