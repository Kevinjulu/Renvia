import { Hono } from "hono";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, getOrCreateUserId } from "../lib/users.js";
import { createChargedRender, InsufficientCreditsError } from "../lib/credits.js";
import { findOwnedProject } from "../lib/projects.js";
import { CREDITS_PER_IMAGE, renderRouteFor } from "@renvia/types";
import { getBudget, refreshRender, submitRender, wouldExceedBudget } from "../lib/engine.js";
import { effectiveEngineMode, getSettings } from "../lib/settings.js";
import { modelFor } from "../lib/models.js";
import { ownUploadKey } from "../lib/storage.js";

export const renders = new Hono<AppContext>();

renders.use("*", requireAuth);

const createRenderSchema = z.object({
  projectId: z.string().uuid(),
  sourceImageUrl: z.string().url(),
  // Optional — the engine composes the full model prompt from style and settings.
  prompt: z.string().trim().max(2000),
  resolution: z.string().trim().min(1).max(20),
  style: z.string().trim().min(1).max(50),
  viewKey: z.string().trim().min(1).max(80).optional(),
  viewLabel: z.string().trim().min(1).max(80).optional(),
  generationSettings: z
    .object({
      sourceType: z.enum(["drawing", "photo"]).optional(),
      styleInfluence: z.number().int().min(1).max(4).optional(),
      preserveStructure: z.boolean().optional(),
      referenceImageUrls: z.array(z.string().url()).max(8).optional(),
      edit: z
        .object({
          mode: z.enum(["element", "building", "prompt"]),
          action: z.enum(["add", "remove", "change"]).optional(),
          maskImageUrl: z.string().url().optional(),
        })
        .optional(),
    })
    .optional(),
});

renders.post("/", async (c) => {
  const { clerkId } = c.get("auth");
  const body = createRenderSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(c.env, db, clerkId);
  if (user.disabled) {
    return c.json({ error: "Account disabled", code: "account_disabled" }, 403);
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

  const appSettings = await getSettings(db);
  const isAdmin = user.role === "admin";

  if (!isAdmin && appSettings.dailyRenderLimit !== null) {
    // Failed renders were refunded, so they don't count toward the day's allowance.
    const [today] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(
        and(
          eq(schema.projects.ownerId, user.id),
          ne(schema.renders.status, "failed"),
          gte(schema.renders.createdAt, sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`),
        ),
      );
    if ((today?.count ?? 0) >= appSettings.dailyRenderLimit) {
      return c.json({ error: "Daily render limit reached", code: "daily_limit_reached" }, 429);
    }
  }

  const model = modelFor(effectiveEngineMode(c.env, appSettings), renderRouteFor(settings));
  if (await wouldExceedBudget(c.env, db, model.costMicros)) {
    return c.json({ error: "Render budget exhausted", code: "budget_exhausted" }, 402);
  }

  // Admins aren't charged; their renders still count toward the global fal budget.
  const credits = isAdmin ? 0 : CREDITS_PER_IMAGE;
  let created;
  try {
    created = await createChargedRender(db, user.id, credits, {
      projectId: body.projectId,
      sourceImageUrl: body.sourceImageUrl,
      prompt: body.prompt,
      resolution: body.resolution,
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
      return c.json({ error: "Not enough credits", code: "insufficient_credits" }, 402);
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
