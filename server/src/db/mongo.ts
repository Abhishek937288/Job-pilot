import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

mongoose.set("strictQuery", true);

export async function connectMongo(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  // Build indexes (unique, TTL, text) at startup; cheap when they already exist.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  logger.info({ db: mongoose.connection.name }, "mongo connected");
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
