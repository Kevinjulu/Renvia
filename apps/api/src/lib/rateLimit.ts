import { createMiddleware } from "hono/factory";
import { sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@renvia/db";
import type { AppContext } from "../index.js";

/**
 * Per-account request limits on the routes that cost money or storage, so a script can't hammer
 * them even within its credits and caps. Fixed one-minute windows counted in Postgres (one upsert
 * per limited request), keyed by the signed-in Clerk user. Generous enough that a person never
 * meets them. If the counter can't be reached the request is let through: the caps, credits and
 * budgets behind each route still hold.
 */

export const RATE_LIMITS = {
  render: 20,
  selection: 30,
  polish: 20,
  upload: 30,
  project: 10,
  checkout: 10,
  claim: 10,
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

const WINDOW_SECONDS = 60;

/** Counts one request; returns how many this window has seen, and when the window ends. */
export async function countRequest(db: Database, bucket: RateBucket, subject: string, now = new Date()): Promise<{ hits: number; resetsAt: Date }> {
  const windowStart = new Date(Math.floor(now.getTime() / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000);
  const [row] = await db
    .insert(schema.rateLimitHits)
    .values({ bucket, subject, windowStart, hits: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimitHits.bucket, schema.rateLimitHits.subject, schema.rateLimitHits.windowStart],
      set: { hits: sql`${schema.rateLimitHits.hits} + 1` },
    })
    .returning({ hits: schema.rateLimitHits.hits });
  return { hits: row?.hits ?? 1, resetsAt: new Date(windowStart.getTime() + WINDOW_SECONDS * 1000) };
}

/** Route middleware: refuses with 429 rate_limited past RATE_LIMITS[bucket] requests a minute. Needs requireAuth first. */
export function rateLimit(bucket: RateBucket) {
  return createMiddleware<AppContext>(async (c, next) => {
    let counted: { hits: number; resetsAt: Date } | null = null;
    try {
      counted = await countRequest(createDb(c.env.DATABASE_URL), bucket, c.get("auth").clerkId);
    } catch (error) {
      console.error(JSON.stringify({ level: "warn", event: "rate_limit.unavailable", bucket, error: error instanceof Error ? error.message : String(error) }));
    }
    if (counted && counted.hits > RATE_LIMITS[bucket]) {
      const retryAfter = Math.max(1, Math.ceil((counted.resetsAt.getTime() - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests. Please wait a moment and try again.", code: "rate_limited", retryAfter, requestId: c.get("requestId") }, 429);
    }
    await next();
  });
}

/** Drops counters older than a day (daily cron). */
export async function purgeRateLimits(db: Database): Promise<void> {
  await db.delete(schema.rateLimitHits).where(sql`${schema.rateLimitHits.windowStart} < now() - interval '1 day'`);
}
