import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUserId } from "../lib/users.js";
import { findOwnedProject } from "../lib/projects.js";
import { renderRouteFor } from "@renvia/types";
import {
  engineMode,
  estimateCostMicros,
  getBudget,
  refreshRender,
  submitRender,
  wouldExceedBudget,
} from "../lib/engine.js";
import { modelFor } from "../lib/models.js";

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
  const { clerkId, email } = c.get("auth");
  const body = createRenderSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const project = await findOwnedProject(db, body.projectId, ownerId);
  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  const settings = body.generationSettings ?? {};
  const origin = new URL(c.req.url).origin;
  const model = modelFor(engineMode(c.env), renderRouteFor(settings));
  const costMicros = await estimateCostMicros(c.env, model, body.sourceImageUrl, origin);
  if (await wouldExceedBudget(c.env, db, costMicros)) {
    return c.json({ error: "Render budget exhausted" }, 402);
  }

  const [created] = await db
    .insert(schema.renders)
    .values({
      projectId: body.projectId,
      sourceImageUrl: body.sourceImageUrl,
      prompt: body.prompt,
      resolution: body.resolution,
      style: body.style,
      viewKey: body.viewKey,
      viewLabel: body.viewLabel,
      status: "pending",
      model: model.id,
      costMicros,
      settings,
    })
    .returning();

  if (!created) {
    return c.json({ error: "Internal error" }, 500);
  }

  const job = await submitRender(c.env, db, created, origin);
  return c.json({ job }, 201);
});

renders.get("/budget", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  return c.json(await getBudget(c.env, db));
});

renders.get("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const ownerId = await getOrCreateUserId(db, clerkId, email);
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
  const { clerkId, email } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
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
