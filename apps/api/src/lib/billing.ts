import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Database } from "@renvia/db";

export const STARTER_PLAN_SLUG = "starter";

export type BillingPlanRow = typeof schema.billingPlans.$inferSelect;
export type EntitlementRow = typeof schema.userEntitlements.$inferSelect;

export interface BillingEntitlement {
  entitlement: EntitlementRow;
  /** The plan in effect right now: an active admin override, otherwise the base plan. */
  plan: BillingPlanRow;
  /** The plan the user holds in their own right (Starter, or a paid subscription). */
  basePlan: BillingPlanRow;
  /** The admin-granted plan, while it applies. */
  override: { plan: BillingPlanRow; endsAt: Date | null } | null;
}

/** An override applies from when it is set until its end date; null means until cleared. */
export function overrideIsActive(entitlement: Pick<EntitlementRow, "overridePlanId" | "overrideEndsAt">, now = new Date()): boolean {
  return entitlement.overridePlanId !== null && (entitlement.overrideEndsAt === null || entitlement.overrideEndsAt > now);
}

/**
 * Every account receives an explicit Starter entitlement. This is deliberately separate
 * from the welcome-credit grant: an account may have no credits and still be Starter.
 */
export async function ensureEntitlement(db: Database, userId: string): Promise<BillingEntitlement> {
  const existing = await getBillingEntitlement(db, userId);
  if (existing) return existing;

  const [starter] = await db
    .select()
    .from(schema.billingPlans)
    .where(and(eq(schema.billingPlans.slug, STARTER_PLAN_SLUG), eq(schema.billingPlans.isActive, true)))
    .limit(1);
  if (!starter) throw new Error("Starter billing plan is not configured");

  await db
    .insert(schema.userEntitlements)
    .values({ userId, planId: starter.id, status: "active" })
    .onConflictDoNothing({ target: schema.userEntitlements.userId });

  const created = await getBillingEntitlement(db, userId);
  if (!created) throw new Error("Failed to create user entitlement");
  return created;
}

const overridePlans = alias(schema.billingPlans, "override_plans");

export async function getBillingEntitlement(db: Database, userId: string): Promise<BillingEntitlement | null> {
  const [row] = await db
    .select({ entitlement: schema.userEntitlements, basePlan: schema.billingPlans, overridePlan: overridePlans })
    .from(schema.userEntitlements)
    .innerJoin(schema.billingPlans, eq(schema.userEntitlements.planId, schema.billingPlans.id))
    .leftJoin(overridePlans, eq(schema.userEntitlements.overridePlanId, overridePlans.id))
    .where(eq(schema.userEntitlements.userId, userId))
    .limit(1);
  if (!row) return null;
  const override = row.overridePlan && overrideIsActive(row.entitlement) ? { plan: row.overridePlan, endsAt: row.entitlement.overrideEndsAt } : null;
  return { entitlement: row.entitlement, plan: override?.plan ?? row.basePlan, basePlan: row.basePlan, override };
}
