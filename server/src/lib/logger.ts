import { pino } from "pino";
import { env } from "../config/env.js";

/**
 * Logs carry userId and request ids, never resume text: the redact list covers the fields that could
 * hold it if someone logged a whole object by mistake.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "text", "resumeText", "*.text", "*.resumeText", "password", "*.password"],
    censor: "[redacted]",
  },
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } : undefined,
});
