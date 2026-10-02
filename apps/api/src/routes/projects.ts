import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, getOrCreateUserId } from "../lib/users.js";
import { findOwnedProject } from "../lib/projects.js";
import { getSettings } from "../lib/settings.js";
import { refuseInput, resolveLimits } from "../lib/limits.js";
import { deleteObject, ownUploadKey, presentUploadUrl } from "../lib/storage.js";

export const projects = new Hono<AppContext>();

projects.use("*", requireAuth);

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  thumbnailUrl: z.string().url().optional(),
});

projects.post("/", async (c) => {
  const { clerkId } = c.get("auth");
  const body = createProjectSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const [user, settings] = await Promise.all([getOrCreateUser(c.env, db, clerkId), getSettings(db)]);
  const { maxProjects } = resolveLimits(user, settings);
  if (maxProjects !== null) {
    const [owned] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(eq(schema.projects.ownerId, user.id));
    if ((owned?.count ?? 0) >= maxProjects) {
      const refusal = refuseInput(settings, "project_limit_reached", maxProjects, owned?.count ?? 0);
      return c.json(refusal, refusal.status);
    }
  }

  const [created] = await db
    .insert(schema.projects)
    .values({ ownerId: user.id, name: body.name })
    .returning();

  return c.json({ ...created, thumbnailUrl: await presentUploadUrl(c.env, new URL(c.req.url).origin, created!.thumbnailUrl) }, 201);
});

projects.get("/", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, ownerId))
    .orderBy(desc(schema.projects.createdAt));

  const origin = new URL(c.req.url).origin;
  return c.json({ projects: await Promise.all(rows.map(async (project) => ({ ...project, thumbnailUrl: await presentUploadUrl(c.env, origin, project.thumbnailUrl) }))) });
});

projects.get("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const project = await findOwnedProject(db, id, ownerId);

  if (!project) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ ...project, thumbnailUrl: await presentUploadUrl(c.env, new URL(c.req.url).origin, project.thumbnailUrl) });
});

projects.patch("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const id = c.req.param("id");
  const body = updateProjectSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const existing = await findOwnedProject(db, id, ownerId);
  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  const [updated] = await db
    .update(schema.projects)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.thumbnailUrl !== undefined ? { thumbnailUrl: body.thumbnailUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, id))
    .returning();

  return c.json({ ...updated, thumbnailUrl: await presentUploadUrl(c.env, new URL(c.req.url).origin, updated!.thumbnailUrl) });
});

projects.delete("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const existing = await findOwnedProject(db, id, ownerId);
  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  // Render outputs are generated uniquely per render, so unlike user uploads they cannot be
  // shared by another project and can be removed immediately. Source/reference uploads are
  // intentionally retained because they may be reused in another project or the asset library.
  const renderRows = await db
    .select({ resultImageUrl: schema.renders.resultImageUrl })
    .from(schema.renders)
    .where(eq(schema.renders.projectId, id));
  const origin = new URL(c.req.url).origin;
  const generatedKeys = renderRows
    .map((row) => row.resultImageUrl && ownUploadKey(row.resultImageUrl, origin))
    .filter((key): key is string => Boolean(key?.startsWith("renders/")));

  // No cascade on the FKs — clear dependent rows before the project itself.
  await db.delete(schema.renders).where(eq(schema.renders.projectId, id));
  await db.delete(schema.canvasNodes).where(eq(schema.canvasNodes.projectId, id));
  await db.delete(schema.projects).where(eq(schema.projects.id, id));

  await Promise.allSettled(generatedKeys.map((key) => deleteObject(c.env, key)));

  return c.json({ id });
});
