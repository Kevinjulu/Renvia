import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, syncUser } from "../lib/users.js";
import { effectiveEngineMode, getSettings } from "../lib/settings.js";
import { getUsage, limitMessages, resolveLimits } from "../lib/limits.js";
import { ensureEntitlement } from "../lib/billing.js";
import { currentStudioRevision, effectiveCreditPrices, effectiveMaintenance, featureAvailability } from "../lib/studioControl.js";
import { settleBetaCredits, type BetaContext } from "../lib/beta.js";
import { freeCreditsStatus } from "../lib/freeAllowance.js";
import type { MeBeta, StudioFeatureKey } from "@renvia/types";

export const me = new Hono<AppContext>();

me.use("*", requireAuth);

function presentBeta({ program, enrollment, endsAt, running }: BetaContext): MeBeta {
  return {
    programId: program.id,
    programName: program.name,
    status: enrollment.status === "suspended" ? "suspended" : "active",
    running,
    endsAt: endsAt.toISOString(),
    downloadsUnlocked: program.downloadsUnlocked,
    featureGrants: program.featureGrants as StudioFeatureKey[],
  };
}

me.get("/", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  // Called once per studio load, so it also refreshes the stored email from Clerk.
  const [synced, settings] = await Promise.all([syncUser(c.env, db, clerkId), getSettings(db)]);
  // Closes a beta enrollment past its end and expires its credits before reporting the balance.
  const { context: beta, expired } = await settleBetaCredits(db, synced.id, { betaCredits: synced.betaCredits });
  const user = expired > 0 ? await getOrCreateUser(c.env, db, clerkId) : synced;
  const betaProgram = beta?.running ? beta.program : null;
  const billing = await ensureEntitlement(db, user.id);
  const [usage, revision, maintenance] = await Promise.all([getUsage(db, user.id), currentStudioRevision(db), effectiveMaintenance(db, settings)]);

  return c.json({
    ...user,
    limits: resolveLimits(user, settings, billing.plan, betaProgram),
    entitlement: {
      plan: billing.plan,
      // An admin-granted plan is in force regardless of the base subscription's state.
      status: billing.override ? "active" : billing.entitlement.status,
      currentPeriodStart: billing.entitlement.currentPeriodStart,
      currentPeriodEnd: billing.entitlement.currentPeriodEnd,
      cancelAtPeriodEnd: billing.entitlement.cancelAtPeriodEnd,
      billingInterval: billing.override ? null : billing.entitlement.billingInterval,
      provider: billing.entitlement.provider,
      autoRenews: !billing.override && Boolean(billing.entitlement.providerSubscriptionId) && !billing.entitlement.cancelAtPeriodEnd && billing.entitlement.status === "active",
      monthlyCreditsRemaining: user.planCredits,
      monthlyAllowance: billing.plan.monthlyCredits,
      nextCreditRenewalAt: billing.entitlement.nextCreditGrantAt?.toISOString() ?? null,
      complimentary: billing.override ? { endsAt: billing.override.endsAt?.toISOString() ?? null } : null,
    },
    usage,
    limitMessages: limitMessages(settings),
    creditsPerImage: settings.creditsPerImage,
    creditsPerSelection: settings.creditsPerSelection,
    // The Settings switches and any scheduled window running now.
    maintenanceRenders: maintenance.renders,
    maintenanceSegments: maintenance.selections,
    maintenanceMessage: maintenance.message,
    upcomingMaintenance: maintenance.next
      ? { scope: maintenance.next.scope, startsAt: maintenance.next.startsAt.toISOString(), endsAt: maintenance.next.endsAt.toISOString(), message: maintenance.next.message }
      : null,
    features: featureAvailability(revision.config, user, billing.plan.slug, effectiveEngineMode(c.env, settings), betaProgram?.featureGrants),
    beta: beta ? presentBeta(beta) : null,
    freeCredits: freeCreditsStatus(billing, settings.freeAllowanceMode),
    creditPrices: effectiveCreditPrices(revision.config, settings),
    configVersion: revision.version,
  });
});

/** Balance plus the most recent ledger entries, for the studio's credits page. */
me.get("/credits", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(c.env, db, clerkId);
  const entries = await db
    .select({
      id: schema.creditLedger.id,
      amount: schema.creditLedger.amount,
      reason: schema.creditLedger.reason,
      renderId: schema.creditLedger.renderId,
      note: schema.creditLedger.note,
      createdAt: schema.creditLedger.createdAt,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, user.id))
    .orderBy(desc(schema.creditLedger.createdAt))
    .limit(50);

  // Dates serialize to the ISO strings MeCreditsResponse declares.
  return c.json({ creditBalance: user.creditBalance, entries });
});
