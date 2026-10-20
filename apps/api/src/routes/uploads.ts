import { Hono } from "hono";
import type { UploadImageResponse } from "@renvia/types";
import type { AppContext, Env } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  directObjectUrl,
  getObject,
  hasValidSignature,
  isWatermarkedKey,
  objectExists,
  objectKeyFor,
  putObject,
  signedUploadUrl,
  storageWouldExceed,
  type ServedImage,
} from "../lib/storage.js";
import { servedThumbnailKey, watermarkedCopy } from "../lib/watermark.js";
import { makeThumbnail, optimizeUpload, UnreadableImageError } from "../lib/optimizeImage.js";
import { createDb } from "@renvia/db";
import { getSettings } from "../lib/settings.js";
import { checkUploadStorage, refuseInput } from "../lib/limits.js";
import { getOrCreateUser } from "../lib/users.js";

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
  const user = await getOrCreateUser(c.env, db, clerkId);
  const refusal = await checkUploadStorage(db, user, clerkId, settings, image.bytes.byteLength);
  if (refusal) return c.json(refusal, refusal.status);
  const key = objectKeyFor(clerkId, image.contentType);

  await putObject(c.env, key, image.bytes, image.contentType);

  const response: UploadImageResponse = { publicUrl: await signedUploadUrl(c.env, new URL(c.req.url).origin, key) };
  return c.json(response, 201);
});

uploads.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const url = new URL(c.req.url);
  if (!(await hasValidSignature(c.env, key, url))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // A watermarked copy is made from its original the first time anyone opens it.
  const full = (): Promise<ServedImage | null> => (isWatermarkedKey(key) ? watermarkedCopy(c.env, key) : Promise.resolve({ key }));
  // ?size=thumb on any signed link serves the small copy of the same image, so grids and tables
  // don't download full-size originals. The signature covers the key, so this grants nothing new.
  const served = url.searchParams.get("size") === "thumb" ? await thumbnail(c.env, key, full) : await full();

  if (!served) {
    return c.json({ error: "Not found" }, 404);
  }

  // Bytes made for this request only (storage is at its cap) can't be linked to, so they're sent.
  if (!("key" in served)) {
    return new Response(served.body, { headers: { "Content-Type": served.contentType, "Cache-Control": "private, no-store" } });
  }

  // Everything stored is downloaded straight from the bucket, so image bytes never pass through
  // this function. The direct link stays the same for an hour and expires with this one, so the
  // browser can keep the redirect too. private: a shared cache must not extend access beyond
  // the signature.
  const direct = await directObjectUrl(c.env, served.key, Number(url.searchParams.get("expires")));
  return new Response(null, {
    status: 302,
    headers: { Location: direct.url, "Cache-Control": `private, max-age=${direct.maxAge}` },
  });
});

async function bytesOf(env: Env, served: ServedImage): Promise<Uint8Array | null> {
  const object = "key" in served ? await getObject(env, served.key) : served;
  return object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
}

/** The thumbnail of `key`, made from `full()` and stored the first time it is asked for. */
async function thumbnail(env: Env, key: string, full: () => Promise<ServedImage | null>): Promise<ServedImage | null> {
  const thumbnailKey = servedThumbnailKey(key);
  if (await objectExists(env, thumbnailKey)) return { key: thumbnailKey };
  const original = await full();
  const source = original && (await bytesOf(env, original));
  if (!source) return null;
  let bytes: ArrayBuffer;
  try {
    bytes = await makeThumbnail(source);
  } catch {
    // Not something sharp can read: serve the full image rather than a broken tile.
    return full();
  }
  // Once storage is at its cap the thumbnail is made fresh for each request instead of stored.
  const db = createDb(env.DATABASE_URL);
  if (!(await storageWouldExceed(db, (await getSettings(db)).storageCapMb, bytes.byteLength))) {
    await putObject(env, thumbnailKey, bytes, "image/webp");
    return { key: thumbnailKey };
  }
  return { body: new Blob([bytes], { type: "image/webp" }).stream(), contentType: "image/webp" };
}
