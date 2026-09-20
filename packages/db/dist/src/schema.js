import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, jsonb, uuid, boolean, index, uniqueIndex, check, numeric } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkId: text("clerk_id").notNull().unique(),
    email: text("email").notNull(),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    /** Spendable credits (1 credit = 1 image); every change is mirrored in credit_ledger. */
    creditBalance: integer("credit_balance").notNull().default(0),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("users_credit_balance_non_negative", sql `${table.creditBalance} >= 0`)]);
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
    resolution: text("resolution").notNull().default("1K"),
    style: text("style").notNull().default("Photorealistic"),
    viewKey: text("view_key"),
    viewLabel: text("view_label"),
    falRequestId: text("fal_request_id"),
    errorMessage: text("error_message"),
    // Engine model id ("mock" in mock mode) and its estimated cost in USD micros
    // (1e-6 USD) — summed to enforce the fal spending cap.
    model: text("model"),
    costMicros: integer("cost_micros").notNull().default(0),
    settings: jsonb("settings").$type(),
    /** Credits debited when the render was created; refunded if it fails. */
    creditsCharged: integer("credits_charged").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
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
export const segmentations = pgTable("segmentations", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    imageUrl: text("image_url").notNull(),
    /** What to select, e.g. "windows"; null for a click selection. */
    prompt: text("prompt"),
    /** Clicked point in image pixels, for click selections. */
    point: jsonb("point").$type(),
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
}, (table) => [index("segmentations_user_created_idx").on(table.userId, table.createdAt)]);
export const creditLedger = pgTable("credit_ledger", {
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
}, (table) => [
    // One debit and at most one refund per render, so a refund can never be applied twice.
    uniqueIndex("credit_ledger_render_reason_unique").on(table.renderId, table.reason),
    // Same guarantee for automatic selections.
    uniqueIndex("credit_ledger_segmentation_reason_unique").on(table.segmentationId, table.reason),
    index("credit_ledger_user_created_idx").on(table.userId, table.createdAt),
]);
/**
 * Operator settings editable from the admin app without a redeploy. Exactly one row
 * (id = 1). Null engine fields fall back to the FAL_MODE / FAL_BUDGET_USD env vars.
 */
export const appSettings = pgTable("app_settings", {
    id: integer("id").primaryKey().default(1),
    signupBonusCredits: integer("signup_bonus_credits").notNull().default(25),
    /** Max renders per non-admin user per UTC day; null = unlimited. */
    dailyRenderLimit: integer("daily_render_limit"),
    /** Max segmentations per non-admin user per UTC day; null = unlimited. */
    dailySegmentLimit: integer("daily_segment_limit"),
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
}, (table) => [
    check("app_settings_single_row", sql `${table.id} = 1`),
    check("app_settings_signup_bonus_range", sql `${table.signupBonusCredits} BETWEEN 0 AND 1000`),
    check("app_settings_daily_limit_range", sql `${table.dailyRenderLimit} IS NULL OR ${table.dailyRenderLimit} BETWEEN 1 AND 10000`),
    check("app_settings_daily_segment_limit_range", sql `${table.dailySegmentLimit} IS NULL OR ${table.dailySegmentLimit} BETWEEN 1 AND 10000`),
    check("app_settings_credits_per_image_range", sql `${table.creditsPerImage} BETWEEN 0 AND 100`),
    check("app_settings_credits_per_selection_range", sql `${table.creditsPerSelection} BETWEEN 0 AND 100`),
    check("app_settings_budget_warning_range", sql `${table.budgetWarningPercent} BETWEEN 1 AND 99`),
    check("app_settings_budget_critical_range", sql `${table.budgetCriticalPercent} BETWEEN 2 AND 100`),
    check("app_settings_budget_thresholds_order", sql `${table.budgetCriticalPercent} > ${table.budgetWarningPercent}`),
    check("app_settings_stuck_timeout_range", sql `${table.stuckTimeoutMinutes} BETWEEN 1 AND 1440`),
    check("app_settings_fal_mode_values", sql `${table.falMode} IS NULL OR ${table.falMode} IN ('mock', 'dev', 'prod')`),
    check("app_settings_budget_range", sql `${table.falBudgetUsd} IS NULL OR ${table.falBudgetUsd} BETWEEN 0 AND 10000`),
]);
/**
 * Operator actions from the admin app (credit adjustments, role changes, settings).
 * Written at the same time as the mutation so the Audit tab has a durable trail.
 */
export const adminEvents = pgTable("admin_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
        .notNull()
        .references(() => users.id),
    /** e.g. credits.adjust, user.update, settings.update */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("admin_events_created_idx").on(table.createdAt)]);
//# sourceMappingURL=schema.js.map