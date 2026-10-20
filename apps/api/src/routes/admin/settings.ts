import { Hono } from "hono";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminSettings } from "@renvia/types";
import type { Env } from "../../index.js";
import { modelsFor } from "../../lib/models.js";
import { getSettings, effectiveBudgetUsd, effectiveEngineMode, type AppSettingsRow } from "../../lib/settings.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, adminEventInsert } from "./shared.js";
import { governance, requestApproval } from "./governance.js";
import { allowanceVersionWrites } from "./plans.js";
import { currentStudioRevision } from "../../lib/studioControl.js";
import { BYTES_PER_MB, storageConfigured, storageUsage } from "../../lib/storage.js";
import { promoSpendMicros } from "../../lib/promotions.js";
import type { AdminContext } from "./context.js";

export const settingsRoutes = new Hono<AdminContext>();

async function planMonthlyCredits(db: Database) {
  return db
    .select({ slug: schema.billingPlans.slug, name: schema.billingPlans.name, monthlyCredits: schema.billingPlans.monthlyCredits })
    .from(schema.billingPlans)
    .where(eq(schema.billingPlans.isActive, true))
    .orderBy(asc(schema.billingPlans.priceCents));
}

async function toAdminSettings(env: Env, db: Database, row: AppSettingsRow): Promise<AdminSettings> {
  // Spend as the budget counts it (see spentMicros in engine.ts): every job's cost, plus Polish.
  const [[renderSpend], [segSpend], [polishSpend], promoSpent, updaterRows, changeRows, plans, revision, storage] = await Promise.all([
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`,
      })
      .from(schema.renders),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.segmentations.costMicros}), 0)::bigint`,
      })
      .from(schema.segmentations),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.promptPolishes.costMicros}), 0)::bigint`,
      })
      .from(schema.promptPolishes),
    promoSpendMicros(db),
    row.updatedBy
      ? db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.updatedBy))
      : Promise.resolve([] as { email: string }[]),
    db
      .select({
        event: schema.adminEvents,
        actorEmail: schema.users.email,
      })
      .from(schema.adminEvents)
      .innerJoin(schema.users, eq(schema.adminEvents.actorId, schema.users.id))
      .where(eq(schema.adminEvents.action, "settings.update"))
      .orderBy(desc(schema.adminEvents.createdAt))
      .limit(8),
    planMonthlyCredits(db),
    currentStudioRevision(db),
    storageUsage(db),
  ]);

  const envMode = env.FAL_MODE?.trim() || null;
  const envBudgetRaw = Number(env.FAL_BUDGET_USD);
  const envBudgetUsd = Number.isFinite(envBudgetRaw) && envBudgetRaw > 0 ? envBudgetRaw : null;
  const effectiveMode = effectiveEngineMode(env, row);

  return {
    planMonthlyCredits: plans,
    dailyRenderLimit: row.dailyRenderLimit,
    dailySegmentLimit: row.dailySegmentLimit,
    monthlyRenderLimit: row.monthlyRenderLimit,
    monthlySegmentLimit: row.monthlySegmentLimit,
    maxCreditBalance: row.maxCreditBalance,
    maxProjectsPerUser: row.maxProjectsPerUser,
    maxUploadMb: row.maxUploadMb,
    maxReferenceImages: row.maxReferenceImages,
    maxPromptChars: row.maxPromptChars,
    maxSelectionPromptChars: row.maxSelectionPromptChars,
    lowCreditThreshold: row.lowCreditThreshold,
    messageInsufficientCredits: row.messageInsufficientCredits,
    messageDailyLimit: row.messageDailyLimit,
    messageMonthlyLimit: row.messageMonthlyLimit,
    messageBudgetExhausted: row.messageBudgetExhausted,
    messageAccountDisabled: row.messageAccountDisabled,
    creditsPerImage: row.creditsPerImage,
    creditsPerSelection: row.creditsPerSelection,
    creditPricesPublished: Boolean(revision.config.credits),
    maintenanceRenders: row.maintenanceRenders,
    maintenanceSegments: row.maintenanceSegments,
    maintenanceMessage: row.maintenanceMessage,
    budgetWarningPercent: row.budgetWarningPercent,
    budgetCriticalPercent: row.budgetCriticalPercent,
    stuckTimeoutMinutes: row.stuckTimeoutMinutes,
    storageCapMb: row.storageCapMb,
    storagePerUserMb: row.storagePerUserMb,
    storage: { usedBytes: storage.usedBytes, capBytes: row.storageCapMb * BYTES_PER_MB, objects: storage.objects, byKind: storage.byKind },
    falMode: row.falMode,
    falBudgetUsd: row.falBudgetUsd === null ? null : Number(row.falBudgetUsd),
    freeAllowanceMode: row.freeAllowanceMode,
    freeAllowanceDailyApprovals: row.freeAllowanceDailyApprovals,
    promoBudgetUsd: row.promoBudgetUsd === null ? null : Number(row.promoBudgetUsd),
    promoWarningPercent: row.promoWarningPercent,
    promoCriticalPercent: row.promoCriticalPercent,
    promoSpentUsd: promoSpent / MICROS_PER_USD,
    effectiveMode,
    effectiveBudgetUsd: effectiveBudgetUsd(env, row),
    spentUsd: (Number(renderSpend?.spentMicros ?? 0) + Number(segSpend?.spentMicros ?? 0) + Number(polishSpend?.spentMicros ?? 0)) / MICROS_PER_USD,
    envMode,
    envBudgetUsd,
    health: {
      falKeyConfigured: Boolean(env.FAL_KEY?.trim()),
      storageConfigured: storageConfigured(env),
    },
    models: modelsFor(effectiveMode),
    updatedAt: row.updatedAt.toISOString(),
    updatedByEmail: updaterRows[0]?.email ?? null,
    recentChanges: changeRows.map(({ event, actorEmail }) => ({
      id: event.id,
      actorEmail,
      summary: event.summary,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

settingsRoutes.get("/settings", async (c) => {
  const denied = denyUnless(c, "settings.read"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  return c.json(await toAdminSettings(c.env, db, await getSettings(db)));
});

const updateSettingsSchema = z
  .object({
    planMonthlyCredits: z.record(z.string(), z.number().int().min(0).max(100_000)).optional(),
    dailyRenderLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    dailySegmentLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    monthlyRenderLimit: z.number().int().min(1).max(100_000).nullable().optional(),
    monthlySegmentLimit: z.number().int().min(1).max(100_000).nullable().optional(),
    maxCreditBalance: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxProjectsPerUser: z.number().int().min(1).max(10_000).nullable().optional(),
    maxUploadMb: z.number().int().min(1).max(100).optional(),
    maxReferenceImages: z.number().int().min(0).max(16).optional(),
    maxPromptChars: z.number().int().min(50).max(8000).optional(),
    maxSelectionPromptChars: z.number().int().min(10).max(1000).optional(),
    lowCreditThreshold: z.number().int().min(0).max(1000).optional(),
    messageInsufficientCredits: z.string().trim().max(280).nullable().optional(),
    messageDailyLimit: z.string().trim().max(280).nullable().optional(),
    messageMonthlyLimit: z.string().trim().max(280).nullable().optional(),
    messageBudgetExhausted: z.string().trim().max(280).nullable().optional(),
    messageAccountDisabled: z.string().trim().max(280).nullable().optional(),
    creditsPerImage: z.number().int().min(0).max(100).optional(),
    creditsPerSelection: z.number().int().min(0).max(100).optional(),
    maintenanceRenders: z.boolean().optional(),
    maintenanceSegments: z.boolean().optional(),
    maintenanceMessage: z.string().trim().max(280).nullable().optional(),
    budgetWarningPercent: z.number().int().min(1).max(99).optional(),
    budgetCriticalPercent: z.number().int().min(2).max(100).optional(),
    stuckTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
    // Never above R2's free 10 GB: storage past it is billed.
    storageCapMb: z.number().int().min(100).max(10_000).optional(),
    storagePerUserMb: z.number().int().min(10).max(10_000).optional(),
    falMode: z.enum(["mock", "dev", "prod"]).nullable().optional(),
    falBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
    freeAllowanceMode: z.enum(["off", "observe", "enforce", "paused"]).optional(),
    freeAllowanceDailyApprovals: z.number().int().min(1).max(10_000).optional(),
    promoBudgetUsd: z.number().min(0).max(10_000).multipleOf(0.01).nullable().optional(),
    promoWarningPercent: z.number().int().min(1).max(99).optional(),
    promoCriticalPercent: z.number().int().min(2).max(100).optional(),
    /** Why; kept in the audit row, and required context for a change that needs approval. */
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.budgetWarningPercent !== undefined && body.budgetCriticalPercent !== undefined) {
      if (body.budgetCriticalPercent <= body.budgetWarningPercent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Critical percent must be greater than warning percent",
          path: ["budgetCriticalPercent"],
        });
      }
    }
  });

settingsRoutes.put("/settings", async (c) => {
  const denied = denyUnless(c, "settings.manage"); if (denied) return c.json(denied, 403);
  const db = c.get("db");
  const body = updateSettingsSchema.parse(await c.req.json());
  const adminUser = c.get("admin");
  const before = await getSettings(db); // ensures the row exists

  const warning = body.budgetWarningPercent ?? before.budgetWarningPercent;
  const critical = body.budgetCriticalPercent ?? before.budgetCriticalPercent;
  if (critical <= warning) {
    return c.json({ error: "Critical percent must be greater than warning percent" }, 400);
  }
  if ((body.promoCriticalPercent ?? before.promoCriticalPercent) <= (body.promoWarningPercent ?? before.promoWarningPercent)) {
    return c.json({ error: "Promotional critical percent must be greater than its warning percent" }, 400);
  }

  const { planMonthlyCredits: planCredits, reason, maintenanceRenders, maintenanceSegments, ...rest } = body;
  const plansBefore = await planMonthlyCredits(db);
  const unknownPlan = Object.keys(planCredits ?? {}).find((slug) => !plansBefore.some((plan) => plan.slug === slug));
  if (unknownPlan) return c.json({ error: `No active plan "${unknownPlan}"` }, 400);

  // Pausing or resuming the studio is a governed action: a switch that actually changes waits
  // for a second admin when the maintenance rule is on. Everything else saves now.
  const maintenanceChange = {
    ...(maintenanceRenders !== undefined && maintenanceRenders !== before.maintenanceRenders ? { maintenanceRenders } : {}),
    ...(maintenanceSegments !== undefined && maintenanceSegments !== before.maintenanceSegments ? { maintenanceSegments } : {}),
  };
  const rules = await governance(db);
  const holdMaintenance = Object.keys(maintenanceChange).length > 0 && rules.maintenanceApprovalThreshold > 0 && 1 >= rules.maintenanceApprovalThreshold;
  const appBody = holdMaintenance ? rest : { ...rest, maintenanceRenders, maintenanceSegments };

  const applied = { planMonthlyCredits: planCredits, ...appBody };
  const changed = Object.keys(applied).filter((key) => applied[key as keyof typeof applied] !== undefined);
  let updated = before;
  if (changed.length > 0) {
    const versionWrites = await allowanceVersionWrites(db, planCredits ?? {}, reason || "Monthly credits changed in Settings", adminUser.id);
    // Plan allowances apply from each user's next credit period; nothing already granted changes.
    // Settings, plan allowances and the audit row commit together or not at all.
    const [rows] = await db.batch([
      db
        .update(schema.appSettings)
        .set({
          ...appBody,
          falBudgetUsd: appBody.falBudgetUsd === undefined ? undefined : appBody.falBudgetUsd === null ? null : appBody.falBudgetUsd.toFixed(2),
          promoBudgetUsd: appBody.promoBudgetUsd === undefined ? undefined : appBody.promoBudgetUsd === null ? null : appBody.promoBudgetUsd.toFixed(2),
          updatedAt: new Date(),
          updatedBy: adminUser.id,
        })
        .where(eq(schema.appSettings.id, 1))
        .returning(),
      adminEventInsert(db, {
        actorId: adminUser.id,
        action: "settings.update",
        targetType: "settings",
        targetId: "1",
        summary: `Updated settings: ${changed.join(", ")}`,
        detail: {
          before: {
            planMonthlyCredits: Object.fromEntries(plansBefore.map((plan) => [plan.slug, plan.monthlyCredits])),
            dailyRenderLimit: before.dailyRenderLimit,
            dailySegmentLimit: before.dailySegmentLimit,
            monthlyRenderLimit: before.monthlyRenderLimit,
            monthlySegmentLimit: before.monthlySegmentLimit,
            maxCreditBalance: before.maxCreditBalance,
            maxProjectsPerUser: before.maxProjectsPerUser,
            maxUploadMb: before.maxUploadMb,
            maxReferenceImages: before.maxReferenceImages,
            maxPromptChars: before.maxPromptChars,
            maxSelectionPromptChars: before.maxSelectionPromptChars,
            lowCreditThreshold: before.lowCreditThreshold,
            messageInsufficientCredits: before.messageInsufficientCredits,
            messageDailyLimit: before.messageDailyLimit,
            messageMonthlyLimit: before.messageMonthlyLimit,
            messageBudgetExhausted: before.messageBudgetExhausted,
            messageAccountDisabled: before.messageAccountDisabled,
            creditsPerImage: before.creditsPerImage,
            creditsPerSelection: before.creditsPerSelection,
            maintenanceRenders: before.maintenanceRenders,
            maintenanceSegments: before.maintenanceSegments,
            maintenanceMessage: before.maintenanceMessage,
            budgetWarningPercent: before.budgetWarningPercent,
            budgetCriticalPercent: before.budgetCriticalPercent,
            stuckTimeoutMinutes: before.stuckTimeoutMinutes,
            storageCapMb: before.storageCapMb,
            storagePerUserMb: before.storagePerUserMb,
            falMode: before.falMode,
            falBudgetUsd: before.falBudgetUsd === null ? null : Number(before.falBudgetUsd),
            freeAllowanceMode: before.freeAllowanceMode,
            freeAllowanceDailyApprovals: before.freeAllowanceDailyApprovals,
            promoBudgetUsd: before.promoBudgetUsd === null ? null : Number(before.promoBudgetUsd),
            promoWarningPercent: before.promoWarningPercent,
            promoCriticalPercent: before.promoCriticalPercent,
          },
          after: applied,
          ...(reason ? { reason } : {}),
        },
      }),
      ...Object.entries(planCredits ?? {}).map(([slug, monthlyCredits]) =>
        db.update(schema.billingPlans).set({ monthlyCredits, updatedAt: new Date() }).where(eq(schema.billingPlans.slug, slug)),
      ),
      ...versionWrites,
    ]);
    updated = rows[0]!;
  }

  if (!holdMaintenance) return c.json(await toAdminSettings(c.env, db, updated));
  const approval = await requestApproval(db, {
    action: "maintenance", actorId: adminUser.id, targetType: "settings", targetId: "1",
    riskValue: 1, threshold: rules.maintenanceApprovalThreshold,
    reason: reason || "Maintenance change requested from Settings",
    payload: maintenanceChange,
  });
  const response: AdminSettings = { ...(await toAdminSettings(c.env, db, updated)), pendingApproval: { approvalId: approval.id, fields: Object.keys(maintenanceChange) } };
  return c.json(response, 202);
});
