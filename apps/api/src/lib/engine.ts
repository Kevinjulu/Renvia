import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";
import { and, eq, ne, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { RenderBudgetResponse, RenderEngineMode } from "@renvia/types";
import type { Env } from "../index.js";
import { extensionForContentType, getObject, ownUploadKey, publicUploadUrl, putObject, renderResultKeyFor } from "./storage.js";

type RenderRow = typeof schema.renders.$inferSelect;

interface ModeConfig {
  model: string;
  /** Per-image cost in USD micros, from fal's pricing API (rounded up for compute-second models). */
  costMicros: number;
  buildInput: (imageUrl: string, prompt: string) => Record<string, unknown>;
}

const MODES: Record<RenderEngineMode, ModeConfig> = {
  mock: { model: "mock", costMicros: 0, buildInput: () => ({}) },
  // $0.00125/compute-second, ~1–2s per 4-step image — only for exercising the pipeline.
  dev: {
    model: "fal-ai/fast-lightning-sdxl/image-to-image",
    costMicros: 3_000,
    buildInput: (imageUrl, prompt) => ({
      image_url: imageUrl,
      prompt,
      strength: 0.6,
      num_inference_steps: "4",
      preserve_aspect_ratio: true,
      format: "jpeg",
    }),
  },
  // $0.04/image.
  prod: {
    model: "fal-ai/flux-pro/kontext",
    costMicros: 40_000,
    buildInput: (imageUrl, prompt) => ({ image_url: imageUrl, prompt, output_format: "jpeg" }),
  },
};

/** How long a mock render stays "processing" so the studio's progress UI is exercised. */
const MOCK_DURATION_MS = 4_000;

/** fal jobs still unfinished after this are failed so they stop being polled forever. */
const FAL_TIMEOUT_MS = 10 * 60_000;

const MICROS_PER_USD = 1_000_000;

/** Defaults to mock: a missing or mistyped FAL_MODE must never spend credit. */
export function engineMode(env: Env): RenderEngineMode {
  const mode = env.FAL_MODE?.trim();
  return mode === "dev" || mode === "prod" ? mode : "mock";
}

export function modeConfig(env: Env): ModeConfig {
  return MODES[engineMode(env)];
}

function modeForModel(model: string | null): ModeConfig | undefined {
  return Object.values(MODES).find((mode) => mode.model === model);
}

function falClient(env: Env): FalClient {
  return createFalClient({ credentials: env.FAL_KEY });
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

/**
 * Only transitions a render that is still `processing`, so racing refreshes
 * (studio polling + fal webhook) finish it exactly once.
 */
async function finishRender(db: Database, render: RenderRow, patch: Partial<RenderRow>): Promise<RenderRow> {
  const [updated] = await db
    .update(schema.renders)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.renders.id, render.id), eq(schema.renders.status, "processing")))
    .returning();
  if (updated) return updated;
  const [current] = await db.select().from(schema.renders).where(eq(schema.renders.id, render.id));
  return current ?? render;
}

function failurePatch(message: string): Partial<RenderRow> {
  // Unbilled by fal, so it must stop counting against the budget.
  return { status: "failed", costMicros: 0, errorMessage: message };
}

function errorMessageOf(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;
  }
  return error instanceof Error ? error.message : "Render failed";
}

/**
 * fal must be able to fetch the source image. Our own uploads are re-uploaded to fal
 * storage straight from the bucket — that works when the API origin is localhost, and
 * avoids fetching arbitrary client-supplied URLs server-side. Anything else is handed
 * to fal as-is.
 */
async function falReachableImageUrl(env: Env, fal: FalClient, url: string, origin: string): Promise<string> {
  const key = ownUploadKey(url, origin);
  if (!key) return url;

  const object = await getObject(env, key);
  if (!object) throw new Error("Source image not found");
  const blob = await new Response(object.body).blob();
  return fal.storage.upload(new Blob([blob], { type: object.contentType }));
}

function webhookUrlFor(origin: string): string | undefined {
  const { protocol, hostname } = new URL(origin);
  // fal can't call back into a local dev server; polling covers that case.
  if (protocol !== "https:" || hostname === "localhost" || hostname === "127.0.0.1") return undefined;
  return `${origin}/api/webhooks/fal`;
}

/** Hands a freshly inserted pending render to the engine. `origin` is the API's public origin. */
export async function submitRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  const mode = modeForModel(render.model);
  if (!mode || mode.model === "mock") {
    return updateRender(db, render.id, { status: "processing" });
  }

  try {
    const fal = falClient(env);
    const imageUrl = await falReachableImageUrl(env, fal, render.sourceImageUrl, origin);
    const { request_id } = await fal.queue.submit(mode.model, {
      input: mode.buildInput(imageUrl, render.prompt),
      webhookUrl: webhookUrlFor(origin),
    });
    return updateRender(db, render.id, { status: "processing", falRequestId: request_id });
  } catch (error) {
    console.error("fal submit failed", error);
    return updateRender(db, render.id, failurePatch(errorMessageOf(error)));
  }
}

async function storeFalResult(env: Env, render: RenderRow, imageUrl: string, origin: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Couldn't download render result (${response.status})`);

  const contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "image/jpeg";
  const storedType = extensionForContentType(contentType) ? contentType : "image/jpeg";
  const key = renderResultKeyFor(render.id, storedType);
  await putObject(env, key, await response.arrayBuffer(), storedType);
  return publicUploadUrl(origin, key);
}

async function refreshFalRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  if (!render.falRequestId || !render.model) return render;

  const fal = falClient(env);
  const status = await fal.queue.status(render.model, { requestId: render.falRequestId });
  if (status.status !== "COMPLETED") {
    if (Date.now() - render.createdAt.getTime() > FAL_TIMEOUT_MS) {
      return finishRender(db, render, failurePatch("Render timed out"));
    }
    return render;
  }

  try {
    const { data } = await fal.queue.result(render.model, { requestId: render.falRequestId });
    const imageUrl = (data as { images?: { url?: string }[] }).images?.[0]?.url;
    if (!imageUrl) return finishRender(db, render, failurePatch("Render returned no image"));

    const resultImageUrl = await storeFalResult(env, render, imageUrl, origin);
    return finishRender(db, render, { status: "succeeded", resultImageUrl });
  } catch (error) {
    // A completed request whose result call errors is a model-side failure (bad input,
    // safety filter, …); storage/network hiccups are left processing and retried.
    if (error instanceof ApiError) {
      return finishRender(db, render, failurePatch(errorMessageOf(error)));
    }
    throw error;
  }
}

/**
 * Advances an in-flight render; called whenever the studio reads it and from the fal
 * webhook. Transient fal/storage errors leave the render as-is for the next refresh.
 */
export async function refreshRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  if (render.status === "pending") {
    // submitRender moves every render out of pending within the create request, so
    // an old pending row means that request died before handing it to the engine.
    if (Date.now() - render.createdAt.getTime() < FAL_TIMEOUT_MS) return render;
    return updateRender(db, render.id, failurePatch("Render was never submitted"));
  }
  if (render.status !== "processing") return render;

  if (render.model === "mock") {
    if (Date.now() - render.createdAt.getTime() < MOCK_DURATION_MS) return render;
    // Mock result is the source image itself — enough to exercise every downstream UI path.
    return finishRender(db, render, { status: "succeeded", resultImageUrl: render.sourceImageUrl });
  }

  try {
    return await refreshFalRender(env, db, render, origin);
  } catch (error) {
    console.error("fal refresh failed", render.id, error);
    return render;
  }
}
