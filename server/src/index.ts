import { env } from "./config/env.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { logger } from "./lib/logger.js";
import { closeRedis } from "./lib/redis.js";
import { createApp } from "./app.js";
import { eventHub } from "./queue/events.js";
import { closeQueues } from "./queue/queues.js";

async function main(): Promise<void> {
  await connectMongo();
  const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT }, "API listening"));
  // SSE connections stay open; don't let the default timeouts cut them.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down API");
    server.closeAllConnections();
    server.close();
    await Promise.allSettled([eventHub.close(), closeQueues(), closeRedis(), disconnectMongo()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "API failed to start");
  process.exit(1);
});
