import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

loadEnv({ path: "../api/.dev.vars" });

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set (expected in apps/api/.dev.vars)");
  }
  return neon(databaseUrl);
}
