import { Hono } from "hono";
import type { Context } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, getOrCreateUserId } from "../lib/users.js";
import { createChargedRender, InsufficientBetaCreditsError, InsufficientCreditsError, isUniqueViolation } from "../lib/credits.js";
import { fundJob, reportProgramSpend, settleBetaCredits } from "../lib/beta.js";
import { findOwnedProject } from "../lib/projects.js";
import {
  creditsForRender,
  EDIT_SEASONS,
  EDIT_STYLES,
  EDIT_TIMES_OF_DAY,
  EDIT_REFERENCE_TARGETS,
  MAX_EDIT_REFERENCE_NOTE_CHARS,
  MAX_EDIT_REFERENCES,
  EDIT_WEATHER,
  editPassCount,
  editRequestProblem,
  FACADE_MATERIALS,
  featuresForRender,
  MAX_FACADE_COLOR_CHARS,
  PROMPT_POLISH_DAILY_LIMIT,
  renderRouteFor,
  suggestedEditPartForPrompt,
  type PromptPolishResponse,
} from "@renvia/types";
import { cancelRender, getBudget, refreshRender, releaseBudgetReservation, reserveBudget, submitRender } from "../lib/engine.js";
import { effectiveBudgetUsd, effectiveEngineMode, getSettings } from "../lib/settings.js";
import {
  checkAllowance,
  refuseBetaBudget,
  refuseBetaCredits,
  refuseBetaUnavailable,
  refuseBudget,
  refuseCredits,
  refuseDisabled,
  refuseInput,
  refuseStorage,
  resolveLimits,
} from "../lib/limits.js";
import { modelFor, upscaleCostMicros } from "../lib/models.js";
import { detectSourceType } from "../lib/sourceKind.js";
import { ownUploadKey, storageWouldExceed } from "../lib/storage.js";
import { repairReferencePrompt } from "../lib/prompts.js";
import { polishesToday, polishPrompt } from "../lib/promptPolish.js";
import { ensureEntitlement } from "../lib/billing.js";
import { presentForViewer } from "../lib/presentAsset.js";
import { ForeignRenderError, resolveImageInput } from "../lib/watermark.js";
import { checkFeatures, currentStudioRevision, effectiveCreditPrices } from "../lib/studioControl.js";

export const renders = new Hono<AppContext>();

/**
 * A generous guess at what a job will store: its result, a watermarked copy, and any 4K/8K
 * copy (JPEG). Used only to stop new work before storage would pass its cap.
 */
function estimatedOutputBytes(settings: { highRes?: { target: "4k" | "8k" }; upscale?: { target: "4k" | "8k" } }): number {
  const MB = 1_000_000;
  const highRes = { "4k": 8 * MB, "8k": 25 * MB };
  if (settings.upscale) return highRes[settings.upscale.target];
  return 6 * MB + (settings.highRes ? highRes[settings.highRes.target] : 0);
}

renders.use("*", requireAuth);

const createRenderSchema = z.object({
  projectId: z.string().uuid(),
  sourceImageUrl: z.string().url(),
  // Optional — the engine composes the full model prompt from style and settings.
  // The real cap is app_settings.max_prompt_chars; this is only the hard ceiling.
  prompt: z.string().trim().max(8000),
  aspectRatio: z.enum(["auto", "1:1", "16:9", "4:3", "3:4", "9:16"]),
  style: z.string().trim().min(1).max(50),
  viewKey: z.string().trim().min(1).max(80).optional(),
  viewLabel: z.string().trim().min(1).max(80).optional(),
  idempotencyKey: z.string().uuid().optional(),
  generationSettings: z
    .object({
      sourceType: z.enum(["drawing", "photo"]).optional(),
      styleInfluence: z.number().int().min(1).max(4).optional(),
      editInfluence: z.number().int().min(1).max(4).optional(),
      preserveStructure: z.boolean().optional(),
      fidelity: z
        .object({
          mode: z.enum(["standard", "strict"]),
          protectedFeatures: z.array(z.enum(["silhouette", "roof", "openings", "massing", "camera"])).min(1).max(5),
          reviewedAt: z.string().datetime().optional(),
        })
        .optional(),
      // Hard ceiling; app_settings.max_reference_images is the one operators tune.
      referenceImageUrls: z.array(z.string().url()).max(16).optional(),
      edit: z
        .object({
          mode: z.enum(["element", "building", "prompt"]),
          method: z.enum(["prompt", "reference", "reference-prompt"]).optional(),
          action: z.enum(["add", "remove", "change"]).optional(),
          maskImageUrl: z.string().url().optional(),
          selectionLabel: z.string().trim().max(60).optional(),
          selectionAreas: z
            .array(
              z.object({
                box: z.object({
                  left: z.number().finite().min(0),
                  top: z.number().finite().min(0),
                  width: z.number().finite().positive(),
                  height: z.number().finite().positive(),
                }),
                label: z.string().trim().max(60).optional(),
              }),
            )
            .max(8)
            .optional(),
          references: z
            .array(
              z.object({
                target: z.enum(EDIT_REFERENCE_TARGETS),
                note: z.string().trim().max(MAX_EDIT_REFERENCE_NOTE_CHARS).optional(),
              }),
            )
            .max(MAX_EDIT_REFERENCES)
            .optional(),
          environment: z
            .object({
              timeOfDay: z.enum(EDIT_TIMES_OF_DAY).optional(),
              season: z.enum(EDIT_SEASONS).optional(),
              weather: z.enum(EDIT_WEATHER).optional(),
              style: z.enum(EDIT_STYLES).optional(),
              facadeColor: z.string().trim().min(1).max(MAX_FACADE_COLOR_CHARS).optional(),
              facadeMaterial: z.enum(FACADE_MATERIALS).optional(),
            })
            .strict()
            .optional(),
        })
        .optional(),
      // fal seeds are non-negative unsigned 32-bit ints (up to 2^32 - 1, not the signed int32
      // max) — validated loosely here since an out-of-range value just gets rejected by fal
      // itself rather than doing anything unsafe.
      seed: z.number().int().min(0).max(4_294_967_295).optional(),
      // Only the target comes from the client; the API fills in the rest as the passes finish.
      highRes: z.object({ target: z.enum(["4k", "8k"]) }).optional(),
    })
    .optional(),
  /** Who pays when the caller is a beta tester; "account" only on their explicit choice. */
  funding: z.enum(["beta", "account"]).optional(),
});

const repairPromptSchema = z.object({
  prompt: z.string().trim().max(8000),
  /** The repairer is only restrictive when the source must be protected. */
  sourceLocked: z.boolean().default(true),
});

/** Preview the exact deterministic repair used by source-locked reference renders. */
renders.post("/repair-prompt", async (c) => {
  const body = repairPromptSchema.parse(await c.req.json());
  if (!body.sourceLocked) return c.json({ prompt: body.prompt, repairs: [], blocked: [] });
  return c.json(repairReferencePrompt(body.prompt));
});

const polishPromptSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  kind: z.enum(["render", "edit"]),
  /** A render with references: requests that would redesign the source are left out. */
  sourceLocked: z.boolean().default(false),
});

/**
 * "Polish prompt": a suggested rewrite of the prompt as a short architectural brief. Free (no
 * credits), up to PROMPT_POLISH_DAILY_LIMIT a day per person; admins have no limit. Its AI cost
 * counts toward the fal spending cap.
 */
renders.post("/polish-prompt", async (c) => {
  const { clerkId } = c.get("auth");
  const body = polishPromptSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, clerkId);
  if (user.disabled) return c.json({ error: "This account is disabled" }, 403);

  const limited = user.role !== "admin";
  const used = limited ? await polishesToday(db, user.id) : 0;
  if (limited && used >= PROMPT_POLISH_DAILY_LIMIT) {
    return c.json({ code: "polish_limit", error: `You've used today's ${PROMPT_POLISH_DAILY_LIMIT} free polishes. More are available tomorrow.` }, 429);
  }

  const outcome = await polishPrompt(c.env, db, body);
  await db.insert(schema.promptPolishes).values({
    userId: user.id,
    kind: body.kind,
    engine: outcome.result.engine,
    model: outcome.model,
    status: "succeeded",
    costMicros: outcome.costMicros,
  });
  const response: PromptPolishResponse = { ...outcome.result, remainingToday: limited ? PROMPT_POLISH_DAILY_LIMIT - used - 1 : null };
  return c.json(response);
});

const createUpscaleSchema = z.object({ target: z.enum(["4k", "8k"]), idempotencyKey: z.string().uuid().optional(), funding: z.enum(["beta", "account"]).optional() });

async function presentRender(c: Context<AppContext>, job: typeof schema.renders.$inferSelect) {
  const origin = new URL(c.req.url).origin;
  const settings = job.settings
    ? {
        ...job.settings,
        referenceImageUrls: job.settings.referenceImageUrls
          ? await Promise.all(job.settings.referenceImageUrls.map((url) => presentForViewer(c, origin, url)))
          : undefined,
        highRes: job.settings.highRes
          ? {
              ...job.settings.highRes,
              baseImageUrl: (await presentForViewer(c, origin, job.settings.highRes.baseImageUrl ?? null)) ?? undefined,
              imageUrl: (await presentForViewer(c, origin, job.settings.highRes.imageUrl ?? null)) ?? undefined,
            }
          : undefined,
        edit: job.settings.edit
          ? {
              ...job.settings.edit,
              maskImageUrl: (await presentForViewer(c, origin, job.settings.edit.maskImageUrl ?? null)) ?? undefined,
              intermediateImageUrl: (await presentForViewer(c, origin, job.settings.edit.intermediateImageUrl ?? null)) ?? undefined,
            }
          : undefined,
      }
    : job.settings;
  return {
    ...job,
    sourceImageUrl: await presentForViewer(c, origin, job.sourceImageUrl),
    resultImageUrl: await presentForViewer(c, origin, job.resultImageUrl),
    settings,
  };
}

/** The render an earlier attempt of this request created, if any. */
async function findRenderByIdempotencyKey(db: ReturnType<typeof createDb>, projectId: string, key: string) {
  const [render] = await db
    .select()
    .from(schema.renders)
    .where(and(eq(schema.renders.projectId, projectId), eq(schema.renders.idempotencyKey, key)))
    .limit(1);
  return render ?? null;
}

/**
 * The response for a render this idempotency key already created, or null. A retry of a request
 * gets that render back instead of a second charge. Callers check it first, before any limit or
 * credit check (the first attempt already passed and paid), and again before any refusal: a
 * slower first attempt can create its render in between, and its own render then counts against
 * the very limits the retry would be refused for.
 */
async function replayResponse(c: Context<AppContext>, db: ReturnType<typeof createDb>, projectId: string, key: string | undefined) {
  if (!key) return null;
  const existing = await findRenderByIdempotencyKey(db, projectId, key);
  return existing ? c.json({ job: await presentRender(c, existing), replayed: true }, 200) : null;
}

renders.post("/", async (c) => {
  const { clerkId } = c.get("auth");
  const body = createRenderSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(c.env, db, clerkId);
  const billing = await ensureEntitlement(db, user.id);
  const appSettings = await getSettings(db);
  if (user.disabled) {
    const refusal = refuseDisabled(appSettings);
    return c.json(refusal, refusal.status);
  }
  const project = await findOwnedProject(db, body.projectId, user.id);
  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  const replay = () => replayResponse(c, db, body.projectId, body.idempotencyKey);
  const earlier = await replay();
  if (earlier) return earlier;
  // A running beta program's limits and feature grants apply; one past its end is closed here.
  const { context: beta } = await settleBetaCredits(db, user.id, { betaCredits: user.betaCredits });
  const betaProgram = beta?.running ? beta.program : null;

  const settings = body.generationSettings ?? {};
  const suggestedEditPart = !settings.edit ? suggestedEditPartForPrompt(body.prompt) : null;
  if (suggestedEditPart) {
    return c.json(
      {
        code: "targeted_edit_requires_selection",
        error: `This is a ${suggestedEditPart} edit. Use Edit so only that area changes.`,
      },
      422,
    );
  }
  if (settings.highRes && settings.edit) {
    return c.json({ code: "invalid_edit", error: "Output resolution applies to renders, not edits." }, 422);
  }
  const editProblem = settings.edit
    ? editRequestProblem({ edit: settings.edit, prompt: body.prompt, referenceCount: settings.referenceImageUrls?.length ?? 0 })
    : null;
  if (editProblem) {
    return c.json({ code: "invalid_edit", error: editProblem }, 422);
  }
  const origin = new URL(c.req.url).origin;
  // A free-plan user's renders reach the Studio watermarked; edits, "set as base" and
  // references made from them must use the clean original, and only from their own renders.
  try {
    body.sourceImageUrl = await resolveImageInput(db, user.id, body.sourceImageUrl, origin);
    if (settings.referenceImageUrls) {
      settings.referenceImageUrls = await Promise.all(settings.referenceImageUrls.map((url) => resolveImageInput(db, user.id, url, origin)));
    }
  } catch (error) {
    if (error instanceof ForeignRenderError) return c.json({ error: error.message, code: "foreign_render" }, 403);
    throw error;
  }
  const maskImageUrl = settings.edit?.maskImageUrl;
  // The masked area is composited back from our own copies of the source and mask.
  if (maskImageUrl && (!ownUploadKey(body.sourceImageUrl, origin) || !ownUploadKey(maskImageUrl, origin))) {
    return c.json({ error: "Selection edits need an uploaded source image" }, 400);
  }

  const isAdmin = user.role === "admin";
  const limits = resolveLimits(user, appSettings, billing.plan, betaProgram);

  if (body.prompt.length > limits.maxPromptChars) {
    const refusal = refuseInput(appSettings, "prompt_too_long", limits.maxPromptChars, body.prompt.length);
    return c.json(refusal, refusal.status);
  }
  const referenceCount = settings.referenceImageUrls?.length ?? 0;
  if (referenceCount > limits.maxReferenceImages) {
    const refusal = refuseInput(appSettings, "too_many_references", limits.maxReferenceImages, referenceCount);
    return c.json(refusal, refusal.status);
  }

  // One Studio Control revision for the whole request: its rules decide, and its version is
  // stamped on the job.
  const revision = await currentStudioRevision(db);
  const engineMode = effectiveEngineMode(c.env, appSettings);
  const featureRefusal = await checkFeatures(db, revision, user, billing.plan.slug, featuresForRender(settings), engineMode, betaProgram?.featureGrants);
  if (featureRefusal) return (await replay()) ?? c.json(featureRefusal, featureRefusal.status);

  const allowance = await checkAllowance(db, user, appSettings, "render", billing.plan, betaProgram);
  if (allowance) return (await replay()) ?? c.json(allowance, allowance.status);
  if (await storageWouldExceed(db, appSettings.storageCapMb, estimatedOutputBytes(settings))) {
    const refusal = refuseStorage(appSettings);
    return (await replay()) ?? c.json(refusal, refusal.status);
  }

  // Nobody has to say whether the source is a photo or a line drawing: work it out from the image
  // itself (unless the caller already did, or this is an edit, which doesn't use it).
  const generationSettings =
    settings.edit || settings.sourceType
      ? settings
      : { ...settings, sourceType: await detectSourceType(c.env, body.sourceImageUrl, origin) };

  const model = modelFor(engineMode, renderRouteFor(generationSettings));
  // A selection edit that also changes the environment runs a second, whole-image pass on the
  // single-image edit model once the first finishes (see startEnvironmentPass).
  // A render with an output resolution runs an upscale pass once it finishes (see startUpscalePass).
  const costMicros =
    (generationSettings.edit && editPassCount(generationSettings.edit) > 1
      ? model.costMicros + modelFor(engineMode, "edit").costMicros
      : model.costMicros) + (generationSettings.highRes ? upscaleCostMicros(engineMode, generationSettings.highRes.target) : 0);
  const reservation = await reserveBudget(db, costMicros, effectiveBudgetUsd(c.env, appSettings));
  if (!reservation) {
    const refusal = refuseBudget(appSettings);
    return (await replay()) ?? c.json(refusal, refusal.status);
  }

  // Admins aren't charged; their renders still count toward the global fal budget. Prices come
  // from the same revision as the feature check (Settings' multipliers until prices are published).
  const credits = isAdmin ? 0 : creditsForRender(generationSettings, effectiveCreditPrices(revision.config, appSettings));
  let programHold: string | null = null;
  try {
    // Testers pay from beta credits within the program budget; never silently from their own.
    const funding = await fundJob(c.env, db, beta, body.funding, credits, costMicros);
    if (!funding.ok) {
      const refusal = funding.code === "beta_unavailable" ? refuseBetaUnavailable(appSettings) : refuseBetaBudget(appSettings);
      return (await replay()) ?? c.json(refusal, refusal.status);
    }
    programHold = funding.hold;
    let created;
    try {
      created = await createChargedRender(db, user.id, credits, {
        projectId: body.projectId,
        sourceImageUrl: body.sourceImageUrl,
        prompt: body.prompt,
        aspectRatio: body.aspectRatio,
        style: body.style,
        viewKey: body.viewKey,
        viewLabel: body.viewLabel,
        status: "pending",
        model: model.id,
        costMicros,
        settings: generationSettings,
        idempotencyKey: body.idempotencyKey,
        configVersion: revision.version,
      }, funding.charge);
    } catch (error) {
      if (error instanceof InsufficientBetaCreditsError) {
        const refusal = refuseBetaCredits(appSettings, user.betaCredits, credits);
        return (await replay()) ?? c.json(refusal, refusal.status);
      }
      if (error instanceof InsufficientCreditsError) {
        const refusal = refuseCredits(appSettings, user.creditBalance, credits);
        return (await replay()) ?? c.json(refusal, refusal.status);
      }
      // Two attempts of the same request raced and the other one won: its charge stands and
      // this one's rolled back with the failed insert, so hand back the render it created.
      if (isUniqueViolation(error)) {
        const raced = await replay();
        if (raced) return raced;
      }
      throw error;
    }
    if (funding.program) await reportProgramSpend(c.env, db, funding.program);
    const job = await submitRender(c.env, db, created, origin);
    return c.json({ job: await presentRender(c, job) }, 201);
  } finally {
    await releaseBudgetReservation(db, reservation);
    await releaseBudgetReservation(db, programHold);
  }
});

/** Queues a faithful high-resolution export from a finished render. */
renders.post("/:id/upscale", async (c) => {
  const { clerkId } = c.get("auth");
  const { target, idempotencyKey, funding: requestedFunding } = createUpscaleSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, clerkId);
  const billing = await ensureEntitlement(db, user.id);
  const appSettings = await getSettings(db);
  if (user.disabled) {
    const refusal = refuseDisabled(appSettings);
    return c.json(refusal, refusal.status);
  }
  const parent = await findOwnedRender(db, c.req.param("id"), user.id);
  if (!parent?.resultImageUrl || parent.status !== "succeeded") {
    return c.json({ error: "Only finished renders can be exported in high resolution" }, 400);
  }

  const origin = new URL(c.req.url).origin;
  if (!ownUploadKey(parent.resultImageUrl, origin)) {
    return c.json({ error: "This render is not available for high-resolution export" }, 400);
  }
  const replay = () => replayResponse(c, db, parent.projectId, idempotencyKey);
  const earlier = await replay();
  if (earlier) return earlier;
  const { context: beta } = await settleBetaCredits(db, user.id, { betaCredits: user.betaCredits });
  const betaProgram = beta?.running ? beta.program : null;
  const revision = await currentStudioRevision(db);
  const engineMode = effectiveEngineMode(c.env, appSettings);
  const featureRefusal = await checkFeatures(db, revision, user, billing.plan.slug, featuresForRender({ upscale: { target, parentRenderId: parent.id } }), engineMode, betaProgram?.featureGrants);
  if (featureRefusal) return (await replay()) ?? c.json(featureRefusal, featureRefusal.status);
  const allowance = await checkAllowance(db, user, appSettings, "render", billing.plan, betaProgram);
  if (allowance) return (await replay()) ?? c.json(allowance, allowance.status);
  if (await storageWouldExceed(db, appSettings.storageCapMb, estimatedOutputBytes({ upscale: { target } }))) {
    const refusal = refuseStorage(appSettings);
    return (await replay()) ?? c.json(refusal, refusal.status);
  }

  const model = modelFor(engineMode, "upscale");
  const costMicros = upscaleCostMicros(engineMode, target);
  const reservation = await reserveBudget(db, costMicros, effectiveBudgetUsd(c.env, appSettings));
  if (!reservation) {
    const refusal = refuseBudget(appSettings);
    return (await replay()) ?? c.json(refusal, refusal.status);
  }

  const credits = user.role === "admin" ? 0 : creditsForRender({ upscale: { target, parentRenderId: parent.id } }, effectiveCreditPrices(revision.config, appSettings));
  let programHold: string | null = null;
  try {
    const funding = await fundJob(c.env, db, beta, requestedFunding, credits, costMicros);
    if (!funding.ok) {
      const refusal = funding.code === "beta_unavailable" ? refuseBetaUnavailable(appSettings) : refuseBetaBudget(appSettings);
      return (await replay()) ?? c.json(refusal, refusal.status);
    }
    programHold = funding.hold;
    const created = await createChargedRender(db, user.id, credits, {
      projectId: parent.projectId,
      sourceImageUrl: parent.resultImageUrl,
      prompt: `${target.toUpperCase()} high-resolution export`,
      aspectRatio: parent.aspectRatio,
      style: "High-resolution export",
      viewKey: parent.viewKey,
      viewLabel: parent.viewLabel,
      status: "pending",
      model: model.id,
      costMicros,
      settings: { upscale: { target, parentRenderId: parent.id } },
      idempotencyKey,
      configVersion: revision.version,
    }, funding.charge);
    if (funding.program) await reportProgramSpend(c.env, db, funding.program);
    const job = await submitRender(c.env, db, created, origin);
    return c.json({ job: await presentRender(c, job) }, 201);
  } catch (error) {
    if (error instanceof InsufficientBetaCreditsError) {
      const refusal = refuseBetaCredits(appSettings, user.betaCredits, credits);
      return (await replay()) ?? c.json(refusal, refusal.status);
    }
    if (error instanceof InsufficientCreditsError) {
      const refusal = refuseCredits(appSettings, user.creditBalance, credits);
      return (await replay()) ?? c.json(refusal, refusal.status);
    }
    // Two attempts raced and the other won; this one's charge rolled back with its insert.
    if (isUniqueViolation(error)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  } finally {
    await releaseBudgetReservation(db, reservation);
    await releaseBudgetReservation(db, programHold);
  }
});

// Global fal spend is operator information, not something normal users should see.
renders.get("/budget", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, clerkId);
  if (user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json(await getBudget(c.env, db));
});

renders.get("/", async (c) => {
  const { clerkId } = c.get("auth");
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const project = await findOwnedProject(db, projectId, ownerId);
  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  const jobs = await db
    .select()
    .from(schema.renders)
    .where(and(eq(schema.renders.projectId, projectId), isNull(schema.renders.hiddenAt)))
    .orderBy(desc(schema.renders.createdAt));

  const origin = new URL(c.req.url).origin;
  return c.json({ jobs: await Promise.all(jobs.map(async (job) => presentRender(c, await refreshRender(c.env, db, job, origin)))) });
});

renders.get("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const row = await db
    .select({ render: schema.renders })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(and(eq(schema.renders.id, id), eq(schema.projects.ownerId, ownerId)))
    .limit(1);

  if (!row[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ job: await presentRender(c, await refreshRender(c.env, db, row[0].render, new URL(c.req.url).origin)) });
});

/** The owner's render, or null — hidden renders count as gone. */
async function findOwnedRender(db: ReturnType<typeof createDb>, id: string, ownerId: string) {
  const row = await db
    .select({ render: schema.renders })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(and(eq(schema.renders.id, id), eq(schema.projects.ownerId, ownerId), isNull(schema.renders.hiddenAt)))
    .limit(1);
  return row[0]?.render ?? null;
}

// Stops a render still in flight — best-effort on fal's side, always marks it failed
// (and refunds credits) here so the user isn't left watching a progress bar forever.
renders.post("/:id/cancel", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);
  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const render = await findOwnedRender(db, c.req.param("id"), ownerId);
  if (!render) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ job: await presentRender(c, await cancelRender(c.env, db, render)) });
});

const updateRenderSchema = z.object({ isFavorite: z.boolean() });

renders.patch("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const body = updateRenderSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const render = await findOwnedRender(db, c.req.param("id"), ownerId);
  if (!render) {
    return c.json({ error: "Not found" }, 404);
  }

  const [job] = await db
    .update(schema.renders)
    .set({ isFavorite: body.isFavorite })
    .where(eq(schema.renders.id, render.id))
    .returning();
  return c.json({ job: await presentRender(c, job!) });
});

// Hides the render from the owner's history. The row is kept: spend caps, credit history
// and the admin render log all still count it.
renders.delete("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);
  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const render = await findOwnedRender(db, c.req.param("id"), ownerId);
  if (!render) {
    return c.json({ error: "Not found" }, 404);
  }

  await db.update(schema.renders).set({ hiddenAt: new Date() }).where(eq(schema.renders.id, render.id));
  return c.json({ ok: true });
});
