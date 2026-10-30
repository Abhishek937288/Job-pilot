import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { connectMongo } from "./db/mongo.js";
import { logger } from "./lib/logger.js";
import { loadSession, requireUser } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { ipLimiter, originCheck, userLimiter } from "./middleware/security.js";
import { authRouter } from "./routes/auth.js";
import { companiesRouter } from "./routes/companies.js";
import { eventsRouter } from "./routes/events.js";
import { jobsRouter } from "./routes/jobs.js";
import { profilesRouter } from "./routes/profiles.js";

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY === "true" ? true : /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
  app.disable("x-powered-by");

  // On Vercel the public `/api/*` path reaches this service as-is; locally Next.js strips the prefix.
  // Accept both so the routes below stay mounted at the root.
  app.use((req, _res, next) => {
    if (req.url === "/api" || req.url.startsWith("/api/") || req.url.startsWith("/api?")) req.url = req.url.slice(4) || "/";
    next();
  });
  // Serverless: there is no startup hook, so connect on first use (a no-op once connected).
  if (process.env.VERCEL) app.use((_req, _res, next) => void connectMongo().then(() => next(), next));

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
      // Request ids and user ids only: no bodies (resumes) and no cookies.
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
      customProps: (req) => ({ userId: (req as express.Request).user ? String((req as express.Request).user!._id) : undefined }),
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/events" },
    }),
  );
  app.use(ipLimiter);
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(originCheck);
  app.use(loadSession);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/auth", authRouter);
  app.use("/events", requireUser, eventsRouter);
  app.use(requireUser, userLimiter);
  app.use("/profiles", profilesRouter);
  app.use("/companies", companiesRouter);
  app.use("/", jobsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
