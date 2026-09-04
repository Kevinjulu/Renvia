import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUserId } from "../lib/users.js";
import { findOwnedProject } from "../lib/projects.js";

export const canvasNodes = new Hono<AppContext>();

canvasNodes.use("*", requireAuth);

const createCanvasNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.enum(["image", "compare-slider"]),
  data: z.record(z.unknown()),
});

const updateCanvasNodeSchema = z.object({
  data: z.record(z.unknown()),
});

canvasNodes.get("/", async (c) => {
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

  const nodes = await db
    .select()
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.projectId, projectId))
    .orderBy(asc(schema.canvasNodes.createdAt));

  return c.json({ nodes });
});

canvasNodes.post("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const body = createCanvasNodeSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const project = await findOwnedProject(db, body.projectId, ownerId);
  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  const [created] = await db.insert(schema.canvasNodes).values(body).returning();
  if (!created) {
    return c.json({ error: "Internal error" }, 500);
  }

  return c.json({ node: created }, 201);
});

canvasNodes.patch("/:id", async (c) => {
  const { clerkId, email } = c.get("auth");
  const id = c.req.param("id");
  const body = updateCanvasNodeSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const existing = await db
    .select({ node: schema.canvasNodes })
    .from(schema.canvasNodes)
    .innerJoin(schema.projects, eq(schema.canvasNodes.projectId, schema.projects.id))
    .where(and(eq(schema.canvasNodes.id, id), eq(schema.projects.ownerId, ownerId)))
    .limit(1);

  if (!existing[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const mergedData = { ...(existing[0].node.data as Record<string, unknown>), ...body.data };

  const [updated] = await db
    .update(schema.canvasNodes)
    .set({ data: mergedData, updatedAt: new Date() })
    .where(eq(schema.canvasNodes.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: "Internal error" }, 500);
  }

  return c.json({ node: updated });
});
