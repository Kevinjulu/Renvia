import { Hono } from "hono";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import { isDesignCategory, type ListStockReferencesResponse, type UseSampleDesignResponse } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveAccount } from "../middleware/activeAccount.js";
import { rateLimit } from "../lib/rateLimit.js";
import { getOrCreateUser, getOrCreateUserId } from "../lib/users.js";
import { reserveUploadStorage } from "../lib/limits.js";
import { getSettings } from "../lib/settings.js";
import { getObject, objectKeyFor, publicUploadUrl, putObject, releaseUpload, signedUploadUrl } from "../lib/storage.js";
import { ImportImageError, importImageFromUrl } from "../lib/importImage.js";
import { optimizeUpload, UnreadableImageError } from "../lib/optimizeImage.js";
import { presentForViewer } from "../lib/presentAsset.js";
import { presentStockReference } from "../lib/stockReferences.js";

export const references = new Hono<AppContext>();

references.use("*", requireAuth);
references.use("*", requireActiveAccount);

const createReferenceSchema = z.object({
  url: z.string().url(),
  source: z.enum(["upload", "url"]).default("upload"),
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

  const origin = new URL(c.req.url).origin;
  return c.json({ references: await Promise.all(rows.map(async (row) => ({ ...row, url: await presentForViewer(c, origin, row.url) }))) });
});

/** The team's sample references, grouped by category in their display order. Hidden ones are left out. */
references.get("/stock", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(schema.stockReferences)
    .where(eq(schema.stockReferences.hidden, false))
    .orderBy(asc(schema.stockReferences.sortOrder), desc(schema.stockReferences.createdAt));

  const origin = new URL(c.req.url).origin;
  const response: ListStockReferencesResponse = {
    references: await Promise.all(rows.map((row) => presentStockReference(c.env, origin, row))),
  };
  return c.json(response);
});

/**
 * Starts a project from a sample design: copies it into the caller's own storage and hands back a
 * link to the copy, which they place as an elevation like any upload. A copy (rather than a link
 * to the shared sample) means an admin hiding or deleting the sample later can't break a project,
 * and it counts toward the caller's storage like their own upload. Reference samples aren't
 * copied; they're attached by link.
 */
references.post("/stock/:id/use", rateLimit("upload"), async (c) => {
  const { clerkId } = c.get("auth");
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "Not found" }, 404);
  const db = createDb(c.env.DATABASE_URL);

  const sample = await db.query.stockReferences.findFirst({
    where: and(eq(schema.stockReferences.id, id.data), eq(schema.stockReferences.hidden, false)),
  });
  if (!sample) return c.json({ error: "Not found" }, 404);
  if (!isDesignCategory(sample.category)) {
    return c.json({ error: "Only sample designs can be used as an elevation", code: "not_a_design" }, 400);
  }

  const object = await getObject(c.env, sample.key);
  if (!object) return c.json({ error: "That sample is unavailable right now" }, 404);
  const bytes = await new Response(object.body).arrayBuffer();

  const settings = await getSettings(db);
  const user = await getOrCreateUser(c.env, db, clerkId);
  const key = objectKeyFor(clerkId, object.contentType);
  const refusal = await reserveUploadStorage(db, user, clerkId, settings, key, bytes.byteLength, object.contentType);
  if (refusal) return c.json(refusal, refusal.status);
  try {
    await putObject(c.env, key, bytes, object.contentType);
  } catch (error) {
    await releaseUpload(db, key);
    throw error;
  }

  const response: UseSampleDesignResponse = { publicUrl: await signedUploadUrl(c.env, new URL(c.req.url).origin, key) };
  return c.json(response, 201);
});

references.post("/", rateLimit("upload"), async (c) => {
  const { clerkId } = c.get("auth");
  const body = createReferenceSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  // A pasted link is copied into our own storage: it may be a page rather than an image, and a
  // site that allows it today may block hotlinking by the time the render runs.
  let url = body.url;
  if (body.source === "url") {
    const settings = await getSettings(db);
    try {
      const imported = await importImageFromUrl(body.url, settings.maxUploadMb * 1024 * 1024);
      const image = await optimizeUpload(imported.bytes, imported.contentType);
      const key = objectKeyFor(clerkId, image.contentType);
      const refusal = await reserveUploadStorage(db, await getOrCreateUser(c.env, db, clerkId), clerkId, settings, key, image.bytes.byteLength, image.contentType);
      if (refusal) return c.json(refusal, refusal.status);
      try {
        await putObject(c.env, key, image.bytes, image.contentType);
      } catch (error) {
        await releaseUpload(db, key);
        throw error;
      }
      url = publicUploadUrl(new URL(c.req.url).origin, key);
    } catch (error) {
      if (error instanceof ImportImageError || error instanceof UnreadableImageError) return c.json({ error: error.message }, 422);
      throw error;
    }
  }

  const ownerId = await getOrCreateUserId(c.env, db, clerkId);
  const [created] = await db
    .insert(schema.referenceImages)
    .values({ ownerId, url, source: body.source })
    .returning();

  return c.json({ ...created, url: await presentForViewer(c, new URL(c.req.url).origin, created!.url) }, 201);
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
