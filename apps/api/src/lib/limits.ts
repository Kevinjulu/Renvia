import { and, eq, gt, gte, isNull, ne, or, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { LimitCode, UserLimits, UserUsage } from "@renvia/types";
import type { AppSettingsRow } from "./settings.js";
import type { JobCaps } from "./credits.js";
import { effectiveMaintenance } from "./studioControl.js";
import { BYTES_PER_MB, uploadBytesFor, uploadWouldExceed } from "./storage.js";

type UserRow = typeof schema.users.$inferSelect;
type BillingPlanRow = typeof schema.billingPlans.$inferSelect;

/** A running beta program's render limits; each non-null one replaces the plan's while enrolled. */
export type BetaLimits = Pick<typeof schema.betaPrograms.$inferSelect, "dailyRenderLimit" | "monthlyRenderLimit" | "concurrentRenderLimit">;

/** Start of the current UTC day / month, as the same expression the render counters already use. */
const UTC_DAY_START = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
const UTC_MONTH_START = sql`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`;

/**
 * A per-user override wins over the global setting, including an override of 0
 * (blocked) — only null means "inherit". Admins and explicitly exempt users skip
 * the daily/monthly caps entirely.
 */
function resolveCap(override: number | null, global: number | null, exempt: boolean): number | null {
  if (exempt) return null;
  return override ?? global;
}

export function resolveLimits(user: UserRow, settings: AppSettingsRow, plan?: BillingPlanRow, beta?: BetaLimits | null): UserLimits {
  const exempt = user.role === "admin" || user.limitsExempt;
  return {
    dailyRenders: resolveCap(user.dailyRenderLimitOverride, beta?.dailyRenderLimit ?? plan?.dailyRenderLimit ?? settings.dailyRenderLimit, exempt),
    dailySegments: resolveCap(user.dailySegmentLimitOverride, settings.dailySegmentLimit, exempt),
    monthlyRenders: resolveCap(user.monthlyRenderLimitOverride, beta?.monthlyRenderLimit ?? plan?.monthlyRenderLimit ?? settings.monthlyRenderLimit, exempt),
    monthlySegments: resolveCap(user.monthlySegmentLimitOverride, settings.monthlySegmentLimit, exempt),
    concurrentRenders: exempt ? null : (beta?.concurrentRenderLimit ?? plan?.concurrentRenderLimit ?? 1),
    maxProjects: exempt ? null : (plan?.maxProjects ?? settings.maxProjectsPerUser),
    maxCreditBalance: settings.maxCreditBalance,
    maxUploadMb: settings.maxUploadMb,
    maxReferenceImages: settings.maxReferenceImages,
    maxPromptChars: settings.maxPromptChars,
    maxSelectionPromptChars: settings.maxSelectionPromptChars,
    lowCreditThreshold: settings.lowCreditThreshold,
    exempt,
    overridden: {
      dailyRenders: user.dailyRenderLimitOverride !== null,
      dailySegments: user.dailySegmentLimitOverride !== null,
      monthlyRenders: user.monthlyRenderLimitOverride !== null,
      monthlySegments: user.monthlySegmentLimitOverride !== null,
    },
  };
}

/**
 * Counts against every cap in one round trip. A failed render or segmentation counts toward the
 * day's and month's allowance only while it still carries provider spend (cost_micros > 0): one
 * cancelled or timed out after fal took it used fal; one fal refused or never received didn't.
 * Renders in deleted projects still count; the project count only covers live projects.
 */
export async function getUsage(db: Database, userId: string): Promise<UserUsage> {
  const [[renders], [segments], [projects], [inFlight]] = await Promise.all([
    db
      .select({
        today: sql<number>`count(*) filter (where ${schema.renders.createdAt} >= ${UTC_DAY_START})::int`,
        month: sql<number>`count(*) filter (where ${schema.renders.createdAt} >= ${UTC_MONTH_START})::int`,
      })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(
        and(
          eq(schema.projects.ownerId, userId),
          or(ne(schema.renders.status, "failed"), gt(schema.renders.costMicros, 0)),
          gte(schema.renders.createdAt, UTC_MONTH_START),
        ),
      ),
    db
      .select({
        today: sql<number>`count(*) filter (where ${schema.segmentations.createdAt} >= ${UTC_DAY_START})::int`,
        month: sql<number>`count(*) filter (where ${schema.segmentations.createdAt} >= ${UTC_MONTH_START})::int`,
      })
      .from(schema.segmentations)
      .where(
        and(
          eq(schema.segmentations.userId, userId),
          or(ne(schema.segmentations.status, "failed"), gt(schema.segmentations.costMicros, 0)),
          gte(schema.segmentations.createdAt, UTC_MONTH_START),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(and(eq(schema.projects.ownerId, userId), isNull(schema.projects.deletedAt))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.renders)
      .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
      .where(and(eq(schema.projects.ownerId, userId), sql`${schema.renders.status} in ('pending', 'processing')`)),
  ]);

  return {
    rendersToday: renders?.today ?? 0,
    segmentsToday: segments?.today ?? 0,
    rendersThisMonth: renders?.month ?? 0,
    rendersInFlight: inFlight?.count ?? 0,
    segmentsThisMonth: segments?.month ?? 0,
    projects: projects?.count ?? 0,
  };
}

/** Operator-authored copy per refusal; blank entries fall back to the studio's wording. */
export function limitMessages(settings: AppSettingsRow): Partial<Record<LimitCode, string | null>> {
  const trimmed = (value: string | null) => value?.trim() || null;
  return {
    insufficient_credits: trimmed(settings.messageInsufficientCredits),
    daily_limit_reached: trimmed(settings.messageDailyLimit),
    monthly_limit_reached: trimmed(settings.messageMonthlyLimit),
    budget_exhausted: trimmed(settings.messageBudgetExhausted),
    account_disabled: trimmed(settings.messageAccountDisabled),
    maintenance: trimmed(settings.maintenanceMessage),
  };
}

export interface Refusal {
  code: LimitCode;
  /** Built-in wording, already overridden by the operator's copy when they set any. */
  error: string;
  status: 402 | 403 | 429 | 503;
  /** The cap that was hit, so the studio can say "12 of 12 today". */
  limit?: number;
  used?: number;
}

const DEFAULTS: Record<LimitCode, string> = {
  insufficient_credits: "Not enough credits",
  daily_limit_reached: "Daily limit reached",
  monthly_limit_reached: "Monthly limit reached",
  budget_exhausted: "Render budget exhausted",
  concurrency_limit_reached: "Too many renders are already running",
  maintenance: "Temporarily paused for maintenance",
  account_disabled: "Account disabled",
  project_limit_reached: "Project limit reached",
  prompt_too_long: "Prompt is too long",
  too_many_references: "Too many reference images",
  upload_too_large: "Image is too large",
  feature_disabled: "This feature isn't available",
  storage_full: "Image storage is full. Your existing work is safe, but nothing new can be saved right now.",
  storage_quota_reached: "You've reached your storage for uploaded images. Delete projects or assets you no longer need; space is freed within a few days.",
  beta_credits_exhausted: "You've used your beta credits. You can use your own credits for this instead.",
  beta_budget_exhausted: "Beta rendering is paused because the shared testing budget has been reached. Your projects and feedback are still available.",
  beta_unavailable: "Beta credits can't be used right now.",
  promo_budget_exhausted: "Free rendering is paused for the rest of the month. Upgrade or buy credits to keep rendering; your projects are safe.",
};

function refuse(settings: AppSettingsRow, code: LimitCode, status: Refusal["status"], extra: Partial<Refusal> = {}): Refusal {
  return { code, error: limitMessages(settings)[code] ?? DEFAULTS[code], status, ...extra };
}

type Kind = "render" | "segment";

/**
 * The full pre-flight for a render or selection: maintenance, then the daily and
 * monthly caps. Credits and the global fal budget are checked by the callers, which
 * own those transactions. Returns null when the request may proceed.
 */
export async function checkAllowance(
  db: Database,
  user: UserRow,
  settings: AppSettingsRow,
  kind: Kind,
  plan?: BillingPlanRow,
  beta?: BetaLimits | null,
): Promise<Refusal | null> {
  const limits = resolveLimits(user, settings, plan, beta);
  if (limits.exempt) return null;

  // The Settings switches and any scheduled window that is running now.
  const maintenance = await effectiveMaintenance(db, settings);
  const paused = kind === "render" ? maintenance.renders : maintenance.selections;
  if (paused) return refuse(settings, "maintenance", 503, maintenance.message?.trim() ? { error: maintenance.message.trim() } : {});

  const daily = kind === "render" ? limits.dailyRenders : limits.dailySegments;
  const monthly = kind === "render" ? limits.monthlyRenders : limits.monthlySegments;
  if (daily === null && monthly === null && (kind !== "render" || limits.concurrentRenders === null)) return null;

  const usage = await getUsage(db, user.id);
  const usedToday = kind === "render" ? usage.rendersToday : usage.segmentsToday;
  const usedThisMonth = kind === "render" ? usage.rendersThisMonth : usage.segmentsThisMonth;

  if (kind === "render" && limits.concurrentRenders !== null && usage.rendersInFlight >= limits.concurrentRenders) {
    return refuse(settings, "concurrency_limit_reached", 429, { limit: limits.concurrentRenders, used: usage.rendersInFlight });
  }

  if (daily !== null && usedToday >= daily) {
    return refuse(settings, "daily_limit_reached", 429, { limit: daily, used: usedToday });
  }
  if (monthly !== null && usedThisMonth >= monthly) {
    return refuse(settings, "monthly_limit_reached", 429, { limit: monthly, used: usedThisMonth });
  }
  return null;
}

/**
 * The caps createChargedRender / createChargedSegmentation check again inside their transaction,
 * or null when the user is exempt. Maintenance stays a pre-flight check only.
 */
export function jobCaps(limits: UserLimits, kind: Kind): JobCaps | null {
  if (limits.exempt) return null;
  return kind === "render"
    ? { concurrent: limits.concurrentRenders, daily: limits.dailyRenders, monthly: limits.monthlyRenders }
    : { concurrent: null, daily: limits.dailySegments, monthly: limits.monthlySegments };
}

/**
 * The refusal for a JobCapError: the cap a racing request just filled, read again now. Falls back
 * to the concurrency refusal if the slot has already been freed again in between.
 */
export async function refuseRacedCap(db: Database, user: UserRow, settings: AppSettingsRow, kind: Kind, plan?: BillingPlanRow, beta?: BetaLimits | null): Promise<Refusal> {
  return (await checkAllowance(db, user, settings, kind, plan, beta))
    ?? refuse(settings, kind === "render" ? "concurrency_limit_reached" : "daily_limit_reached", 429);
}

/** Refusal for one of the input caps, which are checked inline rather than pre-flight. */
export function refuseInput(settings: AppSettingsRow, code: LimitCode, limit: number, used: number): Refusal {
  return refuse(settings, code, 403, { limit, used });
}

export function refuseCredits(settings: AppSettingsRow, balance: number, cost: number): Refusal {
  return refuse(settings, "insufficient_credits", 402, { limit: cost, used: balance });
}

export function refuseBudget(settings: AppSettingsRow): Refusal {
  return refuse(settings, "budget_exhausted", 402);
}

/**
 * Refusals for beta-funded jobs. None of these fall back to the tester's own credits: the Studio
 * asks them first and resends with funding "account".
 */
export function refuseBetaCredits(settings: AppSettingsRow, betaCredits: number, cost: number): Refusal {
  return refuse(settings, "beta_credits_exhausted", 402, { limit: cost, used: betaCredits });
}

export function refuseBetaBudget(settings: AppSettingsRow): Refusal {
  return refuse(settings, "beta_budget_exhausted", 402);
}

export function refuseBetaUnavailable(settings: AppSettingsRow): Refusal {
  return refuse(settings, "beta_unavailable", 403);
}

/** A job paid from the Free allowance, refused because this month's promotional budget is used. */
export function refusePromoBudget(settings: AppSettingsRow): Refusal {
  return refuse(settings, "promo_budget_exhausted", 402);
}

export function refuseStorage(settings: AppSettingsRow): Refusal {
  return refuse(settings, "storage_full", 503);
}

/**
 * The storage checks for a new upload of `bytes`: the account's own allowance (admins and
 * exempt users skip it), then the uploads' share of the shared cap. Null when it may be stored.
 */
export async function checkUploadStorage(db: Database, user: UserRow, clerkId: string, settings: AppSettingsRow, bytes: number): Promise<Refusal | null> {
  if (user.role !== "admin" && !user.limitsExempt) {
    const used = await uploadBytesFor(db, clerkId);
    if (used + bytes > settings.storagePerUserMb * BYTES_PER_MB) {
      return refuse(settings, "storage_quota_reached", 403, { limit: settings.storagePerUserMb, used: Math.ceil(used / BYTES_PER_MB) });
    }
  }
  if (await uploadWouldExceed(db, settings.storageCapMb, bytes)) return refuseStorage(settings);
  return null;
}

export function refuseDisabled(settings: AppSettingsRow): Refusal {
  return refuse(settings, "account_disabled", 403);
}
