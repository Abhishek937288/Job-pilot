import { z } from "zod";
import { loadEnvFiles } from "./load-env-files.js";

loadEnvFiles();

function publicSchemaUrl(name: string) {
  return z
    .string()
    .url()
    .refine((u) => new URL(u).searchParams.get("schema") === "public", {
      message: `${name} must include ?schema=public so Prisma never touches the pgboss schema`,
    });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Express "trust proxy" setting. "loopback" trusts the local Next.js rewrite proxy only. */
  TRUST_PROXY: z.string().default("loopback"),

  /** App queries (Prisma). May be a pooled (PgBouncer) endpoint. */
  DATABASE_URL: publicSchemaUrl("DATABASE_URL"),
  /** Direct, non-pooled endpoint for pg-boss and migrations (advisory locks, LISTEN/NOTIFY). Defaults to DATABASE_URL. */
  DIRECT_DATABASE_URL: publicSchemaUrl("DIRECT_DATABASE_URL").optional(),
  TEST_DATABASE_URL: z.string().url().optional(),

  APP_PASSWORD: z.string().min(8, "APP_PASSWORD must be at least 8 characters"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().positive().default(15),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_CHEAP: z.string().min(1),
  OPENAI_MODEL_STRONG: z.string().min(1),

  /** Optional at boot so the rest of the app works; a search run fails fast without it. */
  SERPER_API_KEY: z.string().optional(),
  SERPER_GL: z.string().length(2).default("in"),
  SERPER_MAX_QUERIES_PER_RUN: z.coerce.number().int().positive().max(100).default(15),
  /** Credits on the account when JobPilot started tracking; remaining = this minus credits logged in SearchRun. */
  SERPER_CREDITS_TOTAL: z.coerce.number().int().nonnegative().default(2500),
  SERPER_LOW_CREDIT_WARNING: z.coerce.number().int().nonnegative().default(250),
  /** Look up Serper hits on Greenhouse/Lever/Ashby via their public JSON API to get exact title/location. */
  ATS_ENRICH_SERPER_HITS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Minimum gap between requests to the same host. */
  HTTP_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(500),

  MAX_UPLOAD_MB: z.coerce.number().positive().max(5).default(5),
  /** Below this many non-whitespace chars the resume is treated as scanned/unreadable. */
  RESUME_MIN_TEXT_CHARS: z.coerce.number().int().positive().default(200),
  /** Hard cap on resume text sent to the LLM. */
  RESUME_MAX_TEXT_CHARS: z.coerce.number().int().positive().default(40_000),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  return result.data;
}

export const env = parseEnv();
export const isProduction = env.NODE_ENV === "production";
export const directDatabaseUrl = env.DIRECT_DATABASE_URL ?? env.DATABASE_URL;
