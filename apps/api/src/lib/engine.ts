import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import sharp from "sharp";
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
const UPSCALE_TARGET_EDGE = { "4k": 3_840, "8k": 7_680 } as const;

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

/**
 * Takes a short-lived, database-backed hold before a paid job row exists. The advisory lock
 * serializes the aggregate check and insert across serverless instances; the hold is released
 * immediately after the render/segmentation row is created (which then represents its spend).
 */
export async function reserveBudget(db: Database, costMicros: number, budgetUsd: number): Promise<string | null> {
  if (costMicros === 0) return "free";
  const id = crypto.randomUUID();
  const budgetMicros = Math.round(budgetUsd * MICROS_PER_USD);
  const result = await db.execute<{ reserved: boolean }>(sql`
    with locked as (
      select pg_advisory_xact_lock(88420371) as locked
    ),
    cleared as (
      delete from budget_reservations where created_at < now() - interval '15 minutes' returning id
    ),
    spent as (
      select
        coalesce(sum(r.cost_micros) filter (where r.status <> 'failed'), 0)
        + coalesce((select sum(s.cost_micros) from segmentations s where s.status <> 'failed'), 0)
        + coalesce((select sum(b.cost_micros) from budget_reservations b), 0)
        + 0 * (select count(*) from cleared) as total
      from locked
      left join renders r on true
    ),
    reserved as (
      insert into budget_reservations (id, cost_micros)
      select ${id}::uuid, ${costMicros}
      from spent
      where total + ${costMicros} <= ${budgetMicros}
      returning id
    )
    select exists(select 1 from reserved) as reserved
  `);
  return result.rows[0]?.reserved ? id : null;
}

export async function releaseBudgetReservation(db: Database, id: string | null): Promise<void> {
  if (!id || id === "free") return;
  await db.delete(schema.budgetReservations).where(eq(schema.budgetReservations.id, id));
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

/**
 * Bria accepts at most a 4x factor. For a small source, make a high-quality intermediate
 * canvas first, then let Bria do the actual detail-preserving enhancement to the requested edge.
 */
async function prepareUpscaleInput(
  env: Env,
  fal: FalClient,
  url: string,
  origin: string,
  target: "4k" | "8k",
): Promise<{ url: string; factor: number }> {
  const upload = await readOwnUpload(env, url, origin);
  if (!upload) throw new Error("High-resolution exports need a stored render");

  const source = sharp(upload.bytes).rotate();
  const metadata = await source.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const sourceLongEdge = Math.max(width, height);
  const targetLongEdge = UPSCALE_TARGET_EDGE[target];
  if (!sourceLongEdge) throw new Error("Couldn’t read the render dimensions");
  if (sourceLongEdge >= targetLongEdge) throw new Error(`This render is already ${target.toUpperCase()} or larger`);

  // Bria exposes 2x and 4x checkpoints only. Pick the closest faithful checkpoint,
  // cap its input to Bria's 8K output limit, then normalize the returned asset below.
  const factor = sourceLongEdge > targetLongEdge / 2 ? 2 : 4;
  const minimumInputEdge = Math.ceil(targetLongEdge / factor);
  const maximumInputEdge = Math.floor(8_192 / factor);
  const workingLongEdge = Math.min(Math.max(sourceLongEdge, minimumInputEdge), maximumInputEdge);
  const working = workingLongEdge !== sourceLongEdge
    ? await source
        .resize({
          width: Math.round((width / sourceLongEdge) * workingLongEdge),
          height: Math.round((height / sourceLongEdge) * workingLongEdge),
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer()
    : upload.bytes;
  return {
    url: await fal.storage.upload(new Blob([new Uint8Array(working)], { type: "image/png" })),
    factor,
  };
}

async function mockUpscaleResult(env: Env, render: RenderRow, origin: string): Promise<string> {
  const target = render.settings?.upscale?.target;
  const upload = target ? await readOwnUpload(env, render.sourceImageUrl, origin) : null;
  if (!target || !upload) return render.sourceImageUrl;
  const metadata = await sharp(upload.bytes).rotate().metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const longEdge = Math.max(width, height);
  if (!longEdge) throw new Error("Couldn’t read the render dimensions");
  const desired = UPSCALE_TARGET_EDGE[target];
  const bytes = await sharp(upload.bytes)
    .rotate()
    .resize({
      width: Math.round((width / longEdge) * desired),
      height: Math.round((height / longEdge) * desired),
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const key = renderResultKeyFor(render.id, "image/png");
  await putObject(env, key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "image/png");
  return publicUploadUrl(origin, key);
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
    const isUpscale = Boolean(settings.upscale);
    // Edit strength is its own control (Edit tab), never whatever the Render tab's slider
    // last happened to be set to — the two routes shouldn't share invisible state.
    // Defaults match the studio: Strong for renders, Maximum for edits — a weak guidance
    // scale under-applies the instruction far more often than it over-applies it.
    const influence = (isEdit ? settings.editInfluence ?? 4 : settings.styleInfluence ?? 3);
    // A targeted edit already keeps everything outside the mask untouched by compositing;
    // the crop sent to the model can afford to change more freely, so it's always unlocked.
    const referenceImageUrls = settings.referenceImageUrls ?? [];
    const hasReferences = referenceImageUrls.length > 0;
    // A prototype is a material/style source, never a second architectural brief. Enforce the
    // geometry lock server-side so an old client, restored job, or direct request cannot disable
    // it while sending reference images to the multi-image model.
    const preserveStructure = isEdit ? false : (hasReferences || (settings.preserveStructure ?? true));
    const aspectRatio: AspectRatio = (render.aspectRatio as AspectRatio) || "auto";
    // A selection edit sends the model a close-up of the selected area (see editCropFor).
    const masked = await maskedEditInputs(env, render, origin);
    const sourceInputPromise = isUpscale
      ? prepareUpscaleInput(env, fal, render.sourceImageUrl, origin, settings.upscale!.target)
      : (masked?.crop
        ? cropSource(masked.source, masked.crop).then((bytes) => fal.storage.upload(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" })).then((url) => ({ url, factor: undefined })))
        : falReachableImageUrl(env, fal, render.sourceImageUrl, origin).then((url) => ({ url, factor: undefined })));
    const [sourceInput, ...referenceUrls] = await Promise.all([
      sourceInputPromise,
      ...referenceImageUrls.map((url) => falReachableImageUrl(env, fal, url, origin)),
    ]);

    const prompt = settings.edit
      ? buildEditPrompt({
          prompt: render.prompt,
          edit: settings.edit,
          hasReferences,
          hasSelection: Boolean(masked?.crop),
          style: render.style,
        })
      : buildEnginePrompt({
          prompt: render.prompt,
          style: render.style,
          sourceType: settings.sourceType ?? "photo",
          hasReferences,
          preserveStructure,
          influence,
          strictFidelity: hasReferences && settings.fidelity?.mode === "strict",
          protectedFeatures: settings.fidelity?.protectedFeatures,
        });

    const { request_id } = await fal.queue.submit(model.id, {
      input: model.buildInput({
        imageUrl: sourceInput.url,
        referenceUrls,
        prompt,
        influence,
        preserveStructure,
        aspectRatio,
        seed: settings.seed,
        upscaleFactor: sourceInput.factor,
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

  // An upscale checkpoint returns a 2x or 4x image. Cap that output precisely at the
  // selected long edge without changing its aspect ratio or re-running the AI model.
  const upscaleTarget = render.settings?.upscale?.target;
  if (upscaleTarget) {
    const targetEdge = UPSCALE_TARGET_EDGE[upscaleTarget];
    const normalized = sharp(bytes).rotate();
    const metadata = await normalized.metadata();
    const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    if (!longEdge) throw new Error("Upscaler returned an image without dimensions");
    if (longEdge > targetEdge) {
      bytes = new Uint8Array(await normalized.resize({
        width: Math.round(((metadata.width ?? 0) / longEdge) * targetEdge),
        height: Math.round(((metadata.height ?? 0) / longEdge) * targetEdge),
        kernel: sharp.kernel.lanczos3,
      }).png().toBuffer());
      contentType = "image/png";
    }
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
    const result = data as { images?: { url?: string }[]; image?: { url?: string }; seed?: number };
    const imageUrl = result.images?.[0]?.url ?? result.image?.url;
    if (!imageUrl) return refundIfFailed(db, await finishRender(db, render, failurePatch("Render returned no image")));

    const resultImageUrl = await storeFalResult(env, render, imageUrl, origin);
    // Kontext and lightning-sdxl echo back the seed they actually used (including a random
    // one we didn't set); reference-edit models may not, so it falls back to what we asked for.
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
    const resultImageUrl = render.settings?.upscale ? await mockUpscaleResult(env, render, origin) : render.sourceImageUrl;
    return finishRender(db, render, {
      status: "succeeded",
      resultImageUrl,
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

/**
 * Stops an in-flight render at the user's request. Best-effort on fal's side — a request
 * that's already finished or too far along to interrupt still gets marked failed here, since
 * the user asked to stop watching it either way.
 */
export async function cancelRender(env: Env, db: Database, render: RenderRow): Promise<RenderRow> {
  if (render.status !== "pending" && render.status !== "processing") return render;

  if (render.falRequestId && render.model && render.model !== "mock") {
    try {
      await falClient(env).queue.cancel(render.model, { requestId: render.falRequestId });
    } catch (error) {
      // Already completed, already failed, or this stage can't be cancelled — fall through
      // and mark it failed below regardless.
      console.error("fal cancel failed", render.id, error);
    }
  }

  const [updated] = await db
    .update(schema.renders)
    .set({ ...failurePatch("Cancelled"), updatedAt: new Date() })
    .where(and(eq(schema.renders.id, render.id), inArray(schema.renders.status, ["pending", "processing"])))
    .returning();
  const current = updated ?? (await db.select().from(schema.renders).where(eq(schema.renders.id, render.id)))[0]!;
  return refundIfFailed(db, current);
}

/**
 * Advances every render still in flight, regardless of who owns it. A client only refreshes
 * jobs it's actively watching, so a render whose tab closed or never got revisited would
 * otherwise sit at "processing" forever — this is what a scheduled sweep calls instead.
 */
export async function sweepStaleRenders(env: Env, db: Database, origin: string): Promise<number> {
  const stale = await db
    .select()
    .from(schema.renders)
    .where(inArray(schema.renders.status, ["pending", "processing"]))
    .limit(100);
  for (const render of stale) {
    await refreshRender(env, db, render, origin);
  }
  return stale.length;
}
