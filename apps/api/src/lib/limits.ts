import { and, eq, gte, ne, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { LimitCode, UserLimits, UserUsage } from "@renvia/types";
import type { AppSettingsRow } from "./settings.js";

type UserRow = typeof schema.users.$inferSelect;

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

export function resolveLimits(user: UserRow, settings: AppSettingsRow): UserLimits {
  const exempt = user.role === "admin" || user.limitsExempt;
  return {
    dailyRenders: resolveCap(user.dailyRenderLimitOverride, settings.dailyRenderLimit, exempt),
    dailySegments: resolveCap(user.dailySegmentLimitOverride, settings.dailySegmentLimit, exempt),
    monthlyRenders: resolveCap(user.monthlyRenderLimitOverride, settings.monthlyRenderLimit, exempt),
    monthlySegments: resolveCap(user.monthlySegmentLimitOverride, settings.monthlySegmentLimit, exempt),
    maxProjects: exempt ? null : settings.maxProjectsPerUser,
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
 * Counts against every cap in one round trip. Failed renders and segmentations were
 * refunded, so they don't consume the day's or month's allowance either.
 */
export async function getUsage(db: Database, userId: string): Promise<UserUsage> {
  const [[renders], [segments], [projects]] = await Promise.all([
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
          ne(schema.renders.status, "failed"),
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
          ne(schema.segmentations.status, "failed"),
          gte(schema.segmentations.createdAt, UTC_MONTH_START),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(eq(schema.projects.ownerId, userId)),
  ]);

  return {
    rendersToday: renders?.today ?? 0,
    segmentsToday: segments?.today ?? 0,
    rendersThisMonth: renders?.month ?? 0,
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
  maintenance: "Temporarily paused for maintenance",
  account_disabled: "Account disabled",
  project_limit_reached: "Project limit reached",
  prompt_too_long: "Prompt is too long",
  too_many_references: "Too many reference images",
  upload_too_large: "Image is too large",
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
): Promise<Refusal | null> {
  const limits = resolveLimits(user, settings);
  if (limits.exempt) return null;

  const paused = kind === "render" ? settings.maintenanceRenders : settings.maintenanceSegments;
  if (paused) return refuse(settings, "maintenance", 503);

  const daily = kind === "render" ? limits.dailyRenders : limits.dailySegments;
  const monthly = kind === "render" ? limits.monthlyRenders : limits.monthlySegments;
  if (daily === null && monthly === null) return null;

  const usage = await getUsage(db, user.id);
  const usedToday = kind === "render" ? usage.rendersToday : usage.segmentsToday;
  const usedThisMonth = kind === "render" ? usage.rendersThisMonth : usage.segmentsThisMonth;

  if (daily !== null && usedToday >= daily) {
    return refuse(settings, "daily_limit_reached", 429, { limit: daily, used: usedToday });
  }
  if (monthly !== null && usedThisMonth >= monthly) {
    return refuse(settings, "monthly_limit_reached", 429, { limit: monthly, used: usedThisMonth });
  }
  return null;
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

export function refuseDisabled(settings: AppSettingsRow): Refusal {
  return refuse(settings, "account_disabled", 403);
}
