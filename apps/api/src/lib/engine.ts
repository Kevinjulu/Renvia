import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";
import { and, eq, ne, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { AspectRatio, RenderBudgetResponse, RenderEngineMode } from "@renvia/types";
import type { Env } from "../index.js";
import { compositeMaskedEdit, cropSource, editCropFor, type CropRect } from "./composite.js";
import { refundIfFailed } from "./credits.js";
import { modelById, pricingFor } from "./models.js";
import { effectiveBudgetUsd, effectiveEngineMode, getSettings } from "./settings.js";
import { buildEditPrompt, buildEnginePrompt } from "./prompts.js";
import { extensionForContentType, getObject, ownUploadKey, publicUploadUrl, putObject, renderResultKeyFor } from "./storage.js";

type RenderRow = typeof schema.renders.$inferSelect;

/** How long a mock render stays "processing" so the studio's progress UI is exercised. */
const MOCK_DURATION_MS = 4_000;

/** fal jobs still unfinished after this are failed so they stop being polled forever. */
const FAL_TIMEOUT_MS = 10 * 60_000;

const MICROS_PER_USD = 1_000_000;

/** Current render mode: the admin setting, else FAL_MODE, else mock (never spends by accident). */
export async function engineMode(env: Env, db: Database): Promise<RenderEngineMode> {
  return effectiveEngineMode(env, await getSettings(db));
}

function falClient(env: Env): FalClient {
  return createFalClient({ credentials: env.FAL_KEY });
}


/**
 * Spend is global, not per user — it tracks the single fal account's credit.
 * Failed jobs are excluded since fal doesn't bill requests that error out.
 */
async function spentMicros(db: Database): Promise<number> {
  const [[renders], [segments]] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::int` })
      .from(schema.renders)
      .where(ne(schema.renders.status, "failed")),
    db
      .select({ total: sql<number>`coalesce(sum(${schema.segmentations.costMicros}), 0)::int` })
      .from(schema.segmentations)
      .where(ne(schema.segmentations.status, "failed")),
  ]);
  return (renders?.total ?? 0) + (segments?.total ?? 0);
}

export async function getBudget(env: Env, db: Database): Promise<RenderBudgetResponse> {
  const settings = await getSettings(db);
  const mode = effectiveEngineMode(env, settings);
  return {
    mode,
    pricing: pricingFor(mode),
    spentUsd: (await spentMicros(db)) / MICROS_PER_USD,
    budgetUsd: effectiveBudgetUsd(env, settings),
    creditsPerImage: settings.creditsPerImage,
    maintenanceRenders: settings.maintenanceRenders,
    maintenanceMessage: settings.maintenanceMessage,
  };
}

/** True when one more render costing `costMicros` would exceed FAL_BUDGET_USD. */
export async function wouldExceedBudget(env: Env, db: Database, costMicros: number): Promise<boolean> {
  if (costMicros === 0) return false;
  const budgetMicros = Math.round(effectiveBudgetUsd(env, await getSettings(db)) * MICROS_PER_USD);
  return (await spentMicros(db)) + costMicros > budgetMicros;
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

/** Every use is wrapped in refundIfFailed, which returns the user's credits for it. */
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
 * Bytes of one of our own served uploads, read straight from the bucket. Null for any
 * other URL — client-supplied URLs are never fetched server-side.
 */
async function readOwnUpload(env: Env, url: string, origin: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  const key = ownUploadKey(url, origin);
  if (!key) return null;
  const object = await getObject(env, key);
  if (!object) throw new Error("Image not found");
  return { bytes: new Uint8Array(await new Response(object.body).arrayBuffer()), contentType: object.contentType };
}

/**
 * fal must be able to fetch every input image. Our own uploads are re-uploaded to fal
 * storage, which works even when the API origin is localhost; anything else is handed
 * to fal as-is.
 */
async function falReachableImageUrl(env: Env, fal: FalClient, url: string, origin: string): Promise<string> {
  const upload = await readOwnUpload(env, url, origin);
  if (!upload) return url;
  return fal.storage.upload(new Blob([upload.bytes], { type: upload.contentType }));
}

interface MaskedEditInputs {
  source: Uint8Array<ArrayBuffer>;
  mask: Uint8Array<ArrayBuffer>;
  /** Region sent to the model, or null when it edits the whole image. */
  crop: CropRect | null;
}

/** Source, mask and crop of a selection edit; null for renders and whole-image edits. */
async function maskedEditInputs(env: Env, render: RenderRow, origin: string): Promise<MaskedEditInputs | null> {
  const maskUrl = render.settings?.edit?.maskImageUrl;
  if (!maskUrl) return null;
  const [source, mask] = await Promise.all([readOwnUpload(env, render.sourceImageUrl, origin), readOwnUpload(env, maskUrl, origin)]);
  if (!source || !mask) throw new Error("Edit source or mask isn't one of our uploads");
  return { source: source.bytes, mask: mask.bytes, crop: await editCropFor(source.bytes, mask.bytes) };
}

function webhookUrlFor(origin: string): string | undefined {
  const { protocol, hostname } = new URL(origin);
  // fal can't call back into a local dev server; polling covers that case.
  if (protocol !== "https:" || hostname === "localhost" || hostname === "127.0.0.1") return undefined;
  return `${origin}/api/webhooks/fal`;
}

/** Hands a freshly inserted pending render to the engine. `origin` is the API's public origin. */
export async function submitRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  const model = modelById(render.model);
  if (!model || model.id === "mock") {
    return updateRender(db, render.id, { status: "processing" });
  }

  try {
    const fal = falClient(env);
    const settings = render.settings ?? {};
    const isEdit = Boolean(settings.edit);
    // Edit strength is its own control (Edit tab), never whatever the Render tab's slider
    // last happened to be set to — the two routes shouldn't share invisible state.
    const influence = (isEdit ? settings.editInfluence : settings.styleInfluence) ?? 2;
    // A targeted edit already keeps everything outside the mask untouched by compositing;
    // the crop sent to the model can afford to change more freely, so it's always unlocked.
    const preserveStructure = isEdit ? false : (settings.preserveStructure ?? true);
    const aspectRatio: AspectRatio = (render.aspectRatio as AspectRatio) || "auto";
    // A selection edit sends the model a close-up of the selected area (see editCropFor).
    const masked = await maskedEditInputs(env, render, origin);
    const sourceUrlPromise = masked?.crop
      ? cropSource(masked.source, masked.crop).then((bytes) => fal.storage.upload(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" })))
      : falReachableImageUrl(env, fal, render.sourceImageUrl, origin);
    const [sourceUrl, ...referenceUrls] = await Promise.all([
      sourceUrlPromise,
      ...(settings.referenceImageUrls ?? []).map((url) => falReachableImageUrl(env, fal, url, origin)),
    ]);

    const prompt = settings.edit
      ? buildEditPrompt({ prompt: render.prompt, edit: settings.edit, hasReferences: referenceUrls.length > 0, style: render.style })
      : buildEnginePrompt({
          prompt: render.prompt,
          style: render.style,
          sourceType: settings.sourceType ?? "photo",
          hasReferences: referenceUrls.length > 0,
          preserveStructure,
          influence,
        });

    const { request_id } = await fal.queue.submit(model.id, {
      input: model.buildInput({
        imageUrl: sourceUrl!,
        referenceUrls,
        prompt,
        influence,
        preserveStructure,
        aspectRatio,
        seed: settings.seed,
      }),
      webhookUrl: webhookUrlFor(origin),
    });
    return updateRender(db, render.id, { status: "processing", falRequestId: request_id });
  } catch (error) {
    console.error("fal submit failed", error);
    return refundIfFailed(db, await updateRender(db, render.id, failurePatch(errorMessageOf(error))));
  }
}

async function storeFalResult(env: Env, render: RenderRow, imageUrl: string, origin: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Couldn't download render result (${response.status})`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  let contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "image/jpeg";

  // Selection edits keep only the masked area of the model's output. The crop is recomputed
  // from the same source and mask, so it matches the region the model was given.
  const masked = await maskedEditInputs(env, render, origin);
  if (masked) {
    bytes = new Uint8Array(await compositeMaskedEdit(masked.source, bytes, masked.mask, masked.crop));
    contentType = "image/jpeg";
  }

  const storedType = extensionForContentType(contentType) ? contentType : "image/jpeg";
  const key = renderResultKeyFor(render.id, storedType);
  await putObject(env, key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, storedType);
  return publicUploadUrl(origin, key);
}

async function refreshFalRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  if (!render.falRequestId || !render.model) return render;

  const fal = falClient(env);
  const status = await fal.queue.status(render.model, { requestId: render.falRequestId });
  if (status.status !== "COMPLETED") {
    if (Date.now() - render.createdAt.getTime() > FAL_TIMEOUT_MS) {
      return refundIfFailed(db, await finishRender(db, render, failurePatch("Render timed out")));
    }
    return render;
  }

  try {
    const { data } = await fal.queue.result(render.model, { requestId: render.falRequestId });
    const result = data as { images?: { url?: string }[]; seed?: number };
    const imageUrl = result.images?.[0]?.url;
    if (!imageUrl) return refundIfFailed(db, await finishRender(db, render, failurePatch("Render returned no image")));

    const resultImageUrl = await storeFalResult(env, render, imageUrl, origin);
    // Kontext and lightning-sdxl echo back the seed they actually used (including a random
    // one we didn't set); nano-banana/edit doesn't, so it falls back to what we asked for.
    const seed = typeof result.seed === "number" ? result.seed : (render.settings?.seed ?? null);
    return finishRender(db, render, { status: "succeeded", resultImageUrl, seed });
  } catch (error) {
    // A completed request whose result call errors is a model-side failure (bad input,
    // safety filter, …); storage/network hiccups are left processing and retried.
    if (error instanceof ApiError) {
      return refundIfFailed(db, await finishRender(db, render, failurePatch(errorMessageOf(error))));
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
    return refundIfFailed(db, await updateRender(db, render.id, failurePatch("Render was never submitted")));
  }
  if (render.status !== "processing") return render;

  if (render.model === "mock") {
    if (Date.now() - render.createdAt.getTime() < MOCK_DURATION_MS) return render;
    // Mock result is the source image itself — enough to exercise every downstream UI path,
    // including a seed the user typed, so the Seed control is testable without spending fal credit.
    return finishRender(db, render, {
      status: "succeeded",
      resultImageUrl: render.sourceImageUrl,
      seed: render.settings?.seed ?? null,
    });
  }

  try {
    return await refreshFalRender(env, db, render, origin);
  } catch (error) {
    console.error("fal refresh failed", render.id, error);
    return render;
  }
}
