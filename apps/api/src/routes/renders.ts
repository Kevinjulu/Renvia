import { Hono } from "hono";
import type { Context } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, getOrCreateUserId } from "../lib/users.js";
import { createChargedRender, InsufficientCreditsError, isUniqueViolation } from "../lib/credits.js";
import { findOwnedProject } from "../lib/projects.js";
import {
  baseCreditCostForRender,
  EDIT_SEASONS,
  EDIT_STYLES,
  EDIT_TIMES_OF_DAY,
  EDIT_WEATHER,
  editPassCount,
  editRequestProblem,
  FACADE_MATERIALS,
  MAX_FACADE_COLOR_CHARS,
  renderRouteFor,
  suggestedEditPartForPrompt,
} from "@renvia/types";
import { cancelRender, getBudget, refreshRender, releaseBudgetReservation, reserveBudget, submitRender } from "../lib/engine.js";
import { effectiveBudgetUsd, effectiveEngineMode, getSettings } from "../lib/settings.js";
import { checkAllowance, refuseBudget, refuseCredits, refuseDisabled, refuseInput, resolveLimits } from "../lib/limits.js";
import { modelFor } from "../lib/models.js";
import { detectSourceType } from "../lib/sourceKind.js";
import { ownUploadKey, presentUploadUrl } from "../lib/storage.js";
import { repairReferencePrompt } from "../lib/prompts.js";
import { ensureEntitlement } from "../lib/billing.js";

export const renders = new Hono<AppContext>();

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
    })
    .optional(),
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

const createUpscaleSchema = z.object({ target: z.enum(["4k", "8k"]), idempotencyKey: z.string().uuid().optional() });
const UPSCALE_COST_MICROS = { "4k": 40_000, "8k": 80_000 } as const;

async function presentRender(c: Context<AppContext>, job: typeof schema.renders.$inferSelect) {
  const origin = new URL(c.req.url).origin;
  const settings = job.settings
    ? {
        ...job.settings,
        referenceImageUrls: job.settings.referenceImageUrls
          ? await Promise.all(job.settings.referenceImageUrls.map((url) => presentUploadUrl(c.env, origin, url)))
          : undefined,
        edit: job.settings.edit
          ? {
              ...job.settings.edit,
              maskImageUrl: (await presentUploadUrl(c.env, origin, job.settings.edit.maskImageUrl ?? null)) ?? undefined,
              intermediateImageUrl: (await presentUploadUrl(c.env, origin, job.settings.edit.intermediateImageUrl ?? null)) ?? undefined,
            }
          : undefined,
      }
    : job.settings;
  return {
    ...job,
    sourceImageUrl: await presentUploadUrl(c.env, origin, job.sourceImageUrl),
    resultImageUrl: await presentUploadUrl(c.env, origin, job.resultImageUrl),
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
  const editProblem = settings.edit
    ? editRequestProblem({ edit: settings.edit, prompt: body.prompt, referenceCount: settings.referenceImageUrls?.length ?? 0 })
    : null;
  if (editProblem) {
    return c.json({ code: "invalid_edit", error: editProblem }, 422);
  }
  const origin = new URL(c.req.url).origin;
  const maskImageUrl = settings.edit?.maskImageUrl;
  // The masked area is composited back from our own copies of the source and mask.
  if (maskImageUrl && (!ownUploadKey(body.sourceImageUrl, origin) || !ownUploadKey(maskImageUrl, origin))) {
    return c.json({ error: "Selection edits need an uploaded source image" }, 400);
  }

  const isAdmin = user.role === "admin";
  const limits = resolveLimits(user, appSettings, billing.plan);

  if (body.prompt.length > limits.maxPromptChars) {
    const refusal = refuseInput(appSettings, "prompt_too_long", limits.maxPromptChars, body.prompt.length);
    return c.json(refusal, refusal.status);
  }
  const referenceCount = settings.referenceImageUrls?.length ?? 0;
  if (referenceCount > limits.maxReferenceImages) {
    const refusal = refuseInput(appSettings, "too_many_references", limits.maxReferenceImages, referenceCount);
    return c.json(refusal, refusal.status);
  }

  const allowance = await checkAllowance(db, user, appSettings, "render", billing.plan);
  if (allowance) return (await replay()) ?? c.json(allowance, allowance.status);

  // Nobody has to say whether the source is a photo or a line drawing: work it out from the image
  // itself (unless the caller already did, or this is an edit, which doesn't use it).
  const generationSettings =
    settings.edit || settings.sourceType
      ? settings
      : { ...settings, sourceType: await detectSourceType(c.env, body.sourceImageUrl, origin) };

  const engineMode = effectiveEngineMode(c.env, appSettings);
  const model = modelFor(engineMode, renderRouteFor(generationSettings));
  // A selection edit that also changes the environment runs a second, whole-image pass on the
  // single-image edit model once the first finishes (see startEnvironmentPass).
  const costMicros =
    generationSettings.edit && editPassCount(generationSettings.edit) > 1
      ? model.costMicros + modelFor(engineMode, "edit").costMicros
      : model.costMicros;
  const reservation = await reserveBudget(db, costMicros, effectiveBudgetUsd(c.env, appSettings));
  if (!reservation) {
    const refusal = refuseBudget(appSettings);
    return (await replay()) ?? c.json(refusal, refusal.status);
  }

  // Admins aren't charged; their renders still count toward the global fal budget.
  // Strict source fidelity costs two credits because its Canny-controlled route costs
  // materially more than the standard image/reference routes.
  const credits = isAdmin ? 0 : baseCreditCostForRender(generationSettings) * appSettings.creditsPerImage;
  try {
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
      });
    } catch (error) {
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
    const job = await submitRender(c.env, db, created, origin);
    return c.json({ job: await presentRender(c, job) }, 201);
  } finally {
    await releaseBudgetReservation(db, reservation);
  }
});

/** Queues a faithful high-resolution export from a finished render. */
renders.post("/:id/upscale", async (c) => {
  const { clerkId } = c.get("auth");
  const { target, idempotencyKey } = createUpscaleSchema.parse(await c.req.json());
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
  const allowance = await checkAllowance(db, user, appSettings, "render", billing.plan);
  if (allowance) return (await replay()) ?? c.json(allowance, allowance.status);

  const model = modelFor(effectiveEngineMode(c.env, appSettings), "upscale");
  const costMicros = model.id === "mock" ? 0 : UPSCALE_COST_MICROS[target];
  const reservation = await reserveBudget(db, costMicros, effectiveBudgetUsd(c.env, appSettings));
  if (!reservation) {
    const refusal = refuseBudget(appSettings);
    return (await replay()) ?? c.json(refusal, refusal.status);
  }

  const credits = user.role === "admin" ? 0 : baseCreditCostForRender({ upscale: { target, parentRenderId: parent.id } }) * appSettings.creditsPerImage;
  try {
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
    });
    const job = await submitRender(c.env, db, created, origin);
    return c.json({ job: await presentRender(c, job) }, 201);
  } catch (error) {
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
