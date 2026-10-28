import express from "express";
import { env } from "./config/env.js";
import { requireSession } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter } from "./routes/auth.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { resumeRouter } from "./routes/resume.routes.js";
import { atsCompanyRouter, jobsRouter, searchRunRouter } from "./routes/search.routes.js";

function trustProxySetting(v: string): boolean | number | string {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxySetting(env.TRUST_PROXY));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Everything is mounted under /api so the Next.js rewrite can pass paths through unchanged.
  app.use("/api/auth", authRouter);
  app.use("/api/resumes", requireSession, resumeRouter);
  app.use("/api/profile", requireSession, profileRouter);
  app.use("/api/search-runs", requireSession, searchRunRouter);
  app.use("/api/jobs", requireSession, jobsRouter);
  app.use("/api/ats-companies", requireSession, atsCompanyRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
