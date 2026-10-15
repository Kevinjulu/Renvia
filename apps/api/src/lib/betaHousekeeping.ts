import { and, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { Env } from "../index.js";
import { expireBetaCredits, settleBetaCredits } from "./beta.js";
import { CLOSED_STATUSES } from "./betaFeedback.js";
import { deleteObject } from "./storage.js";

/** Screenshots are kept this long after their report is closed; reports and threads stay. */
export const ATTACHMENT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * The daily beta sweep (docs/beta-testing-system.md §4.5, §6.4), for users who don't come back to
 * trigger the lazy settle themselves: testers past their end date are completed and their beta
 * credits expire, leftover beta credits without a live enrollment expire, and screenshots of
 * reports closed more than 90 days ago are deleted. Each step is idempotent and bounded per run.
 */
export async function runBetaHousekeeping(env: Env, db: Database, now = new Date()) {
  const ended = await db.execute<{ user_id: string }>(sql`
    select e.user_id from beta_enrollments e join beta_programs p on p.id = e.program_id
    where e.status in ('active', 'suspended') and (coalesce(e.ends_at, p.ends_at) <= ${now.toISOString()}::timestamptz or p.status = 'ended')
    limit ${BATCH}
  `);
  let completed = 0;
  for (const { user_id: userId } of ended.rows) {
    const { context } = await settleBetaCredits(db, userId, { now });
    if (!context) completed += 1;
  }

  const leftovers = await db.execute<{ id: string }>(sql`
    select u.id from users u
    where u.beta_credits > 0 and not exists (select 1 from beta_enrollments e where e.user_id = u.id and e.status in ('active', 'suspended'))
    limit ${BATCH}
  `);
  let creditsExpired = 0;
  for (const { id } of leftovers.rows) creditsExpired += await expireBetaCredits(db, id, null, { unlessLive: true });

  const stale = await db
    .select({ id: schema.betaFeedback.id, key: schema.betaFeedback.attachmentKey })
    .from(schema.betaFeedback)
    .where(and(
      isNotNull(schema.betaFeedback.attachmentKey),
      inArray(schema.betaFeedback.status, [...CLOSED_STATUSES]),
      lt(schema.betaFeedback.resolvedAt, new Date(now.getTime() - ATTACHMENT_RETENTION_DAYS * DAY_MS)),
    ))
    .limit(BATCH);
  let attachmentsDeleted = 0;
  for (const { id, key } of stale) {
    try {
      await deleteObject(env, key!);
    } catch (error) {
      // Left for the next run; the report keeps pointing at it until it's really gone.
      console.error(JSON.stringify({ level: "warn", event: "beta.attachment_delete_failed", feedbackId: id, error: error instanceof Error ? error.message : String(error) }));
      continue;
    }
    await db.update(schema.betaFeedback).set({ attachmentKey: null }).where(sql`${schema.betaFeedback.id} = ${id}`);
    attachmentsDeleted += 1;
  }

  return { completed, creditsExpired, attachmentsDeleted };
}
