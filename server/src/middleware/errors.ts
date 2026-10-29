import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { APIError as OpenAIError } from "openai";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function zodIssues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function parseOr400<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", zodIssues(r.error));
  return r.data;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.issues ? { issues: err.issues } : {}) });
    return;
  }
  if (err instanceof MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: status === 413 ? `File is larger than ${env.MAX_UPLOAD_MB} MB` : err.message });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Malformed JSON" });
    return;
  }
  if (err instanceof OpenAIError) {
    logger.error({ status: err.status, code: err.code, userId: req.user ? String(req.user._id) : undefined }, "openai request failed");
    const msg = err.status === 401 ? "The AI service rejected our API key (check OPENAI_API_KEY)" : err.status === 429 ? "The AI service is rate limited, try again shortly" : "The AI service failed, try again";
    res.status(502).json({ error: msg });
    return;
  }
  logger.error({ err, userId: req.user ? String(req.user._id) : undefined, reqId: req.id }, "unhandled error");
  res.status(500).json({ error: "Something went wrong" });
}
