import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { BetaMission, BetaMissionRule } from "@renvia/types";
import type { BetaEnrollmentRow } from "./beta.js";

/**
 * Testing missions (docs/beta-testing-system.md §7.4). A verified mission is checked against
 * records Renvia already keeps (finished renders, selections, feedback) since the tester enrolled;
 * nothing tracks what testers click. Progress rows exist only once a mission is complete.
 */

const JOB_TYPES = ["photo", "drawing", "references", "fidelity", "edit", "edit-references", "upscale"] as const;
const FEEDBACK_CATEGORIES = ["architecture_changed", "materials_wrong", "render_failed", "render_stuck", "edit_wrong", "ui_problem", "billing_credits", "other"] as const;
const count = z.number().int().min(1).max(100);

export const missionRuleSchema: z.ZodType<BetaMissionRule> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("render_succeeded"), jobTypes: z.array(z.enum(JOB_TYPES)).min(1).max(JOB_TYPES.length).optional(), count }).strict(),
  z.object({ kind: z.literal("selection_succeeded"), count }).strict(),
  z.object({ kind: z.literal("feedback_submitted"), categories: z.array(z.enum(FEEDBACK_CATEGORIES)).min(1).max(FEEDBACK_CATEGORIES.length).optional(), count }).strict(),
  z.object({ kind: z.literal("manual") }).strict(),
]);

type MissionRow = typeof schema.betaMissions.$inferSelect;

/** How many qualifying results the tester has produced since enrolling. */
async function qualifyingCount(db: Database, enrollment: BetaEnrollmentRow, rule: BetaMissionRule): Promise<number> {
  const since = enrollment.enrolledAt;
  if (rule.kind === "render_succeeded") {
    const jobTypes = rule.jobTypes?.length ? sql`and r.job_type in (${sql.join(rule.jobTypes.map((type) => sql`${type}`), sql`, `)})` : sql``;
    const result = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from renders r join projects p on p.id = r.project_id
      where p.owner_id = ${enrollment.userId} and r.status = 'succeeded' and r.created_at >= ${since.toISOString()}::timestamptz ${jobTypes}
    `);
    return Number(result.rows[0]?.n ?? 0);
  }
  if (rule.kind === "selection_succeeded") {
    const result = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from segmentations
      where user_id = ${enrollment.userId} and status = 'succeeded' and coalesce(object_count, 0) > 0 and created_at >= ${since.toISOString()}::timestamptz
    `);
    return Number(result.rows[0]?.n ?? 0);
  }
  if (rule.kind === "feedback_submitted") {
    const categories = rule.categories?.length ? sql`and category in (${sql.join(rule.categories.map((category) => sql`${category}`), sql`, `)})` : sql``;
    const result = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from beta_feedback where enrollment_id = ${enrollment.id} ${categories}
    `);
    return Number(result.rows[0]?.n ?? 0);
  }
  return 0;
}

function targetOf(rule: BetaMissionRule): number {
  return rule.kind === "manual" ? 1 : rule.count;
}

/**
 * The program's missions with this tester's progress. Verified missions that are now satisfied
 * are recorded as complete (once; the primary key makes a repeat a no-op). One count query per
 * unfinished verified mission, so a handful of missions costs a handful of indexed queries.
 */
export async function missionsFor(db: Database, enrollment: BetaEnrollmentRow): Promise<BetaMission[]> {
  const [missions, progress] = await Promise.all([
    db.select().from(schema.betaMissions).where(eq(schema.betaMissions.programId, enrollment.programId)).orderBy(asc(schema.betaMissions.position), asc(schema.betaMissions.createdAt)),
    db.select().from(schema.betaMissionProgress).where(eq(schema.betaMissionProgress.enrollmentId, enrollment.id)),
  ]);
  const done = new Map(progress.map((row) => [row.missionId, row.completedAt]));
  return Promise.all(
    missions.map(async (mission: MissionRow): Promise<BetaMission> => {
      const target = targetOf(mission.rule);
      const base = { id: mission.id, title: mission.title, instructions: mission.instructions, required: mission.required, kind: mission.rule.kind, target };
      const completedAt = done.get(mission.id);
      if (completedAt) return { ...base, count: target, completedAt: completedAt.toISOString() };
      if (mission.rule.kind === "manual") return { ...base, count: 0, completedAt: null };
      const reached = await qualifyingCount(db, enrollment, mission.rule);
      if (reached < target) return { ...base, count: reached, completedAt: null };
      const [recorded] = await db
        .insert(schema.betaMissionProgress)
        .values({ enrollmentId: enrollment.id, missionId: mission.id, source: "auto" })
        .onConflictDoNothing()
        .returning({ completedAt: schema.betaMissionProgress.completedAt });
      return { ...base, count: target, completedAt: (recorded?.completedAt ?? new Date()).toISOString() };
    }),
  );
}

/** A tester ticks a manual mission done; verified missions can't be ticked by hand. */
export async function completeManualMission(db: Database, enrollment: BetaEnrollmentRow, missionId: string): Promise<"done" | "not_found" | "verified_only"> {
  const [mission] = await db
    .select()
    .from(schema.betaMissions)
    .where(and(eq(schema.betaMissions.id, missionId), eq(schema.betaMissions.programId, enrollment.programId)));
  if (!mission) return "not_found";
  if (mission.rule.kind !== "manual") return "verified_only";
  await db.insert(schema.betaMissionProgress).values({ enrollmentId: enrollment.id, missionId, source: "tester" }).onConflictDoNothing();
  return "done";
}
