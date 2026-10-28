import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { logger } from "./lib/logger.js";
import { stopBoss } from "./queue/boss.js";

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down API");
  server.close();
  await stopBoss();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
