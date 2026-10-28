import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

// Single PrismaClient per process; cached on globalThis so `tsx watch` reloads don't leak pools.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }, { schema: "public" }),
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
