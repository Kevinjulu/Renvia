import { Hono } from "hono";
import type { UploadImageResponse } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getObject, hasValidSignature, objectKeyFor, putObject, signedUploadUrl } from "../lib/storage.js";
import { createDb } from "@renvia/db";
import { getSettings } from "../lib/settings.js";
import { refuseInput } from "../lib/limits.js";

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
  const key = objectKeyFor(clerkId, contentType);

  await putObject(c.env, key, bytes, contentType);

  const response: UploadImageResponse = { publicUrl: await signedUploadUrl(c.env, new URL(c.req.url).origin, key) };
  return c.json(response, 201);
});

uploads.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!(await hasValidSignature(c.env, key, new URL(c.req.url)))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const object = await getObject(c.env, key);

  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.contentType,
      // Do not let a shared CDN extend access beyond the link's signature expiry.
      "Cache-Control": "private, no-store",
    },
  });
});
