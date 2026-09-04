import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;

/**
 * Factory rather than a module-level singleton: the Workers runtime (apps/api)
 * has no `process.env`, so the connection string must come from request-scoped
 * bindings (`c.env.DATABASE_URL`) instead of being read at import time.
 */
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}
