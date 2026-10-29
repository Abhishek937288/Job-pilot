import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["test/setup-env.ts"],
    // One Mongo database for the whole suite, so files must not run in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
