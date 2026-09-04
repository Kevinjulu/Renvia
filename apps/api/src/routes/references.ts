import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUserId } from "../lib/users.js";

export const references = new Hono<AppContext>();

references.use("*", requireAuth);

const createReferenceSchema = z.object({
  url: z.string().url(),
  source: z.enum(["upload", "unsplash", "url"]).default("upload"),
});

references.get("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const rows = await db
    .select()
    .from(schema.referenceImages)
    .where(eq(schema.referenceImages.ownerId, ownerId))
    .orderBy(desc(schema.referenceImages.createdAt));

  return c.json({ references: rows });
});

references.post("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const body = createReferenceSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const [created] = await db
    .insert(schema.referenceImages)
    .values({ ownerId, url: body.url, source: body.source })
    .returning();

  return c.json(created, 201);
});

references.delete("/:id", async (c) => {
  const { clerkId, email } = c.get("auth");
  const id = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const ownerId = await getOrCreateUserId(db, clerkId, email);
  const existing = await db.query.referenceImages.findFirst({
    where: and(eq(schema.referenceImages.id, id), eq(schema.referenceImages.ownerId, ownerId)),
  });
  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  await db.delete(schema.referenceImages).where(eq(schema.referenceImages.id, id));
  return c.json({ id });
});
