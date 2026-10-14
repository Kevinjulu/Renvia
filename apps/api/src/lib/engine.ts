import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import sharp, { type Sharp } from "sharp";
import { schema, type Database } from "@renvia/db";
import {
  baseCreditCostForRender,
  creditsForRender,
  upscaleCredits,
  editPassCount,
  upscaleCreditCost,
  type AspectRatio,
  type EditReference,
  type RenderBudgetResponse,
  type RenderEditSettings,
  type RenderEngineMode,
  type UpscaleTarget,
} from "@renvia/types";
import type { Env } from "../index.js";
import { compositeMaskedEdit, cropSource, selectionFraming, selectionPlacement, type CropRect } from "./composite.js";
import { refundIfFailed, refundRender } from "./credits.js";
import { modelById, modelFor, pricingFor, UPSCALE_COST_MICROS } from "./models.js";
import { effectiveBudgetUsd, effectiveEngineMode, getSettings } from "./settings.js";
import { effectiveMaintenance, publishedPricesFor } from "./studioControl.js";
import { buildEditPrompt, buildEnginePrompt, buildEnvironmentPrompt } from "./prompts.js";
import {
  extensionForContentType,
  getObject,
  ownUploadKey,
  publicUploadUrl,
  putObject,
  renderHighResKeyFor,
  renderIntermediateKeyFor,
  renderResultKeyFor,
} from "./storage.js";

type RenderRow = typeof schema.renders.$inferSelect;

/** How long a mock render stays "processing" so the studio's progress UI is exercised. */
const MOCK_DURATION_MS = 4_000;

/** fal jobs still unfinished after this are failed so they stop being polled forever. */
const FAL_TIMEOUT_MS = 10 * 60_000;

const MICROS_PER_USD = 1_000_000;
const UPSCALE_TARGET_EDGE = { "4k": 3_840, "8k": 7_680 } as const;
/** FAL accepts (and Renvia lets customers enter) unsigned 32-bit seeds. */
const MAX_RENDER_SEED = 4_294_967_295;

/** Current render mode: the admin setting, else FAL_MODE, else mock (never spends by accident). */
export async function engineMode(env: Env, db: Database): Promise<RenderEngineMode> {
  return effectiveEngineMode(env, await getSettings(db));
}

function falClient(env: Env): FalClient {
  return createFalClient({ credentials: env.FAL_KEY });
}


/**
 * Spend is global, not per user — it tracks the single fal account's credit.
 * Failed jobs are excluded since fal doesn't bill requests that error out. Summed as bigint
 * (the driver returns it as a string): an `::int` cast errors once spend passes ~$2,147.
 */
async function spentMicros(db: Database): Promise<number> {
  const [[renders], [segments]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint` })
      .from(schema.renders)
      .where(ne(schema.renders.status, "failed")),
    db
      .select({ total: sql<string>`coalesce(sum(${schema.segmentations.costMicros}), 0)::bigint` })
      .from(schema.segmentations)
      .where(ne(schema.segmentations.status, "failed")),
  ]);
  return Number(renders?.total ?? 0) + Number(segments?.total ?? 0);
}

export async function getBudget(env: Env, db: Database): Promise<RenderBudgetResponse> {
  const settings = await getSettings(db);
  const mode = effectiveEngineMode(env, settings);
  const maintenance = await effectiveMaintenance(db, settings);
  return {
    mode,
    pricing: pricingFor(mode),
    spentUsd: (await spentMicros(db)) / MICROS_PER_USD,
    budgetUsd: effectiveBudgetUsd(env, settings),
    creditsPerImage: settings.creditsPerImage,
    maintenanceRenders: maintenance.renders,
    maintenanceMessage: maintenance.message,
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
  // The lock and the check must be separate statements of one transaction: a statement's
  // snapshot is taken before it waits for a lock, so a check inside the locking statement
  // would not see a hold committed by the request it waited behind.
  const [, result] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(88420371)`),
    db.execute<{ reserved: boolean }>(sql`
      with cleared as (
        delete from budget_reservations where created_at < now() - interval '15 minutes' returning id
      ),
      spent as (
        select
          coalesce(sum(r.cost_micros) filter (where r.status <> 'failed'), 0)
          + coalesce((select sum(s.cost_micros) from segmentations s where s.status <> 'failed'), 0)
          + coalesce((select sum(b.cost_micros) from budget_reservations b where b.created_at >= now() - interval '15 minutes'), 0)
          + 0 * (select count(*) from cleared) as total
        from renders r
      ),
      reserved as (
        insert into budget_reservations (id, cost_micros)
        select ${id}::uuid, ${costMicros}
        from spent
        where total + ${costMicros} <= ${budgetMicros}
        returning id
      )
      select exists(select 1 from reserved) as reserved
    `),
  ]);
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

/**
 * failurePatch for a render that may be in the environment pass of a two-pass edit: its first
 * pass finished and fal billed it, so that spend keeps counting against the budget. The user's
 * credits are still refunded in full — they didn't get the edit they paid for.
 */
function failurePatchFor(render: RenderRow, message: string): Partial<RenderRow> {
  if (!render.settings?.edit?.intermediateImageUrl) return failurePatch(message);
  const secondPassMicros = modelById(render.model)?.costMicros ?? 0;
  return { ...failurePatch(message), costMicros: Math.max(0, render.costMicros - secondPassMicros) };
}

/** A two-pass edit whose first pass (the selection) is still running. */
function awaitsEnvironmentPass(render: RenderRow): boolean {
  const edit = render.settings?.edit;
  return Boolean(edit && editPassCount(edit) > 1 && !edit.intermediateImageUrl);
}

/** A render with an output resolution whose render pass is still running. */
function awaitsUpscalePass(render: RenderRow): boolean {
  const highRes = render.settings?.highRes;
  return Boolean(highRes && !highRes.baseImageUrl && !render.settings?.edit);
}

/** A render with an output resolution in its upscale pass: the standard result is stored. */
function inUpscalePass(render: RenderRow): boolean {
  const highRes = render.settings?.highRes;
  return Boolean(highRes?.baseImageUrl && !highRes.imageUrl && !highRes.error);
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
 * Edit models refuse any input under 256px a side ("Image dimensions are too small"), which a
 * thumbnail pasted from an image search, a small swatch or a close-up of a small render easily
 * is. Below this short edge an input is enlarged first; the margin over 256 also gives the model
 * enough pixels to read a texture's pattern from.
 */
export const MIN_MODEL_INPUT_EDGE = 512;
/** The hard floor the models enforce; an extreme strip is padded out to it. */
const MODEL_INPUT_FLOOR = 256;
/** Enlarging never takes the long edge past this. */
const MAX_ENLARGED_EDGE = 4_096;

/**
 * `bytes` unchanged when both sides are already MIN_MODEL_INPUT_EDGE or more; otherwise an
 * enlarged copy (Lanczos, aspect kept), padded with its own edge pixels if a very long, thin
 * image still falls short of the models' floor. Null when the bytes aren't a readable image.
 */
export async function enlargeForModel(bytes: Uint8Array): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  let width = 0;
  let height = 0;
  try {
    const metadata = await sharp(bytes).metadata();
    const swapped = (metadata.orientation ?? 1) >= 5;
    width = (swapped ? metadata.height : metadata.width) ?? 0;
    height = (swapped ? metadata.width : metadata.height) ?? 0;
  } catch {
    return null;
  }
  if (!width || !height) return null;
  const shortEdge = Math.min(width, height);
  if (shortEdge >= MIN_MODEL_INPUT_EDGE) return null;

  const scale = Math.min(MIN_MODEL_INPUT_EDGE / shortEdge, MAX_ENLARGED_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * Math.max(1, scale)));
  const targetHeight = Math.max(1, Math.round(height * Math.max(1, scale)));
  let image = sharp(bytes).rotate().flatten({ background: "#ffffff" }).resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 });
  const padX = Math.max(0, MODEL_INPUT_FLOOR - targetWidth);
  const padY = Math.max(0, MODEL_INPUT_FLOOR - targetHeight);
  if (padX || padY) {
    // extend runs after resize in sharp's pipeline, so the padding is added at the new size.
    image = image.extend({
      left: Math.floor(padX / 2),
      right: Math.ceil(padX / 2),
      top: Math.floor(padY / 2),
      bottom: Math.ceil(padY / 2),
      extendWith: "copy",
    });
  }
  const encoded = await image.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  return { bytes: new Uint8Array(encoded), contentType: "image/jpeg" };
}

/** Uploads image bytes to fal storage, enlarged first when they're under the models' minimum. */
async function uploadModelInput(fal: FalClient, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<string> {
  const enlarged = await enlargeForModel(bytes);
  const input = enlarged ?? { bytes, contentType };
  return fal.storage.upload(new Blob([input.bytes], { type: input.contentType }));
}

/**
 * fal must be able to fetch every input image. Our own uploads are re-uploaded to fal
 * storage (enlarged when too small), which works even when the API origin is localhost;
 * anything else is handed to fal as-is.
 */
async function falReachableImageUrl(env: Env, fal: FalClient, url: string, origin: string): Promise<string> {
  const upload = await readOwnUpload(env, url, origin);
  if (!upload) return url;
  return uploadModelInput(fal, upload.bytes, upload.contentType);
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
  if (!target) return render.sourceImageUrl;
  return storeMockUpscale(env, render.sourceImageUrl, target, renderResultKeyFor(render.id, "image/jpeg"), origin);
}

/**
 * 4K/8K delivery format: JPEG at quality 92 with full-resolution colour (4:4:4), visually
 * lossless for renders and about a tenth of a PNG's size. Transparency is flattened onto white.
 */
function encodeHighRes(image: Sharp): Promise<Buffer> {
  return image.flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

/** Mock mode's stand-in for the upscaler: a plain resize of `url` to the target's long edge. */
async function storeMockUpscale(env: Env, url: string, target: UpscaleTarget, key: string, origin: string): Promise<string> {
  const upload = await readOwnUpload(env, url, origin);
  if (!upload) return url;
  const metadata = await sharp(upload.bytes).rotate().metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const longEdge = Math.max(width, height);
  if (!longEdge) throw new Error("Couldn’t read the render dimensions");
  const desired = UPSCALE_TARGET_EDGE[target];
  const bytes = sharp(upload.bytes)
    .rotate()
    .resize({
      width: Math.round((width / longEdge) * desired),
      height: Math.round((height / longEdge) * desired),
      kernel: sharp.kernel.lanczos3,
    });
  const encoded = await encodeHighRes(bytes);
  await putObject(env, key, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer, "image/jpeg");
  return publicUploadUrl(origin, key);
}

interface MaskedEditInputs {
  source: Uint8Array<ArrayBuffer>;
  mask: Uint8Array<ArrayBuffer>;
  /** Region sent to the model, or null when it edits the whole image. */
  crop: CropRect | null;
  /** The image the model is given: the crop, or the whole source. */
  frame: CropRect | null;
  /** Where the selection sits in the image the model is given ("in the centre"), when that helps. */
  placement: string | null;
}

/**
 * Each selected area as the prompt names it: its tag and where it sits in the image the model
 * sees. Edits from before selections had areas carry one tag for the whole selection.
 */
function describeSelectionAreas(edit: RenderEditSettings, masked: MaskedEditInputs): { label?: string; placement?: string }[] {
  const areas = edit.selectionAreas ?? [];
  if (areas.length === 0 || !masked.frame) return [{ label: edit.selectionLabel, placement: masked.placement ?? undefined }];
  const frame = masked.frame;
  return areas.map((area) => ({ label: area.label, placement: selectionPlacement(area.box, frame) ?? undefined }));
}

/**
 * Each reference's tag, one per reference image. Untagged references (edits from before tags,
 * or a client that sends fewer) are "look", the one meaning a lone reference always had.
 */
export function editReferencesFor(edit: RenderEditSettings, count: number): EditReference[] {
  const tags = edit.references ?? [];
  return Array.from({ length: count }, (_, index) => tags[index] ?? { target: "look" });
}

/** Source, mask and crop of a selection edit; null for renders and whole-image edits. */
async function maskedEditInputs(env: Env, render: RenderRow, origin: string): Promise<MaskedEditInputs | null> {
  const edit = render.settings?.edit;
  // The environment pass edits the whole composited result; the selection is already applied.
  const maskUrl = edit?.intermediateImageUrl ? undefined : edit?.maskImageUrl;
  if (!maskUrl) return null;
  const [source, mask] = await Promise.all([readOwnUpload(env, render.sourceImageUrl, origin), readOwnUpload(env, maskUrl, origin)]);
  if (!source || !mask) throw new Error("Edit source or mask isn't one of our uploads");
  return { source: source.bytes, mask: mask.bytes, ...(await selectionFraming(source.bytes, mask.bytes)) };
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
    // Defaults match the studio: Maximum for both — a weaker level under-applies the
    // reference or instruction far more often than Maximum over-applies it.
    const influence = (isEdit ? settings.editInfluence : settings.styleInfluence) ?? 4;
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
        ? cropSource(masked.source, masked.crop).then((bytes) => uploadModelInput(fal, new Uint8Array(bytes), "image/jpeg").then((url) => ({ url, factor: undefined })))
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
          hasSelection: Boolean(masked),
          isCloseUp: Boolean(masked?.crop),
          selectionAreas: masked ? describeSelectionAreas(settings.edit, masked) : undefined,
          references: editReferencesFor(settings.edit, referenceImageUrls.length),
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

async function storeFalResult(
  env: Env,
  render: RenderRow,
  imageUrl: string,
  origin: string,
  keyFor: (renderId: string, contentType: string) => string = renderResultKeyFor,
): Promise<string> {
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
  // selected long edge without changing its aspect ratio or re-running the AI model, and store
  // it as high-quality JPEG: an 8K PNG can be ~100 MB, about ten times the JPEG.
  const highRes = render.settings?.highRes;
  const upscaleTarget = render.settings?.upscale?.target ?? (highRes?.baseImageUrl ? highRes.target : undefined);
  if (upscaleTarget) {
    const targetEdge = UPSCALE_TARGET_EDGE[upscaleTarget];
    const normalized = sharp(bytes).rotate();
    const metadata = await normalized.metadata();
    const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    if (!longEdge) throw new Error("Upscaler returned an image without dimensions");
    const sized = longEdge > targetEdge
      ? normalized.resize({
          width: Math.round(((metadata.width ?? 0) / longEdge) * targetEdge),
          height: Math.round(((metadata.height ?? 0) / longEdge) * targetEdge),
          kernel: sharp.kernel.lanczos3,
        })
      : normalized;
    bytes = new Uint8Array(await encodeHighRes(sized));
    contentType = "image/jpeg";
  }

  const storedType = extensionForContentType(contentType) ? contentType : "image/jpeg";
  const key = keyFor(render.id, storedType);
  await putObject(env, key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, storedType);
  return publicUploadUrl(origin, key);
}

/**
 * The selection pass of a two-pass edit has finished: store its composite and hand it to the
 * environment pass, which edits the whole result. The render stays processing throughout.
 */
async function startEnvironmentPass(env: Env, db: Database, render: RenderRow, imageUrl: string, origin: string): Promise<RenderRow> {
  const settings = render.settings!;
  const edit = settings.edit!;
  const intermediateImageUrl = await storeFalResult(env, render, imageUrl, origin, renderIntermediateKeyFor);
  const model = modelFor(await engineMode(env, db), "edit");

  // Only the refresh that still sees the first pass's request id moves on, so a racing poll
  // and webhook submit the environment pass once. The model switches now, so the failure path
  // can tell the two passes' costs apart even if the submit below never happens.
  const [claimed] = await db
    .update(schema.renders)
    .set({
      settings: { ...settings, edit: { ...edit, intermediateImageUrl } },
      model: model.id,
      falRequestId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.renders.id, render.id), eq(schema.renders.falRequestId, render.falRequestId!), eq(schema.renders.status, "processing")))
    .returning();
  if (!claimed) {
    const [current] = await db.select().from(schema.renders).where(eq(schema.renders.id, render.id));
    return current ?? render;
  }

  // Operators switched to mock mid-flight: the selection's result is the best there is.
  if (model.id === "mock") {
    return finishRender(db, claimed, { status: "succeeded", resultImageUrl: intermediateImageUrl, seed: settings.seed ?? null });
  }

  try {
    const fal = falClient(env);
    const { request_id } = await fal.queue.submit(model.id, {
      input: model.buildInput({
        imageUrl: await falReachableImageUrl(env, fal, intermediateImageUrl, origin),
        referenceUrls: [],
        prompt: buildEnvironmentPrompt({ environment: edit.environment!, style: render.style }),
        influence: settings.editInfluence ?? 4,
        preserveStructure: false,
        // The composite is already the source's size; keep it.
        aspectRatio: "auto",
        seed: settings.seed,
      }),
      webhookUrl: webhookUrlFor(origin),
    });
    return updateRender(db, render.id, { falRequestId: request_id });
  } catch (error) {
    console.error("fal environment pass submit failed", render.id, error);
    return refundIfFailed(db, await finishRender(db, claimed, failurePatchFor(claimed, errorMessageOf(error))));
  }
}

/**
 * The render pass of a render with an output resolution has finished: store its standard
 * result and upscale it. The render stays processing until the high-resolution copy is in.
 */
async function startUpscalePass(env: Env, db: Database, render: RenderRow, imageUrl: string, origin: string, seed: number | null): Promise<RenderRow> {
  const settings = render.settings!;
  const highRes = settings.highRes!;
  const baseImageUrl = await storeFalResult(env, render, imageUrl, origin);
  const model = modelFor(await engineMode(env, db), "upscale");

  // Same claim as startEnvironmentPass: only the refresh that still sees the render pass's
  // request id moves on, so a racing poll and webhook start the upscale once.
  const [claimed] = await db
    .update(schema.renders)
    .set({
      settings: { ...settings, highRes: { ...highRes, baseImageUrl } },
      model: model.id,
      falRequestId: null,
      seed,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.renders.id, render.id), eq(schema.renders.falRequestId, render.falRequestId!), eq(schema.renders.status, "processing")))
    .returning();
  if (!claimed) {
    const [current] = await db.select().from(schema.renders).where(eq(schema.renders.id, render.id));
    return current ?? render;
  }

  try {
    if (model.id === "mock") {
      const key = renderHighResKeyFor(render.id, highRes.target, "image/jpeg");
      return await finishWithHighRes(db, claimed, await storeMockUpscale(env, baseImageUrl, highRes.target, key, origin));
    }
    const fal = falClient(env);
    const input = await prepareUpscaleInput(env, fal, baseImageUrl, origin, highRes.target);
    const { request_id } = await fal.queue.submit(model.id, {
      input: model.buildInput({
        imageUrl: input.url,
        referenceUrls: [],
        prompt: "",
        influence: 4,
        preserveStructure: true,
        aspectRatio: "auto",
        upscaleFactor: input.factor,
      }),
      webhookUrl: webhookUrlFor(origin),
    });
    return updateRender(db, render.id, { falRequestId: request_id });
  } catch (error) {
    console.error("upscale pass submit failed", render.id, error);
    return finishWithoutHighRes(db, claimed, errorMessageOf(error));
  }
}

/** The upscale pass succeeded: the render is done, with its standard and high-resolution copies. */
function finishWithHighRes(db: Database, render: RenderRow, imageUrl: string): Promise<RenderRow> {
  const settings = render.settings!;
  return finishRender(db, render, {
    status: "succeeded",
    resultImageUrl: settings.highRes!.baseImageUrl,
    settings: { ...settings, highRes: { ...settings.highRes!, imageUrl } },
  });
}

/**
 * The upscale pass failed or was cancelled. The render itself came out fine, so it succeeds
 * with its standard result; only the upscale's credits come back and its spend stops counting.
 */
async function finishWithoutHighRes(db: Database, render: RenderRow, message: string): Promise<RenderRow> {
  const settings = render.settings!;
  const highRes = settings.highRes!;
  const refund = await upscaleRefund(db, render, highRes.target);
  const finished = await finishRender(db, render, {
    status: "succeeded",
    resultImageUrl: highRes.baseImageUrl,
    settings: { ...settings, highRes: { ...highRes, error: message } },
    costMicros: Math.max(0, render.costMicros - UPSCALE_COST_MICROS[highRes.target]),
    creditsCharged: render.creditsCharged - refund,
  });
  // A racing refresh may have finished it first; the refund itself applies at most once.
  if (finished.settings?.highRes?.error) await refundRender(db, finished, refund);
  return finished;
}

/**
 * The upscale's share of what the render was charged. Uses the prices published in the
 * revision the render was checked against; a render charged under Settings' multipliers (no
 * published prices, or from before Studio Control) keeps the old fixed ratio, which those
 * multipliers cancel out of.
 */
async function upscaleRefund(db: Database, render: RenderRow, target: UpscaleTarget): Promise<number> {
  const settings = render.settings!;
  const prices = await publishedPricesFor(db, render.configVersion);
  const [upscale, total] = prices
    ? [upscaleCredits(target, prices), creditsForRender(settings, prices)]
    : [upscaleCreditCost(target), baseCreditCostForRender(settings)];
  return total > 0 ? Math.round((render.creditsCharged * upscale) / total) : 0;
}

/** Ends an in-flight render that went wrong, keeping the standard result if only the upscale did. */
async function failInFlight(db: Database, render: RenderRow, message: string): Promise<RenderRow> {
  if (inUpscalePass(render)) return finishWithoutHighRes(db, render, message);
  return refundIfFailed(db, await finishRender(db, render, failurePatchFor(render, message)));
}

async function refreshFalRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  if (!render.model) return render;
  if (!render.falRequestId) {
    // A second pass (environment or upscale) that was claimed but never submitted: the
    // request died in between.
    const claimedPass = Boolean(render.settings?.edit?.intermediateImageUrl) || inUpscalePass(render);
    if (claimedPass && Date.now() - render.createdAt.getTime() > FAL_TIMEOUT_MS) {
      return failInFlight(db, render, "Render timed out");
    }
    return render;
  }

  const fal = falClient(env);
  const status = await fal.queue.status(render.model, { requestId: render.falRequestId });
  if (status.status !== "COMPLETED") {
    if (Date.now() - render.createdAt.getTime() > FAL_TIMEOUT_MS) {
      return failInFlight(db, render, "Render timed out");
    }
    return render;
  }

  try {
    const { data } = await fal.queue.result(render.model, { requestId: render.falRequestId });
    const result = data as { images?: { url?: string }[]; image?: { url?: string }; seed?: number };
    const imageUrl = result.images?.[0]?.url ?? result.image?.url;
    if (!imageUrl) return failInFlight(db, render, "Render returned no image");
    if (awaitsEnvironmentPass(render)) return await startEnvironmentPass(env, db, render, imageUrl, origin);
    if (inUpscalePass(render)) {
      const target = render.settings!.highRes!.target;
      const highResImageUrl = await storeFalResult(env, render, imageUrl, origin, (id, type) => renderHighResKeyFor(id, target, type));
      return await finishWithHighRes(db, render, highResImageUrl);
    }

    // Some provider responses expose an internal, wider seed that does not fit our declared
    // unsigned-32-bit seed contract (or Postgres bigint). Never let provider metadata prevent
    // an otherwise completed image from being persisted; retain a valid echoed/user seed only.
    const echoedSeed = result.seed;
    const seed = typeof echoedSeed === "number" && Number.isSafeInteger(echoedSeed) && echoedSeed >= 0 && echoedSeed <= MAX_RENDER_SEED
      ? echoedSeed
      : (render.settings?.seed ?? null);
    if (awaitsUpscalePass(render)) return await startUpscalePass(env, db, render, imageUrl, origin, seed);

    const resultImageUrl = await storeFalResult(env, render, imageUrl, origin);
    return finishRender(db, render, { status: "succeeded", resultImageUrl, seed });
  } catch (error) {
    // A completed request whose result call errors is a model-side failure (bad input,
    // safety filter, …); storage/network hiccups are left processing and retried.
    if (error instanceof ApiError) return failInFlight(db, render, errorMessageOf(error));
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
    const highRes = awaitsUpscalePass(render) ? render.settings!.highRes! : null;
    const highResImageUrl = highRes
      ? await storeMockUpscale(env, resultImageUrl, highRes.target, renderHighResKeyFor(render.id, highRes.target, "image/jpeg"), origin)
      : null;
    return finishRender(db, render, {
      status: "succeeded",
      resultImageUrl,
      seed: render.settings?.seed ?? null,
      ...(highRes && highResImageUrl
        ? { settings: { ...render.settings, highRes: { ...highRes, baseImageUrl: resultImageUrl, imageUrl: highResImageUrl } } }
        : {}),
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
  // Cancelling during the upscale keeps the finished render; only the upscale is dropped and refunded.
  if (inUpscalePass(render)) return finishWithoutHighRes(db, render, "Cancelled");

  const [updated] = await db
    .update(schema.renders)
    .set({ ...failurePatchFor(render, "Cancelled"), updatedAt: new Date() })
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
