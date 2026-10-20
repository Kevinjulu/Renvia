import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { getOrCreateUser, syncUser } from "../lib/users.js";
import { effectiveEngineMode, getSettings } from "../lib/settings.js";
import { getUsage, limitMessages, resolveLimits } from "../lib/limits.js";
import { ensureEntitlement } from "../lib/billing.js";
import { currentStudioRevision, effectiveCreditPrices, effectiveMaintenance, featureAvailability } from "../lib/studioControl.js";
import { settleBetaCredits, type BetaContext } from "../lib/beta.js";
import { canClaimFreeAllowance, claimFreeAllowance, freeCreditsStatus } from "../lib/freeAllowance.js";
import { ensureCreditPeriod } from "../lib/planCredits.js";
import { hashSignals, requestSignals } from "../lib/securitySignals.js";
import { z } from "zod";
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

  // Called once per studio load, so it also refreshes the stored email from Clerk, and (while
  // the operator has switched signals on) notes the hashed browser and network it came from.
  const settings = await getSettings(db);
  const signals = settings.securitySignalsEnabled ? await hashSignals(c.env, requestSignals(c.env, (name) => c.req.header(name))) : null;
  const synced = await syncUser(c.env, db, clerkId, signals);
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
    freeCredits: freeCreditsStatus(billing, settings.freeAllowanceMode, canClaimFreeAllowance(c.env, billing.entitlement, user.emailVerified, settings.freeAllowanceMode)),
    creditPrices: effectiveCreditPrices(revision.config, settings),
    configVersion: revision.version,
  });
});

const claimSchema = z.object({ turnstileToken: z.string().trim().min(1).max(2048) }).strict();

const CLAIM_REFUSALS = {
  not_claimable: { status: 409, error: "Your free credits can't be released this way. Contact support if you think this is a mistake." },
  too_many_attempts: { status: 429, error: "Too many attempts. Try again in an hour." },
  check_failed: { status: 400, error: "The check didn't pass. Please try again." },
  check_unavailable: { status: 503, error: "The check isn't available right now. Please try again in a few minutes." },
} as const;

/**
 * Clears a verification hold on the Free plan's monthly credits with the Cloudflare Turnstile
 * check. Only the token comes from the browser; whether the account may claim, and what it gets,
 * is decided here. A pass grants the month that's due, once.
 */
me.post("/free-credits/claim", rateLimit("claim"), async (c) => {
  const { clerkId } = c.get("auth");
  const { turnstileToken } = claimSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, clerkId);
  if (user.disabled) return c.json({ error: "Account disabled", code: "account_disabled" }, 403);
  const billing = await ensureEntitlement(db, user.id);
  const trusted = (c.env.TRUSTED_IP_HEADER?.trim() || "x-real-ip").toLowerCase();
  const remoteIp = c.req.header(trusted)?.split(",")[0]?.trim() || null;
  const result = await claimFreeAllowance(c.env, db, user.id, billing.entitlement, user.emailVerified, turnstileToken, remoteIp);
  if (!result.ok) {
    const refusal = CLAIM_REFUSALS[result.code];
    return c.json({ error: refusal.error, code: result.code }, refusal.status);
  }
  const fresh = await ensureEntitlement(db, user.id);
  const granted = await ensureCreditPeriod(db, user.id, user.createdAt, fresh);
  const after = granted ? await getOrCreateUser(c.env, db, clerkId) : user;
  return c.json({ status: result.status, granted, creditBalance: after.creditBalance });
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
