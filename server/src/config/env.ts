import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// The repo-root .env is shared by the API, the worker and the scripts. npm workspace scripts run with
// cwd = server/, so look in the cwd first and then one level up. Tests configure env themselves.
if (process.env.NODE_ENV !== "test") {
  const path = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")].find((p) => existsSync(p));
  if (path) loadDotenv({ path, quiet: true });
}

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");
const csv = z.string().transform((s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);
const optionalString = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

const DEFAULT_WEB_SEARCH_DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
].join(",");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Origin of the web app. Used for the Origin check, OAuth redirects and links. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z.string().default("loopback"),

  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/jobpilot"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(7),
  GUEST_ENABLED: bool.default(true),
  GUEST_TTL_DAYS: z.coerce.number().positive().default(7),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /** Must be registered in the Google console. Defaults to the web origin's proxied callback. */
  GOOGLE_REDIRECT_URI: optionalString,

  MAX_PROFILES_PER_USER: z.coerce.number().int().positive().default(5),
  DAILY_SEARCH_QUOTA: z.coerce.number().int().nonnegative().default(20),
  GUEST_DAILY_SEARCH_QUOTA: z.coerce.number().int().nonnegative().default(5),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL_CHEAP: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_MODEL_STRONG: z.string().min(1).default("gpt-4o"),
  OPENAI_MODEL_WEB_SEARCH: z.string().min(1).default("gpt-4o-mini"),
  /** USD per 1M tokens, used only for the cost estimate. */
  PRICE_CHEAP_INPUT_PER_M: z.coerce.number().nonnegative().default(0.15),
  PRICE_CHEAP_OUTPUT_PER_M: z.coerce.number().nonnegative().default(0.6),
  PRICE_STRONG_INPUT_PER_M: z.coerce.number().nonnegative().default(2.5),
  PRICE_STRONG_OUTPUT_PER_M: z.coerce.number().nonnegative().default(10),
  WEB_SEARCH_COST_PER_CALL: z.coerce.number().nonnegative().default(0.025),
  RANK_BATCH_SIZE: z.coerce.number().int().min(1).max(25).default(10),
  /** Hard cap on jobs sent to the ranking model per run (highest pre-scores first). */
  RANK_MAX_JOBS: z.coerce.number().int().min(1).max(500).default(60),
  /** Top results whose explanation is rewritten by the strong model. 0 disables it. */
  EXPLAIN_TOP_N: z.coerce.number().int().min(0).max(25).default(10),

  JSEARCH_API_KEY: optionalString,
  JSEARCH_BASE_URL: z.url().default("https://jsearch.p.rapidapi.com"),
  JSEARCH_SEARCH_PATH: z.string().startsWith("/").default("/search-v2"),
  /** Sent as x-rapidapi-host. Leave empty for providers that use x-api-key instead. */
  JSEARCH_HOST: z.string().default("jsearch.p.rapidapi.com"),
  JSEARCH_DATE_POSTED: z.enum(["all", "today", "3days", "week", "month"]).default("month"),
  JSEARCH_COST_PER_REQUEST: z.coerce.number().nonnegative().default(0.0025),
  JSEARCH_CACHE_HOURS: z.coerce.number().nonnegative().default(6),

  WEB_SEARCH_ENABLED: bool.default(true),
  /** Run OpenAI web_search when fewer than this many jobs survive pre-filtering. */
  WEB_SEARCH_MIN_RESULTS: z.coerce.number().int().nonnegative().default(10),
  WEB_SEARCH_MAX_JOBS: z.coerce.number().int().min(1).max(30).default(10),
  WEB_SEARCH_DOMAINS: csv.prefault(DEFAULT_WEB_SEARCH_DOMAINS),

  WATCHLIST_REFRESH_HOURS: z.coerce.number().positive().default(6),
  JOB_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  HTTP_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1000),
  HTTP_USER_AGENT: z.string().default("JobPilotBot/0.1 (+personal job search assistant)"),
  SEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),

  MAX_UPLOAD_MB: z.coerce.number().positive().max(10).default(5),
  /** Fewer non-whitespace characters than this means the PDF is scanned or image-only. */
  RESUME_MIN_TEXT_CHARS: z.coerce.number().int().nonnegative().default(200),
  RESUME_MAX_TEXT_CHARS: z.coerce.number().int().positive().default(30_000),
  VISION_FALLBACK_ENABLED: bool.default(true),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    // Logger depends on env, so this is the one place that writes to stderr directly.
    console.error(`Invalid configuration (see .env.example):\n${lines.join("\n")}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();

export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = env.GOOGLE_REDIRECT_URI ?? `${env.WEB_ORIGIN}/api/auth/google/callback`;
