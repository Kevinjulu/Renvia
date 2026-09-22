import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, bigint, jsonb, uuid, boolean, index, uniqueIndex, check, numeric } from "drizzle-orm/pg-core";
import type { RenderGenerationSettings } from "@renvia/types";

export const users = pgTable(
  "users",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  /** Spendable credits (1 credit = 1 image); every change is mirrored in credit_ledger. */
  creditBalance: integer("credit_balance").notNull().default(0),
  disabled: boolean("disabled").notNull().default(false),
  /** Per-user override of app_settings.daily_render_limit; null = use the global setting. */
  dailyRenderLimitOverride: integer("daily_render_limit_override"),
  /** Per-user override of app_settings.daily_segment_limit; null = use the global setting. */
  dailySegmentLimitOverride: integer("daily_segment_limit_override"),
  /** Per-user override of app_settings.monthly_render_limit; null = use the global setting. */
  monthlyRenderLimitOverride: integer("monthly_render_limit_override"),
  /** Per-user override of app_settings.monthly_segment_limit; null = use the global setting. */
  monthlySegmentLimitOverride: integer("monthly_segment_limit_override"),
  /** Skips daily/monthly caps and maintenance pauses. Still charged credits, still capped by the fal budget. */
  limitsExempt: boolean("limits_exempt").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("users_credit_balance_non_negative", sql`${table.creditBalance} >= 0`),
    check(
      "users_daily_render_limit_override_range",
      sql`${table.dailyRenderLimitOverride} IS NULL OR ${table.dailyRenderLimitOverride} BETWEEN 0 AND 10000`,
    ),
    check(
      "users_daily_segment_limit_override_range",
      sql`${table.dailySegmentLimitOverride} IS NULL OR ${table.dailySegmentLimitOverride} BETWEEN 0 AND 10000`,
    ),
    check(
      "users_monthly_render_limit_override_range",
      sql`${table.monthlyRenderLimitOverride} IS NULL OR ${table.monthlyRenderLimitOverride} BETWEEN 0 AND 100000`,
    ),
    check(
      "users_monthly_segment_limit_override_range",
      sql`${table.monthlySegmentLimitOverride} IS NULL OR ${table.monthlySegmentLimitOverride} BETWEEN 0 AND 100000`,
    ),
  ],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const canvasNodes = pgTable("canvas_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  type: text("type").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const renders = pgTable("renders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  status: text("status", { enum: ["pending", "processing", "succeeded", "failed"] })
    .notNull()
    .default("pending"),
  sourceImageUrl: text("source_image_url").notNull(),
  resultImageUrl: text("result_image_url"),
  prompt: text("prompt").notNull(),
  /** "auto" (match source) or a W:H ratio the model actually supports — see models.ts. */
  aspectRatio: text("aspect_ratio").notNull().default("auto"),
  style: text("style").notNull().default("Photorealistic"),
  viewKey: text("view_key"),
  viewLabel: text("view_label"),
  falRequestId: text("fal_request_id"),
  errorMessage: text("error_message"),
  // Engine model id ("mock" in mock mode) and its estimated cost in USD micros
  // (1e-6 USD) — summed to enforce the fal spending cap.
  model: text("model"),
  costMicros: integer("cost_micros").notNull().default(0),
  settings: jsonb("settings").$type<RenderGenerationSettings>(),
  /** Credits debited when the render was created; refunded if it fails. */
  creditsCharged: integer("credits_charged").notNull().default(0),
  /**
   * The seed actually used: what the caller requested, or what the model echoed back when
   * none was given. Null when the model doesn't report one (nano-banana/edit) and none was
   * requested — that render can't be exactly reproduced.
   *
   * bigint, not integer: fal echoes back unsigned 32-bit seeds up to ~4.29 billion, which
   * overflows Postgres's signed int4 (max ~2.147 billion) — every refresh of a render whose
   * random seed landed above that line failed to save and got stuck retrying forever.
   */
  seed: bigint("seed", { mode: "number" }),
  /** Starred by the owner in the studio's results panel. */
  isFavorite: boolean("is_favorite").notNull().default(false),
  /**
   * Set when the owner removes the render from their history. The row stays so spend caps,
   * credit history and the admin render log still count it.
   */
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "renders_aspect_ratio_values",
      sql`${table.aspectRatio} IN ('auto', '1:1', '16:9', '4:3', '3:4', '9:16')`,
    ),
  ],
);

export const referenceImages = pgTable("reference_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  url: text("url").notNull(),
  source: text("source", { enum: ["upload", "unsplash", "url"] })
    .notNull()
    .default("upload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Automatic selections (SAM 3 on fal) made while editing a render. Each is charged like an
 * image and its fal cost counts toward the global spending cap alongside renders.
 */
export const segmentations = pgTable(
  "segmentations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    imageUrl: text("image_url").notNull(),
    /** What to select, e.g. "windows"; null for a click selection. */
    prompt: text("prompt"),
    /** Clicked point in image pixels, for click selections. */
    point: jsonb("point").$type<{ x: number; y: number }>(),
    status: text("status", { enum: ["pending", "succeeded", "failed"] })
      .notNull()
      .default("pending"),
    /** Number of objects the selection found. */
    objectCount: integer("object_count"),
    model: text("model").notNull(),
    costMicros: integer("cost_micros").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("segmentations_user_created_idx").on(table.userId, table.createdAt)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Positive for grants and refunds, negative for spending. */
    amount: integer("amount").notNull(),
    reason: text("reason", {
      enum: ["signup_bonus", "initial_grant", "admin_grant", "render", "render_refund", "segment", "segment_refund", "purchase"],
    }).notNull(),
    renderId: uuid("render_id").references(() => renders.id, { onDelete: "set null" }),
    segmentationId: uuid("segmentation_id").references(() => segmentations.id, { onDelete: "set null" }),
    note: text("note"),
    /** Admin who made a manual adjustment. */
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One debit and at most one refund per render, so a refund can never be applied twice.
    uniqueIndex("credit_ledger_render_reason_unique").on(table.renderId, table.reason),
    // Same guarantee for automatic selections.
    uniqueIndex("credit_ledger_segmentation_reason_unique").on(table.segmentationId, table.reason),
    index("credit_ledger_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * Operator settings editable from the admin app without a redeploy. Exactly one row
 * (id = 1). Null engine fields fall back to the FAL_MODE / FAL_BUDGET_USD env vars.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    signupBonusCredits: integer("signup_bonus_credits").notNull().default(25),
    /** Max renders per non-admin user per UTC day; null = unlimited. */
    dailyRenderLimit: integer("daily_render_limit"),
    /** Max segmentations per non-admin user per UTC day; null = unlimited. */
    dailySegmentLimit: integer("daily_segment_limit"),
    /** Max renders per non-admin user per UTC calendar month; null = unlimited. */
    monthlyRenderLimit: integer("monthly_render_limit"),
    /** Max segmentations per non-admin user per UTC calendar month; null = unlimited. */
    monthlySegmentLimit: integer("monthly_segment_limit"),
    /** Ceiling on a non-admin's credit balance — grants clamp to it. Null = uncapped. */
    maxCreditBalance: integer("max_credit_balance"),
    /** Max projects a non-admin may own; null = unlimited. */
    maxProjectsPerUser: integer("max_projects_per_user"),
    /** Largest accepted upload, in megabytes. */
    maxUploadMb: integer("max_upload_mb").notNull().default(10),
    /** Max style/material reference images per render. */
    maxReferenceImages: integer("max_reference_images").notNull().default(8),
    /** Max characters in a render prompt. */
    maxPromptChars: integer("max_prompt_chars").notNull().default(2000),
    /** Max characters in an automatic-selection prompt. */
    maxSelectionPromptChars: integer("max_selection_prompt_chars").notNull().default(200),
    /** Studio warns the user at or below this balance. 0 disables the warning. */
    lowCreditThreshold: integer("low_credit_threshold").notNull().default(5),
    /** Operator copy for each refusal; null falls back to the studio's built-in wording. */
    messageInsufficientCredits: text("message_insufficient_credits"),
    messageDailyLimit: text("message_daily_limit"),
    messageMonthlyLimit: text("message_monthly_limit"),
    messageBudgetExhausted: text("message_budget_exhausted"),
    messageAccountDisabled: text("message_account_disabled"),
    /** Credits charged per render/edit image. */
    creditsPerImage: integer("credits_per_image").notNull().default(1),
    /** Credits charged per automatic selection. */
    creditsPerSelection: integer("credits_per_selection").notNull().default(1),
    /** Pause new renders for non-admins. */
    maintenanceRenders: boolean("maintenance_renders").notNull().default(false),
    /** Pause new segmentations for non-admins. */
    maintenanceSegments: boolean("maintenance_segments").notNull().default(false),
    /** Optional message shown in studio when maintenance is on. */
    maintenanceMessage: text("maintenance_message"),
    /** Overview/settings budget warning threshold (percent of cap). */
    budgetWarningPercent: integer("budget_warning_percent").notNull().default(70),
    /** Overview/settings budget critical threshold (percent of cap). */
    budgetCriticalPercent: integer("budget_critical_percent").notNull().default(90),
    /** Minutes before pending/processing is considered stuck. */
    stuckTimeoutMinutes: integer("stuck_timeout_minutes").notNull().default(15),
    falMode: text("fal_mode", { enum: ["mock", "dev", "prod"] }),
    falBudgetUsd: numeric("fal_budget_usd", { precision: 10, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [
    check("app_settings_single_row", sql`${table.id} = 1`),
    check("app_settings_signup_bonus_range", sql`${table.signupBonusCredits} BETWEEN 0 AND 1000`),
    check(
      "app_settings_daily_limit_range",
      sql`${table.dailyRenderLimit} IS NULL OR ${table.dailyRenderLimit} BETWEEN 1 AND 10000`,
    ),
    check(
      "app_settings_daily_segment_limit_range",
      sql`${table.dailySegmentLimit} IS NULL OR ${table.dailySegmentLimit} BETWEEN 1 AND 10000`,
    ),
    check(
      "app_settings_monthly_limit_range",
      sql`${table.monthlyRenderLimit} IS NULL OR ${table.monthlyRenderLimit} BETWEEN 1 AND 100000`,
    ),
    check(
      "app_settings_monthly_segment_limit_range",
      sql`${table.monthlySegmentLimit} IS NULL OR ${table.monthlySegmentLimit} BETWEEN 1 AND 100000`,
    ),
    check(
      "app_settings_max_credit_balance_range",
      sql`${table.maxCreditBalance} IS NULL OR ${table.maxCreditBalance} BETWEEN 1 AND 1000000`,
    ),
    check(
      "app_settings_max_projects_range",
      sql`${table.maxProjectsPerUser} IS NULL OR ${table.maxProjectsPerUser} BETWEEN 1 AND 10000`,
    ),
    check("app_settings_max_upload_mb_range", sql`${table.maxUploadMb} BETWEEN 1 AND 100`),
    check("app_settings_max_reference_images_range", sql`${table.maxReferenceImages} BETWEEN 0 AND 16`),
    check("app_settings_max_prompt_chars_range", sql`${table.maxPromptChars} BETWEEN 50 AND 8000`),
    check(
      "app_settings_max_selection_prompt_chars_range",
      sql`${table.maxSelectionPromptChars} BETWEEN 10 AND 1000`,
    ),
    check("app_settings_low_credit_threshold_range", sql`${table.lowCreditThreshold} BETWEEN 0 AND 1000`),
    check("app_settings_credits_per_image_range", sql`${table.creditsPerImage} BETWEEN 0 AND 100`),
    check("app_settings_credits_per_selection_range", sql`${table.creditsPerSelection} BETWEEN 0 AND 100`),
    check("app_settings_budget_warning_range", sql`${table.budgetWarningPercent} BETWEEN 1 AND 99`),
    check("app_settings_budget_critical_range", sql`${table.budgetCriticalPercent} BETWEEN 2 AND 100`),
    check(
      "app_settings_budget_thresholds_order",
      sql`${table.budgetCriticalPercent} > ${table.budgetWarningPercent}`,
    ),
    check("app_settings_stuck_timeout_range", sql`${table.stuckTimeoutMinutes} BETWEEN 1 AND 1440`),
    check("app_settings_fal_mode_values", sql`${table.falMode} IS NULL OR ${table.falMode} IN ('mock', 'dev', 'prod')`),
    check("app_settings_budget_range", sql`${table.falBudgetUsd} IS NULL OR ${table.falBudgetUsd} BETWEEN 0 AND 10000`),
  ],
);

/**
 * Operator actions from the admin app (credit adjustments, role changes, settings).
 * Written at the same time as the mutation so the Audit tab has a durable trail.
 */
export const adminEvents = pgTable(
  "admin_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    /** e.g. credits.adjust, user.update, settings.update */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("admin_events_created_idx").on(table.createdAt)],
);
