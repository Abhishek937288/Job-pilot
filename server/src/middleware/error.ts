import type { ApiErrorBody } from "@jobpilot/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

function body(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("NOT_FOUND", "Route not found"));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(body(err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json(body("VALIDATION_ERROR", "Invalid request", err.issues));
    return;
  }
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json(body("FILE_TOO_LARGE", `File is larger than the ${env.MAX_UPLOAD_MB} MB limit`));
      return;
    }
    res.status(400).json(body("UPLOAD_ERROR", err.message));
    return;
  }
  // express.json() parse errors carry a status and type
  if (err instanceof SyntaxError && "status" in err && err.status === 400) {
    res.status(400).json(body("INVALID_JSON", "Malformed JSON body"));
    return;
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, "unhandled error");
  res.status(500).json(body("INTERNAL", "Something went wrong"));
};
