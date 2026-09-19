import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, jsonb, uuid, boolean, index, uniqueIndex, check, numeric } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("users_credit_balance_non_negative", sql`${table.creditBalance} >= 0`)],
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
  settings: jsonb("settings").$type<RenderGenerationSettings>(),
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
      enum: ["signup_bonus", "initial_grant", "admin_grant", "render", "render_refund", "purchase"],
    }).notNull(),
    renderId: uuid("render_id").references(() => renders.id, { onDelete: "set null" }),
    note: text("note"),
    /** Admin who made a manual adjustment. */
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One debit and at most one refund per render, so a refund can never be applied twice.
    uniqueIndex("credit_ledger_render_reason_unique").on(table.renderId, table.reason),
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
    check("app_settings_fal_mode_values", sql`${table.falMode} IS NULL OR ${table.falMode} IN ('mock', 'dev', 'prod')`),
    check("app_settings_budget_range", sql`${table.falBudgetUsd} IS NULL OR ${table.falBudgetUsd} BETWEEN 0 AND 10000`),
  ],
);
