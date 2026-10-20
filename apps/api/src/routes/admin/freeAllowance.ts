import { Hono } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { schema } from "@renvia/db";
import type { AdminFreeAllowanceAssessment, AdminFreeAllowanceResponse } from "@renvia/types";
import { ensureEntitlement, getBillingEntitlement, type EntitlementRow } from "../../lib/billing.js";
import { assessFreeAllowance, freeCreditsStatus, isFreeAllowance, type FreeAllowanceOutcome } from "../../lib/freeAllowance.js";
import { ensureCreditPeriod } from "../../lib/planCredits.js";
import { getSettings } from "../../lib/settings.js";
import { denyUnless, hasPermission } from "./permissions.js";
import { adminEventInsert } from "./shared.js";
import type { AdminContext } from "./context.js";
import type { UserRole } from "@renvia/types";

/**
 * An account's Free-allowance eligibility (lib/freeAllowance.ts): its status, every assessment and
 * decision behind it, and operators' decisions. A decision only governs the Free plan's monthly
 * credits from the next period on; it never changes a balance, a plan or anything already granted.
 */
export const freeAllowanceRoutes = new Hono<AdminContext>();

const DECISION_STATUS: Record<"approve" | "review" | "deny", FreeAllowanceOutcome> = {
  approve: "approved",
  review: "review_required",
  deny: "denied",
};

async function present(db: AdminContext["Variables"]["db"], userId: string): Promise<AdminFreeAllowanceResponse | null> {
  const [billing, settings] = await Promise.all([getBillingEntitlement(db, userId), getSettings(db)]);
  if (!billing) return null;
  const decider = alias(schema.users, "decider");
  const [deciderRow] = billing.entitlement.freeAllowanceDecidedBy
    ? await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, billing.entitlement.freeAllowanceDecidedBy))
    : [];
  const rows = await db
    .select({ assessment: schema.freeAllowanceAssessments, deciderEmail: decider.email })
    .from(schema.freeAllowanceAssessments)
    .leftJoin(decider, eq(schema.freeAllowanceAssessments.decidedBy, decider.id))
    .where(eq(schema.freeAllowanceAssessments.userId, userId))
    .orderBy(desc(schema.freeAllowanceAssessments.createdAt))
    .limit(20);
  const entitlement = billing.entitlement;
  const assessments: AdminFreeAllowanceAssessment[] = rows.map(({ assessment, deciderEmail }) => ({
    id: assessment.id,
    kind: assessment.kind,
    outcome: assessment.outcome,
    mode: assessment.mode,
    score: assessment.score,
    ruleVersion: assessment.ruleVersion,
    reason: assessment.reason,
    signals: assessment.signals,
    decidedByEmail: deciderEmail,
    createdAt: assessment.createdAt.toISOString(),
  }));
  return {
    status: entitlement.freeAllowanceStatus,
    reason: entitlement.freeAllowanceReason,
    decidedAt: entitlement.freeAllowanceDecidedAt?.toISOString() ?? null,
    decidedByEmail: deciderRow?.email ?? null,
    approvedUntil: entitlement.freeAllowanceApprovedUntil?.toISOString() ?? null,
    ruleVersion: entitlement.freeAllowanceRuleVersion,
    assessedAt: entitlement.freeAllowanceAssessedAt?.toISOString() ?? null,
    mode: settings.freeAllowanceMode,
    freePlan: isFreeAllowance(billing),
    held: freeCreditsStatus(billing, settings.freeAllowanceMode).held,
    assessments,
  };
}

freeAllowanceRoutes.get("/users/:id/free-allowance", async (c) => {
  const denied = denyUnless(c, "security.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const id = z.string().uuid().parse(c.req.param("id"));
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id));
  if (!user) return c.json({ error: "Not found" }, 404);
  await ensureEntitlement(db, id);
  return c.json(await present(db, id));
});

const decisionSchema = z
  .object({
    decision: z.enum(["approve", "review", "deny", "reassess"]),
    reason: z.string().trim().min(1).max(300),
    approvedUntil: z.string().datetime().nullable().optional(),
  })
  .strict();

/** Only the entitlement row as it was read: a decision made meanwhile isn't overwritten. */
function unchanged(entitlement: EntitlementRow) {
  return and(
    eq(schema.userEntitlements.userId, entitlement.userId),
    eq(schema.userEntitlements.freeAllowanceStatus, entitlement.freeAllowanceStatus),
    entitlement.freeAllowanceDecidedAt
      ? eq(schema.userEntitlements.freeAllowanceDecidedAt, entitlement.freeAllowanceDecidedAt)
      : isNull(schema.userEntitlements.freeAllowanceDecidedAt),
  );
}

freeAllowanceRoutes.post("/users/:id/free-allowance", async (c) => {
  const denied = denyUnless(c, "security.review"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const actor = c.get("admin");
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = decisionSchema.parse(await c.req.json());
  const [user] = await db.select({ id: schema.users.id, email: schema.users.email, createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, id));
  if (!user) return c.json({ error: "Not found" }, 404);

  const billing = await ensureEntitlement(db, id);
  const before = billing.entitlement;
  // Denying, and undoing a denial, is an admin's call; support can approve, review and reassess.
  const touchesDenial = body.decision === "deny" || before.freeAllowanceStatus === "denied";
  if (touchesDenial && !hasPermission(actor.role as UserRole, "security.manage")) {
    return c.json({ error: "Only an admin can deny an account's free credits or lift a denial", code: "forbidden" }, 403);
  }
  const approvedUntil = body.decision === "approve" && body.approvedUntil ? new Date(body.approvedUntil) : null;
  if (approvedUntil && approvedUntil <= new Date()) return c.json({ error: "Approved-until must be in the future", code: "invalid_request" }, 400);

  const settings = await getSettings(db);
  const now = new Date();
  if (body.decision === "reassess") {
    const status = await assessFreeAllowance(db, id, before, "operator", settings, now);
    await adminEventInsert(db, {
      actorId: actor.id, action: "security.decision", targetType: "user", targetId: id,
      summary: `Reassessed free credits for ${user.email}: ${before.freeAllowanceStatus} → ${status}`,
      detail: { decision: "reassess", before: before.freeAllowanceStatus, after: status, reason: body.reason },
    });
  } else {
    const status = DECISION_STATUS[body.decision];
    try {
      await db.batch([
      db
        .update(schema.userEntitlements)
        .set({
          freeAllowanceStatus: status,
          freeAllowanceReason: body.reason,
          freeAllowanceDecidedAt: now,
          freeAllowanceDecidedBy: actor.id,
          freeAllowanceRuleVersion: null,
          freeAllowanceApprovedUntil: approvedUntil,
          updatedAt: now,
        })
        .where(unchanged(before)),
      // Aborts the whole batch (division by zero) unless the update above applied, so a decision
      // made meanwhile by someone else is never recorded over.
      db.execute(sql`select 1 / (case when exists (
        select 1 from ${schema.userEntitlements}
        where ${schema.userEntitlements.userId} = ${id} and ${schema.userEntitlements.freeAllowanceDecidedAt} = ${now} and ${schema.userEntitlements.freeAllowanceDecidedBy} = ${actor.id}
      ) then 1 else 0 end) as applied`),
      db.insert(schema.freeAllowanceAssessments).values({
        userId: id, kind: "operator", outcome: status, mode: settings.freeAllowanceMode, reason: body.reason, decidedBy: actor.id, createdAt: now,
        signals: approvedUntil ? { approvedUntil: approvedUntil.toISOString() } : {},
      }),
      adminEventInsert(db, {
        actorId: actor.id, action: "security.decision", targetType: "user", targetId: id,
        summary: `Free credits for ${user.email}: ${before.freeAllowanceStatus} → ${status}`,
        detail: { decision: body.decision, before: before.freeAllowanceStatus, after: status, reason: body.reason, approvedUntil: approvedUntil?.toISOString() ?? null },
      }),
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === "22012" || (error as { cause?: { code?: string } }).cause?.code === "22012") {
        return c.json({ error: "This account's eligibility changed while you were deciding. Reload and try again.", code: "conflict" }, 409);
      }
      throw error;
    }
  }

  // An approval takes effect straight away: a Free period that's due starts now, granted once.
  const fresh = await getBillingEntitlement(db, id);
  const granted = fresh ? await ensureCreditPeriod(db, id, user.createdAt, fresh, now) : false;
  return c.json({ ...(await present(db, id)), granted });
});
