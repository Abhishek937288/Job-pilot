import path from "node:path";
import { defineConfig } from "prisma/config";
import { loadEnvFiles } from "./src/config/load-env-files.js";

loadEnvFiles();

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // Not env("DATABASE_URL"): that throws when unset, which breaks `prisma generate`
    // on a fresh clone. Migrate commands still fail loudly without a URL.
    // Migrations need the direct (non-pooled) endpoint on Neon.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
