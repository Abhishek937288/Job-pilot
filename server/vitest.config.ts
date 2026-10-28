import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // DB-backed suites run via `npm run test:integration` (vitest.integration.config.ts).
    exclude: ["test/integration/**", "**/node_modules/**"],
    // Set before any module loads, so they win over values from the repo .env.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://jobpilot:jobpilot@localhost:5432/jobpilot_test?schema=public",
      DIRECT_DATABASE_URL: "postgresql://jobpilot:jobpilot@localhost:5432/jobpilot_test?schema=public",
      APP_PASSWORD: "test-password-123",
      SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars",
      OPENAI_API_KEY: "sk-test-not-used",
      OPENAI_MODEL_CHEAP: "test-cheap",
      OPENAI_MODEL_STRONG: "test-strong",
      LOGIN_MAX_ATTEMPTS: "5",
      LOGIN_WINDOW_MINUTES: "15",
      MAX_UPLOAD_MB: "5",
      TRUST_PROXY: "loopback",
    },
  },
});
