/** Runs a command with DATABASE_URL pointed at TEST_DATABASE_URL, e.g. `prisma migrate deploy`. */
import { spawnSync } from "node:child_process";
import { loadEnvFiles } from "../config/load-env-files.js";

loadEnvFiles();

const testUrl = process.env.TEST_DATABASE_URL;
const [cmd, ...args] = process.argv.slice(2);
if (!testUrl || !cmd) {
  console.error("Usage: with-test-db <command> [...args]  (requires TEST_DATABASE_URL)");
  process.exit(1);
}

const result = spawnSync(cmd, args, {
  stdio: "inherit",
  shell: false,
  // Override both, or prisma.config.ts would pick up the real DIRECT_DATABASE_URL.
  env: { ...process.env, DATABASE_URL: testUrl, DIRECT_DATABASE_URL: testUrl },
});
process.exit(result.status ?? 1);
