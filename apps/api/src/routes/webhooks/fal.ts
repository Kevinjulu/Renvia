import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb, schema } from "@renvia/db";
import type { Env } from "../../index.js";
import { refreshRender } from "../../lib/engine.js";

export const falWebhook = new Hono<{ Bindings: Env }>();

const payloadSchema = z.object({ request_id: z.string().min(1) });

/**
 * The payload is only used to find which render to refresh — refreshRender re-reads the
 * status and result from fal with our own key, so a forged call can't inject a result
 * and signature verification isn't needed.
 */
falWebhook.post("/", async (c) => {
  const parsed = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid payload" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [render] = await db
    .select()
    .from(schema.renders)
    .where(eq(schema.renders.falRequestId, parsed.data.request_id))
    .limit(1);
  if (!render) {
    return c.json({ error: "Not found" }, 404);
  }

  await refreshRender(c.env, db, render, new URL(c.req.url).origin);
  return c.json({ received: true });
});
