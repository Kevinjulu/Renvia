import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";

export const STARTER_PLAN_SLUG = "starter";

export type BillingPlanRow = typeof schema.billingPlans.$inferSelect;
export type EntitlementRow = typeof schema.userEntitlements.$inferSelect;

export interface BillingEntitlement {
  entitlement: EntitlementRow;
  plan: BillingPlanRow;
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

export async function getBillingEntitlement(db: Database, userId: string): Promise<BillingEntitlement | null> {
  const [row] = await db
    .select({ entitlement: schema.userEntitlements, plan: schema.billingPlans })
    .from(schema.userEntitlements)
    .innerJoin(schema.billingPlans, eq(schema.userEntitlements.planId, schema.billingPlans.id))
    .where(eq(schema.userEntitlements.userId, userId))
    .limit(1);
  return row ?? null;
}
