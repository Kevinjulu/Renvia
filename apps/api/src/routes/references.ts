import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUserId } from "../lib/users.js";
import { getSettings } from "../lib/settings.js";
import { objectKeyFor, publicUploadUrl, putObject } from "../lib/storage.js";
import { ImportImageError, importImageFromUrl } from "../lib/importImage.js";

export const references = new Hono<AppContext>();

references.use("*", requireAuth);

const createReferenceSchema = z.object({
  url: z.string().url(),
  source: z.enum(["upload", "unsplash", "url"]).default("upload"),
});

references.get("/", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const rows = await db
    .select()
    .from(schema.referenceImages)
    .where(eq(schema.referenceImages.ownerId, ownerId))
    .orderBy(desc(schema.referenceImages.createdAt));

  return c.json({ references: rows });
});

references.post("/", async (c) => {
  const { clerkId } = c.get("auth");
  const body = createReferenceSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  // A pasted link is copied into our own storage: it may be a page rather than an image, and a
  // site that allows it today may block hotlinking by the time the render runs.
  let url = body.url;
  if (body.source === "url") {
    const settings = await getSettings(db);
    try {
      const image = await importImageFromUrl(body.url, settings.maxUploadMb * 1024 * 1024);
      const key = objectKeyFor(clerkId, image.contentType);
      await putObject(c.env, key, image.bytes, image.contentType);
      url = publicUploadUrl(new URL(c.req.url).origin, key);
    } catch (error) {
      if (error instanceof ImportImageError) return c.json({ error: error.message }, 422);
      throw error;
    }
  }

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const [created] = await db
    .insert(schema.referenceImages)
    .values({ ownerId, url, source: body.source })
    .returning();

  return c.json(created, 201);
});

references.delete("/:id", async (c) => {
  const { clerkId } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const existing = await db.query.referenceImages.findFirst({
    where: and(eq(schema.referenceImages.id, id), eq(schema.referenceImages.ownerId, ownerId)),
  });
  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  await db.delete(schema.referenceImages).where(eq(schema.referenceImages.id, id));
  return c.json({ id });
});
