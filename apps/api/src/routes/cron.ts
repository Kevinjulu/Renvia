import { Hono } from "hono";
import { createDb } from "@renvia/db";
import type { Env } from "../index.js";
import { sweepStaleRenders } from "../lib/engine.js";

export const cron = new Hono<{ Bindings: Env }>();

/**
 * Safety net behind the fal webhook: a render whose webhook never fires (a local/non-https
 * origin, a dropped delivery, a cold-start timeout) would otherwise sit at "processing"
 * forever, since nothing else re-checks it once its tab is gone. Vercel calls this on a
 * schedule (see vercel.json) with a bearer token matching CRON_SECRET.
 */
cron.get("/sweep-renders", async (c) => {
  const secret = c.env.CRON_SECRET;
  if (!secret || c.req.header("authorization") !== `Bearer ${secret}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const db = createDb(c.env.DATABASE_URL);
  const swept = await sweepStaleRenders(c.env, db, new URL(c.req.url).origin);
  return c.json({ swept });
});
