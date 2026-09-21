import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, getOrCreateUserId } from "../lib/users.js";
import { createChargedRender, InsufficientCreditsError } from "../lib/credits.js";
import { findOwnedProject } from "../lib/projects.js";
import { renderRouteFor } from "@renvia/types";
import { getBudget, refreshRender, submitRender, wouldExceedBudget } from "../lib/engine.js";
import { effectiveEngineMode, getSettings } from "../lib/settings.js";
import { checkAllowance, refuseBudget, refuseCredits, refuseDisabled, refuseInput, resolveLimits } from "../lib/limits.js";
import { modelFor } from "../lib/models.js";
import { ownUploadKey } from "../lib/storage.js";

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
  generationSettings: z
    .object({
      sourceType: z.enum(["drawing", "photo"]).optional(),
      styleInfluence: z.number().int().min(1).max(4).optional(),
      editInfluence: z.number().int().min(1).max(4).optional(),
      preserveStructure: z.boolean().optional(),
      // Hard ceiling; app_settings.max_reference_images is the one operators tune.
      referenceImageUrls: z.array(z.string().url()).max(16).optional(),
      edit: z
        .object({
          mode: z.enum(["element", "building", "prompt"]),
          action: z.enum(["add", "remove", "change"]).optional(),
          maskImageUrl: z.string().url().optional(),
        })
        .optional(),
      // fal seeds are non-negative 32-bit ints; validated loosely here since an out-of-range
      // value just gets rejected by fal itself rather than doing anything unsafe.
      seed: z.number().int().min(0).max(2_147_483_647).optional(),
    })
    .optional(),
});

renders.post("/", async (c) => {
  const { clerkId } = c.get("auth");
  const body = createRenderSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(c.env, db, clerkId);
  const appSettings = await getSettings(db);
  if (user.disabled) {
    const refusal = refuseDisabled(appSettings);
    return c.json(refusal, refusal.status);
  }
  const project = await findOwnedProject(db, body.projectId, user.id);
  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  const settings = body.generationSettings ?? {};
  const origin = new URL(c.req.url).origin;
  const maskImageUrl = settings.edit?.maskImageUrl;
  // The masked area is composited back from our own copies of the source and mask.
  if (maskImageUrl && (!ownUploadKey(body.sourceImageUrl, origin) || !ownUploadKey(maskImageUrl, origin))) {
    return c.json({ error: "Selection edits need an uploaded source image" }, 400);
  }

  const isAdmin = user.role === "admin";
  const limits = resolveLimits(user, appSettings);

  if (body.prompt.length > limits.maxPromptChars) {
    const refusal = refuseInput(appSettings, "prompt_too_long", limits.maxPromptChars, body.prompt.length);
    return c.json(refusal, refusal.status);
  }
  const referenceCount = settings.referenceImageUrls?.length ?? 0;
  if (referenceCount > limits.maxReferenceImages) {
    const refusal = refuseInput(appSettings, "too_many_references", limits.maxReferenceImages, referenceCount);
    return c.json(refusal, refusal.status);
  }

  const allowance = await checkAllowance(db, user, appSettings, "render");
  if (allowance) return c.json(allowance, allowance.status);

  const model = modelFor(effectiveEngineMode(c.env, appSettings), renderRouteFor(settings));
  if (await wouldExceedBudget(c.env, db, model.costMicros)) {
    const refusal = refuseBudget(appSettings);
    return c.json(refusal, refusal.status);
  }

  // Admins aren't charged; their renders still count toward the global fal budget.
  const credits = isAdmin ? 0 : appSettings.creditsPerImage;
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
      costMicros: model.costMicros,
      settings,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      const refusal = refuseCredits(appSettings, user.creditBalance, credits);
      return c.json(refusal, refusal.status);
    }
    throw error;
  }

  const job = await submitRender(c.env, db, created, origin);
  return c.json({ job }, 201);
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
    .where(eq(schema.renders.projectId, projectId))
    .orderBy(desc(schema.renders.createdAt));

  const origin = new URL(c.req.url).origin;
  return c.json({ jobs: await Promise.all(jobs.map((job) => refreshRender(c.env, db, job, origin))) });
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

  return c.json({ job: await refreshRender(c.env, db, row[0].render, new URL(c.req.url).origin) });
});
