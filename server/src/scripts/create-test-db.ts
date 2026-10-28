/**
 * Creates the test database named in TEST_DATABASE_URL if it does not exist.
 * Needed because docker/postgres-init.sql only runs on a fresh Postgres volume.
 */
import pg from "pg";
import { loadEnvFiles } from "../config/load-env-files.js";

loadEnvFiles();

const adminUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !testUrl) {
  console.error("DATABASE_URL and TEST_DATABASE_URL must be set (see .env.example)");
  process.exit(1);
}

const dbName = new URL(testUrl).pathname.replace(/^\//, "");
// CREATE DATABASE cannot take a bind parameter, so the identifier is whitelisted instead.
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(dbName)) {
  console.error(`Refusing unsafe database name: ${JSON.stringify(dbName)}`);
  process.exit(1);
}

const admin = new URL(adminUrl);
admin.searchParams.delete("schema");
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (rowCount) {
    console.log(`Test database "${dbName}" already exists`);
  } else {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created test database "${dbName}"`);
  }
} finally {
  await client.end();
}
