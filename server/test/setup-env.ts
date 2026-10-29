import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { readFileSync } from "node:fs";

// Only the TEST_* URLs are taken from the repo .env; everything else is a fixed test config, so a real
// OpenAI or JSearch key in .env is never used by tests.
const envFile = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")].find((p) => existsSync(p));
const fileVars = envFile ? parse(readFileSync(envFile)) : {};

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.OPENAI_API_KEY = "sk-test";
process.env.JSEARCH_API_KEY = "";
process.env.WEB_SEARCH_ENABLED = "false";
process.env.HTTP_MIN_INTERVAL_MS = "0";
process.env.EXPLAIN_TOP_N = "3";
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? fileVars.TEST_MONGODB_URI ?? "mongodb://localhost:27017/jobpilot_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? fileVars.TEST_REDIS_URL ?? "redis://localhost:6379/15";
