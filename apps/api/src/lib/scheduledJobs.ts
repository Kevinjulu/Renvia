import { eq, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";

export type ScheduledJobRow = typeof schema.scheduledJobs.$inferSelect;

export type ScheduledRun<T> = { ran: true; result: T } | { ran: false; reason: "already_running" };

/**
 * Runs `work` under a lease so overlapping triggers (a slow run, a retried cron call, a manual
 * sync) skip instead of doing the same work twice, and records the outcome for the admin.
 *
 * The lease is taken with one conditional upsert, so of two simultaneous callers only one gets
 * the row. It expires on its own after `leaseMinutes`, so a run that died can't block forever.
 */
export async function runScheduledJob<T extends Record<string, unknown>>(
  db: Database,
  name: string,
  work: () => Promise<T>,
  leaseMinutes = 5,
): Promise<ScheduledRun<T>> {
  const leaseUntil = sql`now() + (${leaseMinutes}::int * interval '1 minute')`;
  const [claimed] = await db
    .insert(schema.scheduledJobs)
    .values({ name, leaseUntil, lastStartedAt: sql`now()`, runCount: 1 })
    .onConflictDoUpdate({
      target: schema.scheduledJobs.name,
      set: { leaseUntil, lastStartedAt: sql`now()`, runCount: sql`${schema.scheduledJobs.runCount} + 1` },
      setWhere: or(isNull(schema.scheduledJobs.leaseUntil), lt(schema.scheduledJobs.leaseUntil, sql`now()`)),
    })
    .returning({ name: schema.scheduledJobs.name });
  if (!claimed) return { ran: false, reason: "already_running" };

  try {
    const result = await work();
    await db
      .update(schema.scheduledJobs)
      .set({ leaseUntil: null, lastSuccessAt: sql`now()`, lastError: null, lastResult: result })
      .where(eq(schema.scheduledJobs.name, name));
    return { ran: true, result };
  } catch (error) {
    await db
      .update(schema.scheduledJobs)
      .set({ leaseUntil: null, lastFailureAt: sql`now()`, lastError: error instanceof Error ? error.message.slice(0, 500) : "Scheduled job failed" })
      .where(eq(schema.scheduledJobs.name, name));
    throw error;
  }
}

export async function scheduledJob(db: Database, name: string): Promise<ScheduledJobRow | null> {
  const [row] = await db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.name, name)).limit(1);
  return row ?? null;
}

/** The job that advances stuck renders and turns failures into incidents. */
export const OPERATIONS_SYNC_JOB = "operations-sync";
