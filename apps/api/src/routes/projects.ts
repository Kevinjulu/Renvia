import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index";
import { requireAuth } from "../middleware/auth";
import { getOrCreateUserId } from "../lib/users";
import { findOwnedProject } from "../lib/projects";

export const projects = new Hono<AppContext>();

projects.use("*", requireAuth);

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

projects.post("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const body = createProjectSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const [created] = await db
    .insert(schema.projects)
    .values({ ownerId, name: body.name })
    .returning();

  return c.json(created, 201);
});

projects.get("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, ownerId))
    .orderBy(desc(schema.projects.createdAt));

  return c.json({ projects: rows });
});

projects.get("/:id", async (c) => {
  const { clerkId, email } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const project = await findOwnedProject(db, id, ownerId);

  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(project);
});

projects.patch("/:id", async (c) => {
  const { clerkId, email } = c.get("auth");
  const id = c.req.param("id");
  const body = updateProjectSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const existing = await findOwnedProject(db, id, ownerId);
  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  const [updated] = await db
    .update(schema.projects)
    .set({ name: body.name, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning();

  return c.json(updated);
});

projects.delete("/:id", async (c) => {
  const { clerkId, email } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const existing = await findOwnedProject(db, id, ownerId);
  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  // No cascade on the FKs — clear dependent rows before the project itself.
  await db.delete(schema.renders).where(eq(schema.renders.projectId, id));
  await db.delete(schema.canvasNodes).where(eq(schema.canvasNodes.projectId, id));
  await db.delete(schema.projects).where(eq(schema.projects.id, id));

  return c.json({ id });
});
