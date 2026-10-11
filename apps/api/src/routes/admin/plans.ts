import { Hono, type Context } from "hono";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import {
  CREDIT_PRICE_LABELS,
  creditsForRender,
  featureDenial,
  STUDIO_FEATURES,
  type AdminCreditPack,
  type AdminCreditPackTerms,
  type AdminPlan,
  type AdminPlanTerms,
  type AdminPlansResponse,
  type AdminPricingSimulationResponse,
  type CreditPrices,
} from "@renvia/types";
import { STARTER_PLAN_SLUG } from "../../lib/billing.js";
import { modelFor, UPSCALE_COST_MICROS } from "../../lib/models.js";
import { SAM_COST_MICROS } from "../../lib/segment.js";
import { getSettings } from "../../lib/settings.js";
import { currentStudioRevision, effectiveCreditPrices } from "../../lib/studioControl.js";
import { denyUnless } from "./permissions.js";
import { governance, requestApproval } from "./governance.js";
import { adminEventInsert, MICROS_PER_USD } from "./shared.js";
import { publishOrRequest } from "./studioControl.js";
import type { AdminContext } from "./context.js";

export const plansRoutes = new Hono<AdminContext>();

type PlanRow = typeof schema.billingPlans.$inferSelect;
type PackRow = typeof schema.creditPacks.$inferSelect;

function planTerms(row: PlanRow): AdminPlanTerms {
  return {
    name: row.name,
    description: row.description,
    currency: row.currency,
    priceCents: row.priceCents,
    interval: row.interval,
    monthlyCredits: row.monthlyCredits,
    dailyRenderLimit: row.dailyRenderLimit,
    monthlyRenderLimit: row.monthlyRenderLimit,
    maxProjects: row.maxProjects,
    concurrentRenderLimit: row.concurrentRenderLimit,
    isActive: row.isActive,
    paypalPlanId: row.paypalPlanId,
  };
}

function packTerms(row: PackRow): AdminCreditPackTerms {
  return { name: row.name, currency: row.currency, priceCents: row.priceCents, credits: row.credits, isActive: row.isActive };
}

async function emailsFor(db: Database, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, string>();
  const rows = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, unique));
  return new Map(rows.map((row) => [row.id, row.email]));
}

plansRoutes.get("/plans", async (c) => {
  const denied = denyUnless(c, "billing.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const [plans, packs, planVersions, packVersions, subscribers, purchases, revision, settings] = await Promise.all([
    db.select().from(schema.billingPlans).orderBy(asc(schema.billingPlans.priceCents)),
    db.select().from(schema.creditPacks).orderBy(asc(schema.creditPacks.priceCents)),
    db.select().from(schema.billingPlanVersions).orderBy(desc(schema.billingPlanVersions.version)),
    db.select().from(schema.creditPackVersions).orderBy(desc(schema.creditPackVersions.version)),
    db.select({ planId: schema.userEntitlements.planId, count: sql<number>`count(*)::int` }).from(schema.userEntitlements).where(eq(schema.userEntitlements.status, "active")).groupBy(schema.userEntitlements.planId),
    db.select({ packId: schema.billingCheckouts.creditPackId, count: sql<number>`count(*)::int` }).from(schema.billingCheckouts).where(eq(schema.billingCheckouts.status, "paid")).groupBy(schema.billingCheckouts.creditPackId),
    currentStudioRevision(db),
    getSettings(db),
  ]);
  const emails = await emailsFor(db, [...planVersions.map((row) => row.createdBy), ...packVersions.map((row) => row.createdBy)]);
  const response: AdminPlansResponse = {
    plans: plans.map((plan): AdminPlan => {
      const versions = planVersions.filter((row) => row.planId === plan.id);
      return {
        id: plan.id,
        slug: plan.slug,
        ...planTerms(plan),
        version: versions[0]?.version ?? 0,
        subscribers: subscribers.find((row) => row.planId === plan.id)?.count ?? 0,
        versions: versions.slice(0, 10).map((row) => ({ version: row.version, terms: row.terms, reason: row.reason, createdByEmail: row.createdBy ? emails.get(row.createdBy) ?? null : null, createdAt: row.createdAt.toISOString() })),
        // Plan eligibility only: rollout is per user, so a partial rollout still shows as included.
        features: STUDIO_FEATURES.map(({ key }) => {
          const rule = revision.config.features[key];
          const denial = featureDenial({ ...rule, rolloutPercent: 100 }, { id: "", planSlug: plan.slug }, key);
          return { key, available: denial === null || rule.enforcement === "observe" };
        }),
      };
    }),
    packs: packs.map((pack): AdminCreditPack => {
      const versions = packVersions.filter((row) => row.packId === pack.id);
      return {
        id: pack.id,
        sku: pack.sku,
        ...packTerms(pack),
        version: versions[0]?.version ?? 0,
        purchases: purchases.find((row) => row.packId === pack.id)?.count ?? 0,
        versions: versions.slice(0, 10).map((row) => ({ version: row.version, terms: row.terms, reason: row.reason, createdByEmail: row.createdBy ? emails.get(row.createdBy) ?? null : null, createdAt: row.createdAt.toISOString() })),
      };
    }),
    creditPrices: { prices: effectiveCreditPrices(revision.config, settings), source: revision.config.credits ? "published" : "settings", configVersion: revision.version },
  };
  return c.json(response);
});

const nullableLimit = (max: number) => z.number().int().min(1).max(max).nullable();
const planTermsSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(500),
    priceCents: z.number().int().min(0).max(10_000_000),
    monthlyCredits: z.number().int().min(0).max(100_000),
    dailyRenderLimit: nullableLimit(10_000),
    monthlyRenderLimit: nullableLimit(100_000),
    maxProjects: nullableLimit(10_000),
    concurrentRenderLimit: z.number().int().min(1).max(100).nullable(),
    isActive: z.boolean(),
    paypalPlanId: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

const packTermsSchema = z
  .object({ name: z.string().trim().min(1).max(60), priceCents: z.number().int().min(1).max(10_000_000), credits: z.number().int().min(1).max(1_000_000), isActive: z.boolean() })
  .strict();

export type PlanChangePayload =
  | { kind: "plan"; id: string; expectedVersion: number; terms: z.infer<typeof planTermsSchema>; reason: string }
  | { kind: "pack"; op: "update"; id: string; expectedVersion: number; terms: z.infer<typeof packTermsSchema>; reason: string }
  | { kind: "pack"; op: "create"; sku: string; currency: string; terms: z.infer<typeof packTermsSchema>; reason: string };

export type PlanChangeOutcome = { ok: true; id: string; version: number } | { ok: false; status: 400 | 404 | 409; error: string; code: string };

/** Why these new terms can't replace a plan's current ones, or null. */
function planProblem(plan: PlanRow, next: z.infer<typeof planTermsSchema>): string | null {
  if (plan.slug === STARTER_PLAN_SLUG && !next.isActive) return "The Starter plan is every new account's plan and must stay active";
  // A PayPal plan's price is fixed at PayPal; existing subscriptions keep paying it either way.
  if (plan.paypalPlanId && next.priceCents !== plan.priceCents && next.paypalPlanId === plan.paypalPlanId) {
    return "PayPal bills subscribers the price set on the PayPal plan. Create a PayPal plan at the new price and enter its ID with the new price.";
  }
  if (plan.interval === "month" && next.isActive && next.priceCents > 0 && !next.paypalPlanId) return "An active paid plan needs a PayPal plan ID";
  return null;
}

/**
 * Applies a plan or pack change and records its version, all in one transaction. The first
 * edit of something with no history also records its prior terms as version 1. The expected
 * version makes a stale edit fail; the unique (id, version) index settles simultaneous ones.
 */
export async function applyPlanChange(db: Database, payload: PlanChangePayload, actorId: string, approvalId: string | null): Promise<PlanChangeOutcome> {
  if (payload.kind === "pack" && payload.op === "create") {
    const [existing] = await db.select({ id: schema.creditPacks.id }).from(schema.creditPacks).where(eq(schema.creditPacks.sku, payload.sku)).limit(1);
    if (existing) return { ok: false, status: 409, error: `A pack with SKU "${payload.sku}" already exists`, code: "duplicate_sku" };
    const id = crypto.randomUUID();
    const terms: AdminCreditPackTerms = { ...payload.terms, currency: payload.currency };
    await db.batch([
      db.insert(schema.creditPacks).values({ id, sku: payload.sku, currency: payload.currency, ...payload.terms }),
      db.insert(schema.creditPackVersions).values({ packId: id, version: 1, terms, reason: payload.reason, createdBy: actorId, approvalId }),
      adminEventInsert(db, { actorId, action: "plan.update", targetType: "credit_pack", targetId: id, summary: `Created credit pack ${payload.sku}`, detail: { reason: payload.reason, after: terms, ...(approvalId ? { approvalId } : {}) } }),
    ]);
    return { ok: true, id, version: 1 };
  }

  const isPlan = payload.kind === "plan";
  const [row] = isPlan
    ? await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.id, payload.id)).limit(1)
    : await db.select().from(schema.creditPacks).where(eq(schema.creditPacks.id, payload.id)).limit(1);
  if (!row) return { ok: false, status: 404, error: isPlan ? "Plan not found" : "Credit pack not found", code: "not_found" };
  const versionsTable = isPlan ? schema.billingPlanVersions : schema.creditPackVersions;
  const [latest] = isPlan
    ? await db.select({ version: schema.billingPlanVersions.version }).from(schema.billingPlanVersions).where(eq(schema.billingPlanVersions.planId, payload.id)).orderBy(desc(schema.billingPlanVersions.version)).limit(1)
    : await db.select({ version: schema.creditPackVersions.version }).from(schema.creditPackVersions).where(eq(schema.creditPackVersions.packId, payload.id)).orderBy(desc(schema.creditPackVersions.version)).limit(1);
  const current = latest?.version ?? 0;
  if (current !== payload.expectedVersion) return { ok: false, status: 409, error: "Someone changed this since you opened it. Reload and make your change again.", code: "version_conflict" };

  const before = isPlan ? planTerms(row as PlanRow) : packTerms(row as PackRow);
  if (isPlan) {
    const problem = planProblem(row as PlanRow, payload.terms as z.infer<typeof planTermsSchema>);
    if (problem) return { ok: false, status: 400, error: problem, code: "invalid_terms" };
  }
  const after = { ...before, ...payload.terms };
  const changed = Object.keys(payload.terms).filter((key) => (before as unknown as Record<string, unknown>)[key] !== (after as unknown as Record<string, unknown>)[key]);
  if (changed.length === 0) return { ok: false, status: 400, error: "Nothing has changed", code: "no_changes" };

  const name = isPlan ? (row as PlanRow).slug : (row as PackRow).sku;
  const version = current === 0 ? 2 : current + 1;
  const owner = isPlan ? { planId: payload.id } : { packId: payload.id };
  try {
    await db.batch([
      isPlan
        ? db.update(schema.billingPlans).set({ ...payload.terms, updatedAt: new Date() }).where(eq(schema.billingPlans.id, payload.id))
        : db.update(schema.creditPacks).set({ ...payload.terms, updatedAt: new Date() }).where(eq(schema.creditPacks.id, payload.id)),
      // Something edited for the first time keeps its original terms as version 1.
      ...(current === 0 ? [db.insert(versionsTable).values({ ...owner, version: 1, terms: before, reason: "Terms before the first admin edit" } as never)] : []),
      db.insert(versionsTable).values({ ...owner, version, terms: after, reason: payload.reason, createdBy: actorId, approvalId } as never),
      adminEventInsert(db, {
        actorId, action: "plan.update", targetType: isPlan ? "billing_plan" : "credit_pack", targetId: payload.id,
        summary: `Updated ${isPlan ? "plan" : "credit pack"} ${name} (v${version}): ${changed.join(", ")}`,
        detail: { reason: payload.reason, version, before: Object.fromEntries(changed.map((key) => [key, (before as unknown as Record<string, unknown>)[key]])), after: Object.fromEntries(changed.map((key) => [key, (after as unknown as Record<string, unknown>)[key]])), ...(approvalId ? { approvalId } : {}) },
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, status: 409, error: "Someone changed this at the same moment. Reload and try again.", code: "version_conflict" };
    throw error;
  }
  return { ok: true, id: payload.id, version };
}

/**
 * Version rows for monthly allowances changed from Settings, so a plan's history stays complete
 * whichever page changed it. Goes in the same batch as the plan updates.
 */
export async function allowanceVersionWrites(db: Database, changes: Record<string, number>, reason: string, actorId: string) {
  const writes = [];
  for (const [slug, monthlyCredits] of Object.entries(changes)) {
    const [plan] = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.slug, slug)).limit(1);
    if (!plan || plan.monthlyCredits === monthlyCredits) continue;
    const [latest] = await db.select({ version: schema.billingPlanVersions.version }).from(schema.billingPlanVersions).where(eq(schema.billingPlanVersions.planId, plan.id)).orderBy(desc(schema.billingPlanVersions.version)).limit(1);
    const before = planTerms(plan);
    if (!latest) writes.push(db.insert(schema.billingPlanVersions).values({ planId: plan.id, version: 1, terms: before, reason: "Terms before the first admin edit" }));
    writes.push(db.insert(schema.billingPlanVersions).values({ planId: plan.id, version: (latest?.version ?? 1) + 1, terms: { ...before, monthlyCredits }, reason, createdBy: actorId }));
  }
  return writes;
}

/** Applies now, or holds the change for a second admin under the Studio/pricing approval rule. */
async function changeOrRequest(c: Context<AdminContext>, payload: PlanChangePayload) {
  const db = c.get("db"); const actor = c.get("admin");
  const rules = await governance(db);
  if (rules.studioChangeApprovalThreshold > 0 && 1 >= rules.studioChangeApprovalThreshold) {
    const approval = await requestApproval(db, {
      action: "plan_change", actorId: actor.id, targetType: payload.kind === "plan" ? "billing_plan" : "credit_pack", targetId: "id" in payload ? payload.id : undefined,
      riskValue: 1, threshold: rules.studioChangeApprovalThreshold, reason: payload.reason, payload,
    });
    return c.json({ pendingApproval: true, approvalId: approval.id }, 202);
  }
  const outcome = await applyPlanChange(db, payload, actor.id, null);
  if (!outcome.ok) return c.json({ error: outcome.error, code: outcome.code }, outcome.status);
  return c.json({ id: outcome.id, version: outcome.version }, "op" in payload && payload.op === "create" ? 201 : 200);
}

const reasonSchema = z.string().trim().min(1).max(300);

plansRoutes.put("/plans/:id", async (c) => {
  const denied = denyUnless(c, "plans.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = z.object({ expectedVersion: z.number().int().min(0), terms: planTermsSchema, reason: reasonSchema }).parse(await c.req.json());
  return changeOrRequest(c, { kind: "plan", id, expectedVersion: body.expectedVersion, terms: body.terms, reason: body.reason });
});

plansRoutes.post("/credit-packs", async (c) => {
  const denied = denyUnless(c, "plans.manage"); if (denied) return c.json(denied, 403);
  const body = z
    .object({ sku: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/, "Lowercase letters, numbers, - and _"), currency: z.literal("USD").default("USD"), terms: packTermsSchema, reason: reasonSchema })
    .parse(await c.req.json());
  return changeOrRequest(c, { kind: "pack", op: "create", sku: body.sku, currency: body.currency, terms: body.terms, reason: body.reason });
});

plansRoutes.put("/credit-packs/:id", async (c) => {
  const denied = denyUnless(c, "plans.manage"); if (denied) return c.json(denied, 403);
  const id = z.string().uuid().parse(c.req.param("id"));
  const body = z.object({ expectedVersion: z.number().int().min(0), terms: packTermsSchema, reason: reasonSchema }).parse(await c.req.json());
  return changeOrRequest(c, { kind: "pack", op: "update", id, expectedVersion: body.expectedVersion, terms: body.terms, reason: body.reason });
});

const pricesSchema = z.object(Object.fromEntries(Object.keys(CREDIT_PRICE_LABELS).map((key) => [key, z.number().int().min(0).max(1000)])) as Record<keyof CreditPrices, z.ZodNumber>).strict();

/**
 * Publishes credit prices (or, with null, hands pricing back to Settings' multipliers) as a new
 * Studio Control version. Charges and refunds then follow the version stamped on each job.
 */
plansRoutes.put("/pricing/credits", async (c) => {
  const denied = denyUnless(c, "plans.manage"); if (denied) return c.json(denied, 403);
  const body = z.object({ expectedVersion: z.number().int().positive(), prices: pricesSchema.nullable(), reason: reasonSchema }).parse(await c.req.json());
  const current = await currentStudioRevision(c.get("db"));
  return publishOrRequest(c, { expectedVersion: body.expectedVersion, config: { ...current.config, credits: body.prices as CreditPrices | null }, reason: body.reason });
});

const simulationSchema = z
  .object({
    prices: pricesSchema.optional(),
    planSlug: z.string().min(1),
    periodDays: z.number().int().min(1).max(365),
    usage: z.object({
      renders: z.number().int().min(0).max(100_000),
      referenceRenders: z.number().int().min(0).max(100_000),
      fidelityRenders: z.number().int().min(0).max(100_000),
      edits: z.number().int().min(0).max(100_000),
      upscale4k: z.number().int().min(0).max(100_000),
      upscale8k: z.number().int().min(0).max(100_000),
      selections: z.number().int().min(0).max(100_000),
    }).strict(),
  })
  .strict();

/**
 * What a usage pattern costs a customer on a plan, and what it costs Renvia in provider fees.
 * An estimate of contribution, not profit: payment fees, refunds, tax and infrastructure are left out.
 */
plansRoutes.post("/pricing/simulate", async (c) => {
  const denied = denyUnless(c, "billing.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const body = simulationSchema.parse(await c.req.json());
  const [[plan], packs, revision, settings] = await Promise.all([
    db.select().from(schema.billingPlans).where(eq(schema.billingPlans.slug, body.planSlug)).limit(1),
    db.select().from(schema.creditPacks).where(eq(schema.creditPacks.isActive, true)),
    currentStudioRevision(db),
    getSettings(db),
  ]);
  if (!plan) return c.json({ error: `No plan "${body.planSlug}"` }, 404);
  const prices = (body.prices as CreditPrices | undefined) ?? effectiveCreditPrices(revision.config, settings);
  const ref = ["https://example.test/ref.png"];
  const usage = body.usage;
  const actions: { action: keyof CreditPrices; count: number; credits: number; providerMicros: number }[] = [
    { action: "render", count: usage.renders, credits: creditsForRender({}, prices), providerMicros: modelFor("prod", "photo").costMicros },
    { action: "references", count: usage.referenceRenders, credits: creditsForRender({ referenceImageUrls: ref }, prices), providerMicros: modelFor("prod", "references").costMicros },
    { action: "fidelity", count: usage.fidelityRenders, credits: creditsForRender({ referenceImageUrls: ref, fidelity: { mode: "strict", protectedFeatures: ["roof"] } }, prices), providerMicros: modelFor("prod", "fidelity").costMicros },
    { action: "editPass", count: usage.edits, credits: prices.editPass, providerMicros: modelFor("prod", "edit").costMicros },
    { action: "upscale4k", count: usage.upscale4k, credits: prices.upscale4k, providerMicros: UPSCALE_COST_MICROS["4k"] },
    { action: "upscale8k", count: usage.upscale8k, credits: prices.upscale8k, providerMicros: UPSCALE_COST_MICROS["8k"] },
    { action: "selection", count: usage.selections, credits: prices.selection, providerMicros: SAM_COST_MICROS },
  ];
  const creditsNeeded = actions.reduce((sum, row) => sum + row.count * row.credits, 0);
  const months = body.periodDays / 30;
  const includedCredits = Math.floor(plan.monthlyCredits * months);
  const extraCredits = Math.max(0, creditsNeeded - includedCredits);
  // Extra credits are bought at the best-value active pack.
  const bestPack = [...packs].sort((a, b) => a.priceCents / a.credits - b.priceCents / b.credits)[0];
  const packsNeeded = extraCredits > 0 && bestPack
    ? { sku: bestPack.sku, name: bestPack.name, count: Math.ceil(extraCredits / bestPack.credits), costCents: Math.ceil(extraCredits / bestPack.credits) * bestPack.priceCents }
    : null;
  const providerCostUsd = actions.reduce((sum, row) => sum + row.count * row.providerMicros, 0) / MICROS_PER_USD;
  const planRevenueCents = plan.interval === "month" ? Math.round(plan.priceCents * months) : 0;
  const revenueUsd = (planRevenueCents + (packsNeeded?.costCents ?? 0)) / 100;
  const notes = [
    "Contribution is revenue minus estimated provider (fal) cost only. Payment fees, refunds, tax and infrastructure are not included.",
    `Plan price and allowance are prorated to ${body.periodDays} days.`,
  ];
  if (extraCredits > 0 && !bestPack) notes.push("No active credit pack: the extra credits could not be bought, so they earn nothing here.");
  if (settings.maxCreditBalance !== null && creditsNeeded > settings.maxCreditBalance) notes.push(`The ${settings.maxCreditBalance}-credit balance cap means they couldn't hold this many credits at once.`);
  const response: AdminPricingSimulationResponse = {
    creditsByAction: actions.map(({ action, count, credits }) => ({ action, count, credits: count * credits })),
    creditsNeeded,
    includedCredits,
    extraCredits,
    packsNeeded,
    providerCostUsd,
    revenueUsd,
    contributionUsd: revenueUsd - providerCostUsd,
    notes,
  };
  return c.json(response);
});
