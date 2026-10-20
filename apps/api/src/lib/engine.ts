import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
 * Spend is global, not per user — it tracks the single fal account's credit. Every job counts
 * its cost_micros whatever its status: a failure only lowers it once fal's cost is known to be
 * zero (see failurePatch). Summed as bigint (the driver returns it as a string): an `::int` cast
 * errors once spend passes ~$2,147.
 */
async function spentMicros(db: Database): Promise<number> {
  const [[renders], [segments], [polishes]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint` })
      .from(schema.renders),
    db
      .select({ total: sql<string>`coalesce(sum(${schema.segmentations.costMicros}), 0)::bigint` })
      .from(schema.segmentations),
    // "Polish prompt" requests to the language model (free to users, but not to the fal account).
    db
      .select({ total: sql<string>`coalesce(sum(${schema.promptPolishes.costMicros}), 0)::bigint` })
      .from(schema.promptPolishes),
  ]);
  return Number(renders?.total ?? 0) + Number(segments?.total ?? 0) + Number(polishes?.total ?? 0);
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
          coalesce(sum(r.cost_micros), 0)
          + coalesce((select sum(s.cost_micros) from segmentations s), 0)
          + coalesce((select sum(p.cost_micros) from prompt_polishes p), 0)
          + coalesce((select sum(b.cost_micros) from budget_reservations b where b.created_at >= now() - interval '15 minutes' and b.beta_program_id is null), 0)
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
 * Only transitions a render that is still in `from` (by default `processing`), so racing
 * refreshes (studio polling + fal webhook) and a cancel finish it exactly once. A render that
 * succeeds without saying otherwise has its provider cost settled at its estimate.
 */
async function finishRender(db: Database, render: RenderRow, patch: Partial<RenderRow>, from: RenderRow["status"][] = ["processing"]): Promise<RenderRow> {
  const settled = patch.status === "succeeded" && patch.costState === undefined ? { costState: "settled" as const, uncertainCostMicros: 0 } : {};
  const [updated] = await db
    .update(schema.renders)
    .set({ ...patch, ...settled, updatedAt: new Date() })
    .where(and(eq(schema.renders.id, render.id), inArray(schema.renders.status, from)))
    .returning();
  if (updated) return updated;
  const [current] = await db.select().from(schema.renders).where(eq(schema.renders.id, render.id));
  return current ?? render;
}

/**
 * What is known about fal's charge for the pass a job was on when it ended here. The customer's
 * credits are refunded the same way in every case; this only decides what the budgets count.
 *
 * - not_charged: fal never ran the pass: it was never sent, fal refused the submit, or fal
 *   reported the pass failed. (fal doesn't bill requests that error out — the long-standing
 *   assumption here, not something fal confirms per request.)
 * - charged: fal finished the pass, e.g. completed without returning an image.
 * - unknown: fal may be running it or have run it: cancelled or timed out after submission, or
 *   a submit whose answer was lost. Its cost keeps counting until reconcileProviderCosts reads
 *   fal's own outcome.
 */
type PassOutcome = "not_charged" | "charged" | "unknown";

/**
 * The estimated cost of the pass the render is on now, and of the passes after it that haven't
 * started (and so can't have cost anything). Earlier passes finished, so fal billed them.
 */
function passCosts(render: RenderRow): { current: number; later: number } {
  const settings = render.settings;
  const total = render.costMicros;
  if (settings?.upscale) return { current: Math.min(total, UPSCALE_COST_MICROS[settings.upscale.target]), later: 0 };
  if (inUpscalePass(render)) return { current: Math.min(total, UPSCALE_COST_MICROS[settings!.highRes!.target]), later: 0 };
  const current = Math.min(total, modelById(render.model)?.costMicros ?? total);
  return { current, later: settings?.edit?.intermediateImageUrl ? 0 : total - current };
}

/** The cost fields for a job that ends counting `costMicros`, of which `uncertain` awaits fal. */
function costFields(costMicros: number, uncertain: number): Pick<RenderRow, "costMicros" | "uncertainCostMicros" | "costState"> {
  const cost = Math.max(0, costMicros);
  const open = Math.min(cost, Math.max(0, uncertain));
  return { costMicros: cost, uncertainCostMicros: open, costState: open > 0 ? "uncertain" : "settled" };
}

/**
 * The render failed here. Passes that never started stop counting; the current pass stops
 * counting only when fal can't have charged for it. Every use is wrapped in refundIfFailed, which
 * returns the user's credits regardless — they didn't get what they paid for.
 */
function failurePatch(render: RenderRow, message: string, outcome: PassOutcome): Partial<RenderRow> {
  const { current, later } = passCosts(render);
  const kept = render.costMicros - later - (outcome === "not_charged" ? current : 0);
  return { status: "failed", errorMessage: message, ...costFields(kept, outcome === "unknown" ? current : 0) };
}

/**
 * A submit that threw. Before the queue call nothing reached fal; an error answer from fal (4xx)
 * means it refused the request. Anything else — a 5xx, a network failure, or our own write
 * failing after fal accepted it — may have left a job running there.
 */
function submitOutcome(submitting: boolean, error: unknown): PassOutcome {
  if (!submitting) return "not_charged";
  return error instanceof ApiError && error.status >= 400 && error.status < 500 ? "not_charged" : "unknown";
}

/**
 * Records that fal accepted a pending render's first pass. Only a render still pending moves to
 * processing: one cancelled while the submit was in flight stays failed (and refunded), but fal
 * has the job anyway, so its request id is kept for reconcileProviderCosts and fal is asked to
 * drop it.
 */
async function markSubmitted(env: Env, db: Database, render: RenderRow, modelId: string, requestId: string): Promise<RenderRow> {
  const [updated] = await db
    .update(schema.renders)
    .set({ status: "processing", falRequestId: requestId, updatedAt: new Date() })
    .where(and(eq(schema.renders.id, render.id), eq(schema.renders.status, "pending")))
    .returning();
  if (updated) return updated;
  const [recorded] = await db
    .update(schema.renders)
    .set({ falRequestId: requestId })
    .where(and(eq(schema.renders.id, render.id), isNull(schema.renders.falRequestId)))
    .returning();
  await falClient(env).queue.cancel(modelId, { requestId }).catch((error: unknown) => console.error("fal cancel after late submit failed", render.id, error));
  return recorded ?? (await db.select().from(schema.renders).where(eq(schema.renders.id, render.id)))[0] ?? render;
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
    // Nothing goes to fal, so there's no provider cost to wait for.
    return finishRender(db, render, { status: "processing", costState: "settled" }, ["pending"]);
  }

  // Set just before the queue call: a failure before it never reached fal.
  let submitting = false;
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

    submitting = true;
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
    return await markSubmitted(env, db, render, model.id, request_id);
  } catch (error) {
    console.error("fal submit failed", error);
    // Only a render still pending fails here; one cancelled meanwhile was already settled.
    return refundIfFailed(db, await finishRender(db, render, failurePatch(render, errorMessageOf(error), submitOutcome(submitting, error)), ["pending"]));
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

  let submitting = false;
  try {
    const fal = falClient(env);
    const imageUrl = await falReachableImageUrl(env, fal, intermediateImageUrl, origin);
    submitting = true;
    const { request_id } = await fal.queue.submit(model.id, {
      input: model.buildInput({
        imageUrl,
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
    // Recorded even if the render was cancelled meanwhile, so the pass can still be reconciled.
    return updateRender(db, render.id, { falRequestId: request_id });
  } catch (error) {
    console.error("fal environment pass submit failed", render.id, error);
    return refundIfFailed(db, await finishRender(db, claimed, failurePatch(claimed, errorMessageOf(error), submitOutcome(submitting, error))));
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

  let submitting = false;
  try {
    if (model.id === "mock") {
      const key = renderHighResKeyFor(render.id, highRes.target, "image/jpeg");
      return await finishWithHighRes(db, claimed, await storeMockUpscale(env, baseImageUrl, highRes.target, key, origin));
    }
    const fal = falClient(env);
    const input = await prepareUpscaleInput(env, fal, baseImageUrl, origin, highRes.target);
    submitting = true;
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
    return finishWithoutHighRes(db, claimed, errorMessageOf(error), submitOutcome(submitting, error));
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
 * with its standard result; only the upscale's credits come back. Its spend stops counting only
 * when fal can't have charged for it; otherwise it stays counted until reconciled.
 */
async function finishWithoutHighRes(db: Database, render: RenderRow, message: string, outcome: PassOutcome, from?: RenderRow["status"][]): Promise<RenderRow> {
  const settings = render.settings!;
  const highRes = settings.highRes!;
  const refund = await upscaleRefund(db, render, highRes.target);
  const { current } = passCosts(render);
  const finished = await finishRender(db, render, {
    status: "succeeded",
    resultImageUrl: highRes.baseImageUrl,
    settings: { ...settings, highRes: { ...highRes, error: message } },
    ...costFields(render.costMicros - (outcome === "not_charged" ? current : 0), outcome === "unknown" ? current : 0),
    creditsCharged: render.creditsCharged - refund,
  }, from);
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
async function failInFlight(db: Database, render: RenderRow, message: string, outcome: PassOutcome): Promise<RenderRow> {
  if (inUpscalePass(render)) return finishWithoutHighRes(db, render, message, outcome);
  return refundIfFailed(db, await finishRender(db, render, failurePatch(render, message, outcome)));
}

async function refreshFalRender(env: Env, db: Database, render: RenderRow, origin: string): Promise<RenderRow> {
  if (!render.model) return render;
  if (!render.falRequestId) {
    // A second pass (environment or upscale) that was claimed but never submitted: the
    // request died in between.
    const claimedPass = Boolean(render.settings?.edit?.intermediateImageUrl) || inUpscalePass(render);
    if (claimedPass && Date.now() - render.createdAt.getTime() > FAL_TIMEOUT_MS) {
      // The submit may have reached fal before the request died.
      return failInFlight(db, render, "Render timed out", "unknown");
    }
    return render;
  }

  const fal = falClient(env);
  const status = await fal.queue.status(render.model, { requestId: render.falRequestId });
  if (status.status !== "COMPLETED") {
    if (Date.now() - render.createdAt.getTime() > FAL_TIMEOUT_MS) {
      // fal may still finish (and bill) it; reconcileProviderCosts reads its outcome later.
      return failInFlight(db, render, "Render timed out", "unknown");
    }
    return render;
  }

  try {
    const { data } = await fal.queue.result(render.model, { requestId: render.falRequestId });
    const result = data as { images?: { url?: string }[]; image?: { url?: string }; seed?: number };
    const imageUrl = result.images?.[0]?.url ?? result.image?.url;
    // fal completed the pass, so it billed it even without an image to show.
    if (!imageUrl) return failInFlight(db, render, "Render returned no image", "charged");
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
    if (error instanceof ApiError) return failInFlight(db, render, errorMessageOf(error), "not_charged");
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
    // Whether its submit reached fal first is unknown, so its first pass stays counted.
    if (Date.now() - render.createdAt.getTime() < FAL_TIMEOUT_MS) return render;
    return refundIfFailed(db, await finishRender(db, render, failurePatch(render, "Render was never submitted", "unknown"), ["pending"]));
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
 * the user asked to stop watching it either way. The user gets their credits back, but a
 * successful cancel call doesn't prove fal didn't charge (it may already have been running),
 * so the pass's cost stays counted until reconcileProviderCosts reads fal's outcome.
 */
export async function cancelRender(env: Env, db: Database, render: RenderRow): Promise<RenderRow> {
  if (render.status !== "pending" && render.status !== "processing") return render;

  const live = Boolean(render.model && render.model !== "mock");
  const outcome: PassOutcome = live ? "unknown" : "not_charged";
  if (render.falRequestId && render.model && live) {
    try {
      await falClient(env).queue.cancel(render.model, { requestId: render.falRequestId });
    } catch (error) {
      // Already completed, already failed, or this stage can't be cancelled — fall through
      // and mark it failed below regardless.
      console.error("fal cancel failed", render.id, error);
    }
  }
  // Cancelling during the upscale keeps the finished render; only the upscale is dropped and refunded.
  if (inUpscalePass(render)) return finishWithoutHighRes(db, render, "Cancelled", outcome);

  return refundIfFailed(db, await finishRender(db, render, failurePatch(render, "Cancelled", outcome), ["pending", "processing"]));
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

/** How long fal's outcome for an uncertain cost is waited for before it's kept for good. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60_000;
/** Uncertain renders checked per run; each costs one or two fal status reads (not billed). */
const RECONCILE_BATCH = 25;

/**
 * fal's own answer for the pass a render ended on: charged (it completed), not_charged (it
 * completed with an error, which covers a cancelled request), or null while it's still queued or
 * running, or fal can't be asked. Reads status and result only; nothing is stored or re-run.
 */
async function providerVerdict(env: Env, render: RenderRow): Promise<"charged" | "not_charged" | null> {
  if (!render.falRequestId || !render.model || render.model === "mock") return null;
  const fal = falClient(env);
  try {
    const status = await fal.queue.status(render.model, { requestId: render.falRequestId });
    if (status.status !== "COMPLETED") return null;
  } catch (error) {
    console.error("fal status read for reconciliation failed", render.id, error);
    return null;
  }
  try {
    await fal.queue.result(render.model, { requestId: render.falRequestId });
    return "charged";
  } catch (error) {
    return error instanceof ApiError ? "not_charged" : null;
  }
}

/**
 * Settles the provider cost of renders that ended here (cancelled, timed out, or a lost submit
 * answer) before fal's outcome was known. fal completing the pass keeps its cost; fal reporting it
 * failed releases it; no answer within RECONCILE_WINDOW_MS keeps it for good ("unresolved"). Each
 * settlement applies only while the row is still uncertain, so overlapping runs settle a render
 * once, and the check constraint keeps uncertain_cost_micros within cost_micros, so a release can't
 * take spend below zero. Customer credits are not touched: those were refunded when the job ended.
 */
export async function reconcileProviderCosts(env: Env, db: Database, now = new Date(), limit = RECONCILE_BATCH): Promise<{ checked: number; charged: number; released: number; unresolved: number }> {
  const uncertain = await db
    .select()
    .from(schema.renders)
    .where(eq(schema.renders.costState, "uncertain"))
    .orderBy(asc(schema.renders.updatedAt))
    .limit(limit);
  const tally = { checked: uncertain.length, charged: 0, released: 0, unresolved: 0 };
  for (const render of uncertain) {
    const verdict = await providerVerdict(env, render);
    const expired = now.getTime() - render.createdAt.getTime() > RECONCILE_WINDOW_MS;
    const settle = verdict ?? (expired ? "unresolved" : null);
    const stillUncertain = and(eq(schema.renders.id, render.id), eq(schema.renders.costState, "uncertain"));
    if (!settle) {
      // Still waiting on fal: move it to the back of the queue so the others get checked too.
      await db.update(schema.renders).set({ updatedAt: now }).where(stillUncertain);
      continue;
    }
    const [settled] = await db
      .update(schema.renders)
      .set({
        costMicros: settle === "not_charged" ? sql`${schema.renders.costMicros} - ${schema.renders.uncertainCostMicros}` : sql`${schema.renders.costMicros}`,
        uncertainCostMicros: 0,
        costState: settle === "unresolved" ? "unresolved" : "settled",
        updatedAt: now,
      })
      .where(stillUncertain)
      .returning({ id: schema.renders.id });
    if (!settled) continue;
    if (settle === "charged") tally.charged += 1;
    else if (settle === "not_charged") tally.released += 1;
    else tally.unresolved += 1;
  }
  return tally;
}
