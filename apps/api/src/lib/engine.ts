import { and, eq, ne, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { RenderBudgetResponse, RenderEngineMode } from "@renvia/types";
import type { Env } from "../index.js";

type RenderRow = typeof schema.renders.$inferSelect;

interface ModeConfig {
  model: string;
  /** Approximate per-image cost in USD micros — re-verified against fal pricing when models are chosen. */
  costMicros: number;
}

const MODES: Record<RenderEngineMode, ModeConfig> = {
  mock: { model: "mock", costMicros: 0 },
  dev: { model: "fal-ai/flux/schnell", costMicros: 3_000 },
  prod: { model: "fal-ai/flux-pro/kontext", costMicros: 40_000 },
};

/** How long a mock render stays "processing" so the studio's progress UI is exercised. */
const MOCK_DURATION_MS = 4_000;

const MICROS_PER_USD = 1_000_000;

/** Defaults to mock: a missing or mistyped FAL_MODE must never spend credit. */
export function engineMode(env: Env): RenderEngineMode {
  const mode = env.FAL_MODE?.trim();
  return mode === "dev" || mode === "prod" ? mode : "mock";
}

export function modeConfig(env: Env): ModeConfig {
  return MODES[engineMode(env)];
}

function budgetMicros(env: Env): number {
  const usd = Number(env.FAL_BUDGET_USD);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * MICROS_PER_USD) : 0;
}

/**
 * Spend is global, not per user — it tracks the single fal account's credit.
 * Failed renders are excluded since fal doesn't bill requests that error out.
 */
async function spentMicros(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::int` })
    .from(schema.renders)
    .where(ne(schema.renders.status, "failed"));
  return row?.total ?? 0;
}

export async function getBudget(env: Env, db: Database): Promise<RenderBudgetResponse> {
  return {
    mode: engineMode(env),
    unitCostUsd: modeConfig(env).costMicros / MICROS_PER_USD,
    spentUsd: (await spentMicros(db)) / MICROS_PER_USD,
    budgetUsd: budgetMicros(env) / MICROS_PER_USD,
  };
}

/** True when one more render at the current mode's price would exceed FAL_BUDGET_USD. */
export async function wouldExceedBudget(env: Env, db: Database): Promise<boolean> {
  const { costMicros } = modeConfig(env);
  if (costMicros === 0) return false;
  return (await spentMicros(db)) + costMicros > budgetMicros(env);
}

async function updateRender(db: Database, id: string, patch: Partial<RenderRow>): Promise<RenderRow> {
  const [updated] = await db
    .update(schema.renders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.renders.id, id))
    .returning();
  return updated!;
}

/** Hands a freshly inserted pending render to the engine. */
export async function submitRender(env: Env, db: Database, render: RenderRow): Promise<RenderRow> {
  if (render.model === "mock") {
    return updateRender(db, render.id, { status: "processing" });
  }

  // The fal queue submission lands in phase 2; until then paid modes fail loudly
  // (and at zero recorded cost) rather than leaving jobs pending forever.
  return updateRender(db, render.id, {
    status: "failed",
    costMicros: 0,
    errorMessage: `Render engine for FAL_MODE=${engineMode(env)} isn't connected yet`,
  });
}

/** Advances an in-flight render; called whenever the studio reads it. */
export async function refreshRender(db: Database, render: RenderRow): Promise<RenderRow> {
  const inFlight = render.status === "pending" || render.status === "processing";
  if (!inFlight || render.model !== "mock") return render;

  if (Date.now() - render.createdAt.getTime() < MOCK_DURATION_MS) return render;

  // Mock result is the source image itself — enough to exercise every downstream UI path.
  const [updated] = await db
    .update(schema.renders)
    .set({ status: "succeeded", resultImageUrl: render.sourceImageUrl, updatedAt: new Date() })
    .where(and(eq(schema.renders.id, render.id), eq(schema.renders.status, render.status)))
    .returning();
  return updated ?? render;
}
