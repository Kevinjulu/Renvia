import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertLocalDatabase, TEST_DATABASE_URL } from "./support/config.js";

const migrationsDir = new URL("../../../packages/db/migrations/", import.meta.url);

/** Rebuilds the schema from the real migrations once per run. */
export default async function setup(): Promise<void> {
  assertLocalDatabase(TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test database at ${TEST_DATABASE_URL}. Start Postgres and set TEST_DATABASE_URL ` +
        `(see apps/api/test/README.md). ${(error as Error).message}`,
    );
  }
  try {
    await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    const journal = JSON.parse(readFileSync(fileURLToPath(new URL("meta/_journal.json", migrationsDir)), "utf8")) as {
      entries: { tag: string }[];
    };
    for (const { tag } of journal.entries) {
      const sql = readFileSync(fileURLToPath(new URL(`${tag}.sql`, migrationsDir)), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
    }
  } finally {
    await client.end();
  }
}
