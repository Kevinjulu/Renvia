import { Hono } from "hono";
import { desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@renvia/db";
import type { AdminSettings } from "@renvia/types";
import type { Env } from "../../index.js";
import { modelsFor } from "../../lib/models.js";
import { getSettings, effectiveBudgetUsd, effectiveEngineMode, type AppSettingsRow } from "../../lib/settings.js";
import { denyUnless } from "./permissions.js";
import { MICROS_PER_USD, recordAdminEvent } from "./shared.js";
import type { AdminContext } from "./context.js";

export const settingsRoutes = new Hono<AdminContext>();

async function toAdminSettings(env: Env, db: Database, row: AppSettingsRow): Promise<AdminSettings> {
  const [[renderSpend], [segSpend], updaterRows, changeRows] = await Promise.all([
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.renders.costMicros}), 0)::bigint`,
      })
      .from(schema.renders)
      .where(ne(schema.renders.status, "failed")),
    db
      .select({
        spentMicros: sql<number>`coalesce(sum(${schema.segmentations.costMicros}), 0)::bigint`,
      })
      .from(schema.segmentations)
      .where(ne(schema.segmentations.status, "failed")),
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
  ]);

  const envMode = env.FAL_MODE?.trim() || null;
  const envBudgetRaw = Number(env.FAL_BUDGET_USD);
  const envBudgetUsd = Number.isFinite(envBudgetRaw) && envBudgetRaw > 0 ? envBudgetRaw : null;
  const effectiveMode = effectiveEngineMode(env, row);

  return {
    signupBonusCredits: row.signupBonusCredits,
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
    maintenanceRenders: row.maintenanceRenders,
    maintenanceSegments: row.maintenanceSegments,
    maintenanceMessage: row.maintenanceMessage,
    budgetWarningPercent: row.budgetWarningPercent,
    budgetCriticalPercent: row.budgetCriticalPercent,
    stuckTimeoutMinutes: row.stuckTimeoutMinutes,
    falMode: row.falMode,
    falBudgetUsd: row.falBudgetUsd === null ? null : Number(row.falBudgetUsd),
    effectiveMode,
    effectiveBudgetUsd: effectiveBudgetUsd(env, row),
    spentUsd: (Number(renderSpend?.spentMicros ?? 0) + Number(segSpend?.spentMicros ?? 0)) / MICROS_PER_USD,
    envMode,
    envBudgetUsd,
    health: {
      falKeyConfigured: Boolean(env.FAL_KEY?.trim()),
      storageConfigured: Boolean(
        env.NEON_STORAGE_ACCESS_KEY_ID?.trim() &&
          env.NEON_STORAGE_SECRET_ACCESS_KEY?.trim() &&
          env.NEON_STORAGE_ENDPOINT?.trim() &&
          env.NEON_STORAGE_BUCKET?.trim(),
      ),
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
    signupBonusCredits: z.number().int().min(0).max(1000).optional(),
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
    falMode: z.enum(["mock", "dev", "prod"]).nullable().optional(),
    falBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
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

  const [updated] = await db
    .update(schema.appSettings)
    .set({
      ...body,
      falBudgetUsd: body.falBudgetUsd === undefined ? undefined : body.falBudgetUsd === null ? null : body.falBudgetUsd.toFixed(2),
      updatedAt: new Date(),
      updatedBy: adminUser.id,
    })
    .where(eq(schema.appSettings.id, 1))
    .returning();

  const changed = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined);
  await recordAdminEvent(db, {
    actorId: adminUser.id,
    action: "settings.update",
    targetType: "settings",
    targetId: "1",
    summary: `Updated settings: ${changed.join(", ") || "no fields"}`,
    detail: {
      before: {
        signupBonusCredits: before.signupBonusCredits,
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
        falMode: before.falMode,
        falBudgetUsd: before.falBudgetUsd === null ? null : Number(before.falBudgetUsd),
      },
      after: body,
    },
  });

  return c.json(await toAdminSettings(c.env, db, updated!));
});
