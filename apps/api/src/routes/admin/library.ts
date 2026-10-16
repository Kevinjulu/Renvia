import { Hono } from "hono";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@renvia/db";
import { REFERENCE_CATEGORIES, type AdminStockReference, type AdminStockReferencesResponse, type ReferenceCategory } from "@renvia/types";
import type { AdminContext } from "./context.js";
import { denyUnless } from "./permissions.js";
import { adminEventInsert } from "./shared.js";
import { deleteObject, putObject, storageWouldExceed } from "../../lib/storage.js";
import { getSettings } from "../../lib/settings.js";
import { refuseStorage } from "../../lib/limits.js";
import {
  compressStockImage,
  MAX_STOCK_UPLOAD_BYTES,
  presentStockReference,
  StockImageTooLargeError,
  stockReferenceKey,
} from "../../lib/stockReferences.js";

/**
 * Sample reference images shown to every Studio user under the library's category chips.
 * Admin-only; every change is recorded as library.update.
 */
export const libraryRoutes = new Hono<AdminContext>();

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const categorySchema = z.enum(REFERENCE_CATEGORIES.map((category) => category.key) as [ReferenceCategory, ...ReferenceCategory[]]);
const captionSchema = z.string().trim().max(120).transform((value) => value || null);
const categoryLabel = (key: ReferenceCategory) => REFERENCE_CATEGORIES.find((category) => category.key === key)!.label;

type StockRow = typeof schema.stockReferences.$inferSelect;

async function toAdmin(c: { env: AdminContext["Bindings"] }, origin: string, row: StockRow, bytes: number): Promise<AdminStockReference> {
  return { ...(await presentStockReference(c.env, origin, row)), hidden: row.hidden, sortOrder: row.sortOrder, bytes, createdAt: row.createdAt.toISOString() };
}

libraryRoutes.get("/library", async (c) => {
  const denied = denyUnless(c, "library.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const rows = await db
    .select({ row: schema.stockReferences, bytes: schema.storageObjects.bytes })
    .from(schema.stockReferences)
    .leftJoin(schema.storageObjects, eq(schema.storageObjects.key, schema.stockReferences.key))
    .orderBy(asc(schema.stockReferences.sortOrder), desc(schema.stockReferences.createdAt));
  const origin = new URL(c.req.url).origin;
  const references = await Promise.all(rows.map(({ row, bytes }) => toAdmin(c, origin, row, bytes ?? 0)));
  const response: AdminStockReferencesResponse = { references, totalBytes: references.reduce((sum, item) => sum + item.bytes, 0) };
  return c.json(response);
});

/** The image is the raw request body; the caption, if any, rides in the query string. */
libraryRoutes.post("/library/:category", async (c) => {
  const denied = denyUnless(c, "library.manage"); if (denied) return c.json(denied, 403);
  const category = categorySchema.parse(c.req.param("category"));
  const caption = captionSchema.parse(c.req.query("caption") ?? "");
  const contentType = c.req.header("Content-Type") ?? "";
  if (!IMAGE_TYPES.has(contentType)) return c.json({ error: "Upload a PNG, JPEG or WebP image", code: "unsupported_type" }, 400);
  const declared = Number(c.req.header("Content-Length"));
  const tooLarge = { error: `That image is over ${MAX_STOCK_UPLOAD_BYTES / (1024 * 1024)} MB`, code: "upload_too_large" };
  if (Number.isFinite(declared) && declared > MAX_STOCK_UPLOAD_BYTES) return c.json(tooLarge, 413);

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_STOCK_UPLOAD_BYTES) return c.json(tooLarge, 413);
  let webp: Buffer;
  try {
    webp = await compressStockImage(bytes);
  } catch (error) {
    if (error instanceof StockImageTooLargeError) return c.json({ error: error.message, code: "upload_too_large" }, 413);
    return c.json({ error: "That file isn't an image we can read", code: "unreadable_image" }, 400);
  }

  const db = c.get("db");
  const settings = await getSettings(db);
  if (await storageWouldExceed(db, settings.storageCapMb, webp.byteLength)) {
    const refusal = refuseStorage(settings);
    return c.json(refusal, refusal.status);
  }

  const key = stockReferenceKey(category);
  await putObject(c.env, key, webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength) as ArrayBuffer, "image/webp");

  // New samples go to the end of their category.
  const [last] = await db
    .select({ max: sql<number | null>`max(${schema.stockReferences.sortOrder})` })
    .from(schema.stockReferences)
    .where(eq(schema.stockReferences.category, category));
  const id = crypto.randomUUID();
  const actor = c.get("admin");
  const [[created]] = await db.batch([
    db.insert(schema.stockReferences).values({ id, category, key, caption, sortOrder: (last?.max ?? -1) + 1, createdBy: actor.id }).returning(),
    adminEventInsert(db, {
      actorId: actor.id, action: "library.update", targetType: "stock_reference", targetId: id,
      summary: `Added a ${categoryLabel(category)} sample`, detail: { category, caption, bytes: webp.byteLength },
    }),
  ]);
  return c.json(await toAdmin(c, new URL(c.req.url).origin, created!, webp.byteLength), 201);
});

const updateSchema = z.object({ caption: captionSchema.optional(), hidden: z.boolean().optional() });

libraryRoutes.patch("/library/:id", async (c) => {
  const denied = denyUnless(c, "library.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = updateSchema.parse(await c.req.json());
  const db = c.get("db");
  const existing = await db.query.stockReferences.findFirst({ where: eq(schema.stockReferences.id, id) });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const changes = [
    body.caption !== undefined && body.caption !== existing.caption ? "caption" : null,
    body.hidden !== undefined && body.hidden !== existing.hidden ? (body.hidden ? "hidden" : "shown") : null,
  ].filter(Boolean);
  if (changes.length === 0) {
    const [object] = await db.select({ bytes: schema.storageObjects.bytes }).from(schema.storageObjects).where(eq(schema.storageObjects.key, existing.key));
    return c.json(await toAdmin(c, new URL(c.req.url).origin, existing, object?.bytes ?? 0));
  }

  const actor = c.get("admin");
  const [[updated]] = await db.batch([
    db.update(schema.stockReferences).set({ caption: body.caption, hidden: body.hidden }).where(eq(schema.stockReferences.id, id)).returning(),
    adminEventInsert(db, {
      actorId: actor.id, action: "library.update", targetType: "stock_reference", targetId: id,
      summary: `Updated a ${categoryLabel(existing.category)} sample (${changes.join(", ")})`,
      detail: { before: { caption: existing.caption, hidden: existing.hidden }, after: body },
    }),
  ]);
  const [object] = await db.select({ bytes: schema.storageObjects.bytes }).from(schema.storageObjects).where(eq(schema.storageObjects.key, existing.key));
  return c.json(await toAdmin(c, new URL(c.req.url).origin, updated!, object?.bytes ?? 0));
});

/** Sets one category's order: `ids` lists every sample in it, first to last. */
libraryRoutes.post("/library/order/:category", async (c) => {
  const denied = denyUnless(c, "library.manage"); if (denied) return c.json(denied, 403);
  const category = categorySchema.parse(c.req.param("category"));
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(await c.req.json());
  const db = c.get("db");
  const current = await db.select({ id: schema.stockReferences.id }).from(schema.stockReferences).where(eq(schema.stockReferences.category, category));
  const known = new Set(current.map((row) => row.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    return c.json({ error: "The list changed while you were ordering it; reload and try again.", code: "stale_order" }, 409);
  }
  if (ids.length === 0) return c.json({ ok: true });

  const actor = c.get("admin");
  await db.batch([
    db
      .update(schema.stockReferences)
      .set({ sortOrder: sql`case ${sql.join(ids.map((id, index) => sql`when ${schema.stockReferences.id} = ${id} then ${index}`), sql` `)} end` })
      .where(inArray(schema.stockReferences.id, ids)),
    adminEventInsert(db, {
      actorId: actor.id, action: "library.update", targetType: "stock_reference", targetId: null,
      summary: `Reordered ${categoryLabel(category)} samples`, detail: { category, ids },
    }),
  ]);
  return c.json({ ok: true });
});

/** Removes the stored image too. Renders that already used it keep their own result. */
libraryRoutes.delete("/library/:id", async (c) => {
  const denied = denyUnless(c, "library.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const db = c.get("db");
  const existing = await db.query.stockReferences.findFirst({ where: eq(schema.stockReferences.id, id) });
  if (!existing) return c.json({ error: "Not found" }, 404);

  try {
    await deleteObject(c.env, existing.key);
  } catch (error) {
    return c.json({ error: `The image couldn't be removed from storage; try again. (${error instanceof Error ? error.message : "storage error"})`, code: "storage_error" }, 502);
  }
  const actor = c.get("admin");
  await db.batch([
    db.delete(schema.stockReferences).where(eq(schema.stockReferences.id, id)),
    adminEventInsert(db, {
      actorId: actor.id, action: "library.update", targetType: "stock_reference", targetId: id,
      summary: `Deleted a ${categoryLabel(existing.category)} sample`, detail: { category: existing.category, caption: existing.caption, key: existing.key },
    }),
  ]);
  return c.json({ deleted: true });
});
