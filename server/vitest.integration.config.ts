import { defineConfig } from "vitest/config";
import { loadEnvFiles } from "./src/config/load-env-files.js";

loadEnvFiles();
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) throw new Error("TEST_DATABASE_URL is required for integration tests");
if (testDbUrl === process.env.DATABASE_URL || testDbUrl === process.env.DIRECT_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL / DIRECT_DATABASE_URL (tests truncate tables)");
}

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDbUrl,
      DIRECT_DATABASE_URL: testDbUrl,
      APP_PASSWORD: "test-password-123",
      SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
      OPENAI_API_KEY: "sk-test-not-used",
      OPENAI_MODEL_CHEAP: "test-cheap",
      OPENAI_MODEL_STRONG: "test-strong",
    },
  },
});
