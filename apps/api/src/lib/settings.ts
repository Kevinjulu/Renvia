import { eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { RenderEngineMode } from "@renvia/types";
import type { Env } from "../index.js";

export type AppSettingsRow = typeof schema.appSettings.$inferSelect;

/** The single settings row; recreated with defaults if it's ever missing. */
export async function getSettings(db: Database): Promise<AppSettingsRow> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1));
  if (row) return row;
  const [created] = await db.insert(schema.appSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)))[0]!;
}

/** Admin setting first, then FAL_MODE; anything unrecognised is mock so it can't spend credit. */
export function effectiveEngineMode(env: Env, settings: AppSettingsRow): RenderEngineMode {
  const mode = settings.falMode ?? env.FAL_MODE?.trim();
  return mode === "dev" || mode === "prod" ? mode : "mock";
}

/** Admin setting first, then FAL_BUDGET_USD; unset or invalid means no paid renders. */
export function effectiveBudgetUsd(env: Env, settings: AppSettingsRow): number {
  const usd = Number(settings.falBudgetUsd ?? env.FAL_BUDGET_USD);
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}
