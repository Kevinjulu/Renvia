import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUserId } from "../lib/users.js";
import { findOwnedProject } from "../lib/projects.js";
import { buildRenderPrompt } from "../lib/prompts.js";
import { inngest } from "../lib/inngest.js";

export const renders = new Hono<AppContext>();

renders.use("*", requireAuth);

const createRenderSchema = z.object({
  projectId: z.string().uuid(),
  sourceImageUrl: z.string().url(),
  prompt: z.string().trim().min(1).max(2000),
  resolution: z.string().trim().min(1).max(20),
  style: z.string().trim().min(1).max(50),
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

  const [created] = await db
    .insert(schema.renders)
    .values({
      projectId: body.projectId,
      sourceImageUrl: body.sourceImageUrl,
      prompt: buildRenderPrompt(body.prompt),
      resolution: body.resolution,
      style: body.style,
      status: "pending",
    })
    .returning();

  if (!created) {
    return c.json({ error: "Internal error" }, 500);
  }

  await inngest.send({ name: "render/requested", data: { renderId: created.id } });

  return c.json({ job: created }, 201);
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

  return c.json({ jobs });
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

  return c.json({ job: row[0].render });
});
