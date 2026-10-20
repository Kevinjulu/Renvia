import { Hono, type Context } from "hono";
import { createDb, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { sweepStaleRenders } from "../lib/engine.js";
import { syncOperationalIncidents } from "../lib/incidents.js";
import { renewDueCreditPeriods } from "../lib/planCredits.js";
import { endLapsedSubscriptions } from "../lib/subscriptions.js";
import { OPERATIONS_SYNC_JOB, runScheduledJob } from "../lib/scheduledJobs.js";
import { runBetaHousekeeping } from "../lib/betaHousekeeping.js";
import { runStorageCleanup } from "../lib/storageCleanup.js";

export const cron = new Hono<{ Bindings: Env }>();

function authorized(c: Context<{ Bindings: Env }>) {
  const secret = c.env.CRON_SECRET;
  return Boolean(secret) && c.req.header("authorization") === `Bearer ${secret}`;
}

/**
 * Advances renders still in flight and turns failed or stuck work into incidents, under a lease
 * so overlapping calls skip. The fal webhook is the primary path; this is the safety net for a
 * webhook that never fires (a local origin, a dropped delivery, a cold-start timeout).
 */
function runOperationsSync(env: Env, db: Database, origin: string) {
  return runScheduledJob(db, OPERATIONS_SYNC_JOB, async () => {
    const swept = await sweepStaleRenders(env, db, origin);
    const incidents = await syncOperationalIncidents(env, db);
    return { swept, incidents };
  });
}

/**
 * Frequent operations sync, meant to be called every 5–15 minutes by a scheduler holding
 * CRON_SECRET. Vercel Hobby only allows daily crons, so .github/workflows/operations-sync.yml
 * calls this instead.
 */
cron.get("/operations-sync", async (c) => {
  if (!authorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = createDb(c.env.DATABASE_URL);
  return c.json(await runOperationsSync(c.env, db, new URL(c.req.url).origin));
});

/**
 * Daily run from Vercel Cron (see vercel.json): the operations sync above, then the monthly
 * credit periods that are due, for users who haven't signed in since their renewal date
 * (signing in renews them straight away), beta housekeeping, and the storage sweep.
 */
cron.get("/sweep-renders", async (c) => {
  if (!authorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = createDb(c.env.DATABASE_URL);
  const operations = await runOperationsSync(c.env, db, new URL(c.req.url).origin);
  // Lapsed paid plans move to Free first, so their accounts renew on the Free schedule.
  const subscriptions = await endLapsedSubscriptions(db);
  const credits = await renewDueCreditPeriods(db);
  // Beta testers past their end date, leftover beta credits, and old feedback screenshots.
  const beta = await runBetaHousekeeping(c.env, db);
  // Uploads nothing uses any more, and files of renders removed from history or deleted.
  const storage = await runStorageCleanup(c.env, db);
  return c.json({ ...(operations.ran ? operations.result : { swept: 0, incidents: null, skipped: operations.reason }), subscriptions, credits, beta, storage });
});
