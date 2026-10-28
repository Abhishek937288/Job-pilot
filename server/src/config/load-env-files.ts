import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Loads the repo-root .env (if present) using Node's built-in loader. Real env vars win. */
export function loadEnvFiles(): void {
  const file = path.join(repoRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
