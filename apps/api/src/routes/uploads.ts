import { Hono } from "hono";
import type { UploadImageResponse } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getObject, hasValidSignature, isWatermarkedKey, objectKeyFor, putObject, signedUploadUrl, storageWouldExceed, thumbnailKeyFor, type StoredObject } from "../lib/storage.js";
import { watermarkedObject } from "../lib/watermark.js";
import { makeThumbnail, optimizeUpload, UnreadableImageError } from "../lib/optimizeImage.js";
import { createDb } from "@renvia/db";
import { getSettings } from "../lib/settings.js";
import { refuseInput, refuseStorage } from "../lib/limits.js";

export const uploads = new Hono<AppContext>();

const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

uploads.post("/", requireAuth, async (c) => {
  const { clerkId } = c.get("auth");
  const contentType = c.req.header("Content-Type") ?? "";

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return c.json({ error: "Unsupported content type" }, 400);
  }

  const settings = await getSettings(createDb(c.env.DATABASE_URL));
  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  // Checked before reading the body when the client declares a length, and again after
  // for chunked uploads that don't.
  const declared = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const refusal = refuseInput(settings, "upload_too_large", settings.maxUploadMb, Math.ceil(declared / (1024 * 1024)));
    return c.json(refusal, refusal.status);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    const refusal = refuseInput(settings, "upload_too_large", settings.maxUploadMb, Math.ceil(bytes.byteLength / (1024 * 1024)));
    return c.json(refusal, refusal.status);
  }
  // A selection mask must keep every pixel of its source's size and edges, so it is stored as
  // sent; everything else is turned upright, capped and stripped of metadata.
  let image: { bytes: ArrayBuffer; contentType: string };
  if (c.req.header("X-Upload-Kind") === "mask" && contentType === "image/png") {
    image = { bytes, contentType };
  } else {
    try {
      image = await optimizeUpload(bytes, contentType);
    } catch (error) {
      if (error instanceof UnreadableImageError) return c.json({ error: error.message }, 400);
      throw error;
    }
  }

  const db = createDb(c.env.DATABASE_URL);
  if (await storageWouldExceed(db, settings.storageCapMb, image.bytes.byteLength)) {
    const refusal = refuseStorage(settings);
    return c.json(refusal, refusal.status);
  }
  const key = objectKeyFor(clerkId, image.contentType);

  await putObject(c.env, key, image.bytes, image.contentType);

  const response: UploadImageResponse = { publicUrl: await signedUploadUrl(c.env, new URL(c.req.url).origin, key) };
  return c.json(response, 201);
});

uploads.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!(await hasValidSignature(c.env, key, new URL(c.req.url)))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // A watermarked copy is made from its original the first time anyone opens it.
  const load = () => (isWatermarkedKey(key) ? watermarkedObject(c.env, key) : getObject(c.env, key));
  // ?size=thumb on any signed link serves the small copy of the same image, so grids and tables
  // don't download full-size originals. The signature covers the key, so this grants nothing new.
  const object = new URL(c.req.url).searchParams.get("size") === "thumb" ? await thumbnailObject(c.env, key, load) : await load();

  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  // Objects never change once written, and linkExpiry keeps the link stable for hours, so the
  // browser keeps its copy until the link expires instead of downloading it on every view.
  // private: a shared cache must not extend access beyond the signature.
  const maxAge = Math.max(0, Number(new URL(c.req.url).searchParams.get("expires")) - Math.floor(Date.now() / 1000));
  return new Response(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": `private, max-age=${maxAge}, immutable`,
    },
  });
});

/** The stored thumbnail of `key`, made from `load()` and stored the first time it is asked for. */
async function thumbnailObject(env: AppContext["Bindings"], key: string, load: () => Promise<StoredObject | null>): Promise<StoredObject | null> {
  const thumbnailKey = thumbnailKeyFor(key);
  const existing = await getObject(env, thumbnailKey);
  if (existing) return existing;
  const original = await load();
  if (!original) return null;
  let bytes: ArrayBuffer;
  try {
    bytes = await makeThumbnail(new Uint8Array(await new Response(original.body).arrayBuffer()));
  } catch {
    // Not something sharp can read: serve the original rather than a broken tile.
    return load();
  }
  // Once storage is at its cap the thumbnail is made fresh for each request instead of stored.
  const db = createDb(env.DATABASE_URL);
  if (!(await storageWouldExceed(db, (await getSettings(db)).storageCapMb, bytes.byteLength))) {
    await putObject(env, thumbnailKey, bytes, "image/webp");
  }
  return { body: new Blob([bytes], { type: "image/webp" }).stream(), contentType: "image/webp" };
}
