import { Hono } from "hono";
import type { UploadImageResponse } from "@renvia/types";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getObject, objectKeyFor, putObject } from "../lib/storage.js";

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

  const origin = new URL(c.req.url).origin;
  // Hardcoded "/api" because the whole app is mounted under that prefix for
  // Vercel's api/ directory convention (see apps/api/api/[...route].ts) —
  // this is the one place an absolute externally-reachable URL is built by hand.
  const response: UploadImageResponse = { publicUrl: `${origin}/api/uploads/${key}` };
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
