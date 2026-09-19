import { Hono } from "hono";
import type { UploadImageResponse } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getObject, objectKeyFor, publicUploadUrl, putObject } from "../lib/storage.js";

export const uploads = new Hono<AppContext>();

const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

uploads.post("/", requireAuth, async (c) => {
  const { clerkId } = c.get("auth");
  const contentType = c.req.header("Content-Type") ?? "";

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return c.json({ error: "Unsupported content type" }, 400);
  }

  const bytes = await c.req.arrayBuffer();
  const key = objectKeyFor(clerkId, contentType);

  await putObject(c.env, key, bytes, contentType);

  const response: UploadImageResponse = { publicUrl: publicUploadUrl(new URL(c.req.url).origin, key) };
  return c.json(response, 201);
});

uploads.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const object = await getObject(c.env, key);

  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
