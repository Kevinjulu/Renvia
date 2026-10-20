import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, bigint, jsonb, uuid, boolean, index, uniqueIndex, check, numeric, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { AdminCreditPackTerms, AdminPlanTerms, BetaAnnotations, BetaMissionRule, BetaWelcome, RenderGenerationSettings, StudioConfig } from "@renvia/types";

export const users = pgTable(
  "users",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  role: text("role", { enum: ["user", "analyst", "support", "billing", "admin"] }).notNull().default("user"),
  /** Spendable credits; standard renders cost 1, while premium actions can cost more. Every change is mirrored in credit_ledger. */
  creditBalance: integer("credit_balance").notNull().default(0),
  /** The part of creditBalance from the plan's monthly allowance; spent first, expires at renewal. */
  planCredits: integer("plan_credits").notNull().default(0),
  /** Scratch: plan credits taken by the charge that last set it, read later in the same transaction. */
  lastPlanDebit: integer("last_plan_debit").notNull().default(0),
  /** The part of creditBalance granted by a beta program; only beta-funded charges spend it. */
  betaCredits: integer("beta_credits").notNull().default(0),
  /** Scratch: beta credits removed by the statement that last set it, read later in the same transaction. */
  lastBetaDebit: integer("last_beta_debit").notNull().default(0),
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
  /** Last authenticated Studio, website, or API activity; throttled server-side. */
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("users_credit_balance_non_negative", sql`${table.creditBalance} >= 0`),
    check("users_plan_credits_within_balance", sql`${table.planCredits} >= 0 and ${table.planCredits} <= ${table.creditBalance}`),
    check("users_beta_credits_non_negative", sql`${table.betaCredits} >= 0`),
    check("users_plan_and_beta_within_balance", sql`${table.planCredits} + ${table.betaCredits} <= ${table.creditBalance}`),
    index("users_last_active_idx").on(table.lastActiveAt),
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

export const projects = pgTable(
  "projects",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("projects_owner_idx").on(table.ownerId)],
);

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

/** The job_type expression, kept identical to migration 0030. */
const RENDER_JOB_TYPE_SQL = sql`CASE
    WHEN jsonb_typeof("settings" -> 'upscale') = 'object' THEN 'upscale'
    WHEN jsonb_typeof("settings" -> 'edit') = 'object' THEN
      CASE WHEN coalesce(jsonb_array_length(CASE WHEN jsonb_typeof("settings" -> 'referenceImageUrls') = 'array' THEN "settings" -> 'referenceImageUrls' END), 0) > 0
        THEN 'edit-references' ELSE 'edit' END
    WHEN coalesce(jsonb_array_length(CASE WHEN jsonb_typeof("settings" -> 'referenceImageUrls') = 'array' THEN "settings" -> 'referenceImageUrls' END), 0) > 0 THEN
      CASE WHEN "settings" -> 'fidelity' ->> 'mode' = 'strict' THEN 'fidelity' ELSE 'references' END
    ELSE coalesce("settings" ->> 'sourceType', 'photo')
  END`;

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
   * none was given. Null when the model doesn't report one and none was
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
  /**
   * Client-generated, one per Generate/Apply click. A request retried after a timeout returns
   * the render this key already created instead of charging for a second one.
   */
  idempotencyKey: text("idempotency_key"),
  /**
   * Generated by Postgres from `settings` (see migration 0030, which mirrors renderRouteFor):
   * photo | drawing | references | fidelity | edit | edit-references | upscale. Never written.
   */
  jobType: text("job_type").generatedAlwaysAs(RENDER_JOB_TYPE_SQL),
  /** Generated: "4k" | "8k" when the job delivers a high-resolution copy, else null. */
  outputResolution: text("output_resolution").generatedAlwaysAs(sql`coalesce("settings" -> 'highRes' ->> 'target', "settings" -> 'upscale' ->> 'target')`),
  /** The Studio Control version the request was checked against; null before migration 0031. */
  configVersion: integer("config_version"),
  /** Set when beta credits paid for the job; its cost then counts toward that program's budget. */
  betaProgramId: uuid("beta_program_id").references((): AnyPgColumn => betaPrograms.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "renders_aspect_ratio_values",
      sql`${table.aspectRatio} IN ('auto', '1:1', '16:9', '4:3', '3:4', '9:16')`,
    ),
    // Partial in the migration (WHERE idempotency_key IS NOT NULL), like billing checkouts'.
    uniqueIndex("renders_project_idempotency_unique").on(table.projectId, table.idempotencyKey),
    index("renders_status_created_idx").on(table.status, table.createdAt.desc()),
    index("renders_created_idx").on(table.createdAt.desc()),
    index("renders_model_created_idx").on(table.model, table.createdAt.desc()),
    index("renders_project_created_idx").on(table.projectId, table.createdAt.desc()),
    index("renders_job_type_created_idx").on(table.jobType, table.createdAt.desc()),
  ],
);

/**
 * Render lifecycle history, written only by the renders_record_job_events trigger (migration
 * 0030) in the same transaction as each transition. Renders older than that have no rows.
 */
export const renderJobEvents = pgTable(
  "render_job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    renderId: uuid("render_id").notNull().references(() => renders.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: ["created", "submitted", "environment_started", "upscale_started", "upscale_completed", "upscale_failed", "completed", "failed", "cancelled"],
    }).notNull(),
    /** The pass that was running: render | environment | upscale. */
    stage: text("stage", { enum: ["render", "environment", "upscale"] }).notNull(),
    providerRequestId: text("provider_request_id"),
    model: text("model"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (table) => [
    index("render_job_events_render_time_idx").on(table.renderId, table.occurredAt),
    index("render_job_events_type_time_idx").on(table.eventType, table.occurredAt),
  ],
);

/** One row per scheduled job: a lease so overlapping runs skip, and its last outcome. */
export const scheduledJobs = pgTable("scheduled_jobs", {
  name: text("name").primaryKey(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
  runCount: integer("run_count").notNull().default(0),
});

export const referenceImages = pgTable("reference_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  url: text("url").notNull(),
  source: text("source", { enum: ["upload", "url"] })
    .notNull()
    .default("upload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sample references the team uploads for everyone, grouped by REFERENCE_CATEGORIES. One stored
 * object under stock/ serves every user: picking one attaches its link, nothing is copied.
 */
export const stockReferences = pgTable(
  "stock_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category", { enum: ["windows", "roof", "doors", "pillars", "outdoors", "exterior"] }).notNull(),
    key: text("key").notNull().unique(),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    hidden: boolean("hidden").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stock_references_category_idx").on(table.category, table.sortOrder)],
);

/**
 * Very short-lived budget holds used while a request converts a budget check into a render
 * or segmentation row. They close the race where simultaneous requests could all observe
 * the same remaining fal budget.
 */
export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: uuid("id").primaryKey(),
    costMicros: integer("cost_micros").notNull(),
    /** A beta program's hold; the global cap ignores these, since the job's global hold already counts. */
    betaProgramId: uuid("beta_program_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("budget_reservations_cost_non_negative", sql`${table.costMicros} >= 0`)],
);

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
    /** The Studio Control version the request was checked against; null before migration 0031. */
    configVersion: integer("config_version"),
    /** Set when beta credits paid for the selection. */
    betaProgramId: uuid("beta_program_id").references((): AnyPgColumn => betaPrograms.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("segmentations_user_created_idx").on(table.userId, table.createdAt),
    index("segmentations_status_created_idx").on(table.status, table.createdAt.desc()),
  ],
);

/**
 * One "Polish prompt" request. Free to users (no credits); recorded for the per-user daily cap and
 * so its AI cost counts toward the fal spending cap, like renders and selections.
 */
export const promptPolishes = pgTable(
  "prompt_polishes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["render", "edit"] }).notNull(),
    /** ai: rewritten by the language model. rules: the deterministic fallback, which costs nothing. */
    engine: text("engine", { enum: ["ai", "rules"] }).notNull(),
    model: text("model"),
    status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
    costMicros: integer("cost_micros").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("prompt_polishes_user_created_idx").on(table.userId, table.createdAt)],
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
      enum: ["signup_bonus", "initial_grant", "admin_grant", "render", "render_refund", "segment", "segment_refund", "purchase", "purchase_refund", "subscription_grant", "subscription_expiry", "plan_grant", "plan_expiry", "promo_expiry", "beta_grant", "beta_expiry"],
    }).notNull(),
    /** The part of `amount` that moved plan credits; refunds return that part to plan credits. */
    planAmount: integer("plan_amount").notNull().default(0),
    /** The part of `amount` that moved beta credits; refunds return that part to beta credits. */
    betaAmount: integer("beta_amount").notNull().default(0),
    /** The beta enrollment a beta grant, charge or expiry belongs to. */
    betaEnrollmentId: uuid("beta_enrollment_id").references((): AnyPgColumn => betaEnrollments.id),
    /** Set on plan grants and expiries: at most one of each per user per credit period. */
    periodKey: text("period_key"),
    renderId: uuid("render_id").references(() => renders.id, { onDelete: "set null" }),
    segmentationId: uuid("segmentation_id").references(() => segmentations.id, { onDelete: "set null" }),
    /** Ties purchased credits to a provider payment so refunds can be reversed safely. */
    paymentId: uuid("payment_id").references(() => billingPayments.id, { onDelete: "set null" }),
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
    uniqueIndex("credit_ledger_payment_reason_unique").on(table.paymentId, table.reason),
    uniqueIndex("credit_ledger_user_reason_period_unique").on(table.userId, table.reason, table.periodKey).where(sql`${table.periodKey} is not null`),
    index("credit_ledger_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * Commercial plans are data, not an interpretation of a user's remaining credits.
 * Amounts are stored in the currency's minor unit (for USD, cents).
 */
export const billingPlans = pgTable(
  "billing_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    currency: text("currency").notNull().default("USD"),
    priceCents: integer("price_cents").notNull().default(0),
    interval: text("interval", { enum: ["none", "month"] }).notNull().default("none"),
    /** Credits granted on every successful subscription renewal; 0 for the Free plan. */
    monthlyCredits: integer("monthly_credits").notNull().default(0),
    /** Included credits permitted to carry into the next cycle. Renvia starts at zero. */
    rolloverCredits: integer("rollover_credits").notNull().default(0),
    dailyRenderLimit: integer("daily_render_limit"),
    monthlyRenderLimit: integer("monthly_render_limit"),
    maxProjects: integer("max_projects"),
    concurrentRenderLimit: integer("concurrent_render_limit"),
    isActive: boolean("is_active").notNull().default(true),
    /** PayPal subscription plan ID. Null keeps the plan unavailable for recurring checkout. */
    paypalPlanId: text("paypal_plan_id").unique(),
    /** Price of a year up front; null means the plan isn't sold yearly. */
    yearlyPriceCents: integer("yearly_price_cents"),
    /** PayPal plan billing yearlyPriceCents once a year. */
    paypalYearlyPlanId: text("paypal_yearly_plan_id").unique(),
    /** Paystack plan codes. With one, card payments renew automatically; without, each payment buys one period. */
    paystackPlanCode: text("paystack_plan_code"),
    paystackYearlyPlanCode: text("paystack_yearly_plan_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("billing_plans_price_non_negative", sql`${table.priceCents} >= 0`),
    check("billing_plans_monthly_credits_non_negative", sql`${table.monthlyCredits} >= 0`),
    check("billing_plans_rollover_non_negative", sql`${table.rolloverCredits} >= 0 AND ${table.rolloverCredits} <= ${table.monthlyCredits}`),
    check("billing_plans_daily_limit_range", sql`${table.dailyRenderLimit} IS NULL OR ${table.dailyRenderLimit} BETWEEN 1 AND 10000`),
    check("billing_plans_monthly_limit_range", sql`${table.monthlyRenderLimit} IS NULL OR ${table.monthlyRenderLimit} BETWEEN 1 AND 100000`),
    check("billing_plans_max_projects_range", sql`${table.maxProjects} IS NULL OR ${table.maxProjects} BETWEEN 1 AND 10000`),
    check("billing_plans_concurrent_limit_range", sql`${table.concurrentRenderLimit} IS NULL OR ${table.concurrentRenderLimit} BETWEEN 1 AND 100`),
  ],
);

/** A user's current commercial access. This remains authoritative even at a zero credit balance. */
export const userEntitlements = pgTable(
  "user_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().unique().references(() => users.id),
    planId: uuid("plan_id").notNull().references(() => billingPlans.id),
    status: text("status", { enum: ["active", "past_due", "canceled", "expired"] }).notNull().default("active"),
    provider: text("provider", { enum: ["manual", "paypal", "stripe", "paystack", "flutterwave", "mpesa"] }),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    /** How the current subscription is billed; null on the Free plan. */
    billingInterval: text("billing_interval", { enum: ["month", "year"] }),
    /** Provider references needed to manage the subscription later, such as Paystack's email token. */
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Unspent included monthly credits. Purchased and manual credits are not stored here. */
    monthlyCreditsRemaining: integer("monthly_credits_remaining").notNull().default(0),
    nextCreditGrantAt: timestamp("next_credit_grant_at", { withTimezone: true }),
    /**
     * A plan granted by an admin without payment. It applies instead of planId until
     * overrideEndsAt (null = until cleared); planId itself is never overwritten.
     */
    overridePlanId: uuid("override_plan_id").references(() => billingPlans.id),
    overrideEndsAt: timestamp("override_ends_at", { withTimezone: true }),
    overrideReason: text("override_reason"),
    overrideSetBy: uuid("override_set_by").references(() => users.id),
    overrideSetAt: timestamp("override_set_at", { withTimezone: true }),
    /** Start of the current monthly credit period (signup anniversary, or a paid renewal). */
    creditPeriodStart: timestamp("credit_period_start", { withTimezone: true }),
    /** The highest monthly allowance granted in this period; upgrades top up only the difference. */
    periodCreditsGranted: integer("period_credits_granted").notNull().default(0),
    /** Scratch: the top-up computed by the statement that sets it, read later in the same transaction. */
    lastTopup: integer("last_topup").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_entitlements_provider_subscription_unique").on(table.provider, table.providerSubscriptionId),
    index("user_entitlements_grant_due_idx").on(table.status, table.nextCreditGrantAt),
    check("user_entitlements_monthly_credits_non_negative", sql`${table.monthlyCreditsRemaining} >= 0`),
  ],
);

/** One-off purchasable credit packs. Payment-provider product IDs are configured later, not hard-coded in UI. */
export const creditPacks = pgTable(
  "credit_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("USD"),
    priceCents: integer("price_cents").notNull(),
    credits: integer("credits").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("credit_packs_price_positive", sql`${table.priceCents} > 0`),
    check("credit_packs_credits_positive", sql`${table.credits} > 0`),
  ],
);

/** A provider-neutral purchase attempt. The chosen provider supplies its opaque checkout ID. */
export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    planId: uuid("plan_id").references(() => billingPlans.id),
    creditPackId: uuid("credit_pack_id").references(() => creditPacks.id),
    kind: text("kind", { enum: ["subscription", "credit_pack"] }).notNull(),
    provider: text("provider", { enum: ["paypal", "stripe", "paystack", "flutterwave", "mpesa"] }).notNull(),
    providerCheckoutId: text("provider_checkout_id").unique(),
    /** Client-generated key makes a retried checkout request safe before a provider order exists. */
    idempotencyKey: text("idempotency_key"),
    /** For a subscription checkout: the billing period it pays for. */
    billingInterval: text("billing_interval", { enum: ["month", "year"] }),
    status: text("status", { enum: ["created", "pending", "paid", "expired", "canceled", "failed"] }).notNull().default("created"),
    currency: text("currency").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** Provider IDs needed to reconcile a signed webhook; never store payment instruments. */
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("billing_checkouts_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("billing_checkouts_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    check("billing_checkouts_amount_non_negative", sql`${table.amountCents} >= 0`),
    check("billing_checkouts_one_product", sql`(${table.planId} IS NOT NULL) <> (${table.creditPackId} IS NOT NULL)`),
  ],
);

export const billingPayments = pgTable(
  "billing_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkoutId: uuid("checkout_id").references(() => billingCheckouts.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider", { enum: ["paypal", "stripe", "paystack", "flutterwave", "mpesa"] }).notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    status: text("status", { enum: ["pending", "paid", "refunded", "failed"] }).notNull(),
    currency: text("currency").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex("billing_payments_provider_payment_unique").on(table.provider, table.providerPaymentId),
    index("billing_payments_user_created_idx").on(table.userId, table.createdAt),
    check("billing_payments_amount_non_negative", sql`${table.amountCents} >= 0`),
  ],
);

export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    paymentId: uuid("payment_id").references(() => billingPayments.id),
    provider: text("provider", { enum: ["paypal", "stripe", "paystack", "flutterwave", "mpesa"] }).notNull(),
    providerInvoiceId: text("provider_invoice_id"),
    number: text("number").notNull().unique(),
    status: text("status", { enum: ["open", "paid", "void", "uncollectible"] }).notNull(),
    currency: text("currency").notNull(),
    amountCents: integer("amount_cents").notNull(),
    hostedUrl: text("hosted_url"),
    pdfUrl: text("pdf_url"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_invoices_provider_invoice_unique").on(table.provider, table.providerInvoiceId),
    index("billing_invoices_user_issued_idx").on(table.userId, table.issuedAt),
    check("billing_invoices_amount_non_negative", sql`${table.amountCents} >= 0`),
  ],
);

/** Raw provider events are retained for idempotency and post-payment auditability. */
export const billingWebhookEvents = pgTable(
  "billing_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider", { enum: ["paypal", "stripe", "paystack", "flutterwave", "mpesa"] }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureMessage: text("failure_message"),
    /** PAYPAL verification outcome; non-PayPal providers may leave this null. */
    verificationStatus: text("verification_status"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("billing_webhook_events_provider_event_unique").on(table.provider, table.providerEventId)],
);

/**
 * Operator settings editable from the admin app without a redeploy. Exactly one row
 * (id = 1). Null engine fields fall back to the FAL_MODE / FAL_BUDGET_USD env vars.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    /**
     * @deprecated Never read. New accounts get their plan's monthly allowance as their first
     * credit period (see planCredits.ts) — that is the one signup grant. Kept only so the column
     * isn't dropped before a deliberate migration; don't wire it up as a second grant.
     */
    signupBonusCredits: integer("signup_bonus_credits").notNull().default(25),
    /** Max renders per non-admin user per UTC day; null = unlimited. */
    dailyRenderLimit: integer("daily_render_limit").default(5),
    /** Max segmentations per non-admin user per UTC day; null = unlimited. */
    dailySegmentLimit: integer("daily_segment_limit"),
    /** Max renders per non-admin user per UTC calendar month; null = unlimited. */
    monthlyRenderLimit: integer("monthly_render_limit"),
    /** Max segmentations per non-admin user per UTC calendar month; null = unlimited. */
    monthlySegmentLimit: integer("monthly_segment_limit"),
    /** Ceiling on a non-admin's credit balance — grants clamp to it. Null = uncapped. */
    maxCreditBalance: integer("max_credit_balance"),
    /** Max projects a non-admin may own; null = unlimited. */
    maxProjectsPerUser: integer("max_projects_per_user").default(2),
    /** Largest accepted upload, in megabytes. */
    maxUploadMb: integer("max_upload_mb").notNull().default(10),
    /** Max style/material reference images per render. */
    maxReferenceImages: integer("max_reference_images").notNull().default(8),
    /** Max characters in a render prompt. */
    maxPromptChars: integer("max_prompt_chars").notNull().default(1000),
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
    /** New uploads and renders are refused once stored objects reach this many MB (10^6 bytes). */
    storageCapMb: integer("storage_cap_mb").notNull().default(9000),
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
    check("app_settings_storage_cap_range", sql`${table.storageCapMb} BETWEEN 100 AND 10000`),
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

/** Immutable support notes. Notes are deliberately append-only: corrections are new notes. */
export const customerNotes = pgTable(
  "customer_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("customer_notes_user_created_idx").on(table.userId, table.createdAt)],
);

/** Small, operator-owned labels for support triage. */
export const customerTags = pgTable(
  "customer_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("customer_tags_user_label_unique").on(table.userId, table.normalizedLabel)],
);

/** One configuration row; zero disables the corresponding approval gate. */
export const governanceSettings = pgTable(
  "governance_settings",
  {
    id: integer("id").primaryKey().default(1),
    bulkCreditApprovalThreshold: integer("bulk_credit_approval_threshold").notNull().default(500),
    refundApprovalThresholdCents: integer("refund_approval_threshold_cents").notNull().default(5000),
    roleChangeApprovalThreshold: integer("role_change_approval_threshold").notNull().default(1),
    maintenanceApprovalThreshold: integer("maintenance_approval_threshold").notNull().default(1),
    /** 1 holds every Studio Control publish for approval; 0 (the default) lets an admin publish directly. */
    studioChangeApprovalThreshold: integer("studio_change_approval_threshold").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [check("governance_settings_single_row", sql`${table.id} = 1`)],
);

/** Pending requests hold a server-validated action payload until a different admin approves it. */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action", { enum: ["bulk_credits", "refund", "role_change", "maintenance", "studio_change", "maintenance_window", "plan_change", "beta_grant", "beta_budget"] }).notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "executed", "cancelled"] }).notNull().default("pending"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    riskValue: integer("risk_value").notNull(),
    threshold: integer("threshold").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    decisionNote: text("decision_note"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("approval_requests_status_created_idx").on(table.status, table.createdAt)],
);

/** Append-only state transitions for approval requests. */
export const approvalEvents = pgTable(
  "approval_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    approvalId: uuid("approval_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action", { enum: ["requested", "approved", "rejected", "executed", "cancelled"] }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("approval_events_approval_created_idx").on(table.approvalId, table.createdAt)],
);

/** An exported audit snapshot is retained with its digest so it cannot silently change. */
export const auditExports = pgTable(
  "audit_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    sha256: text("sha256").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_exports_created_idx").on(table.createdAt)],
);

/** A durable operational case, opened from a failed/stuck production condition. */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable key for one open incident per detected condition. */
    fingerprint: text("fingerprint").notNull(),
    sourceType: text("source_type", { enum: ["render", "segmentation", "webhook", "system"] }).notNull(),
    sourceId: text("source_id").notNull(),
    severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
    status: text("status", { enum: ["open", "acknowledged", "resolved"] }).notNull().default("open"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("incidents_status_severity_seen_idx").on(table.status, table.severity, table.lastSeenAt),
    index("incidents_source_idx").on(table.sourceType, table.sourceId),
  ],
);

/** Immutable account of assignments, acknowledgements, recovery and resolution decisions. */
export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action", { enum: ["opened", "assigned", "acknowledged", "recovered", "resolved", "reopened", "severity_changed", "notification"] }).notNull(),
    note: text("note"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("incident_events_incident_created_idx").on(table.incidentId, table.createdAt)],
);

/** Each notification attempt is retained even when an optional ops webhook is unavailable. */
export const incidentNotifications = pgTable(
  "incident_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["ops_webhook"] }).notNull().default("ops_webhook"),
    status: text("status", { enum: ["delivered", "failed", "skipped"] }).notNull(),
    destination: text("destination"),
    failureMessage: text("failure_message"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [index("incident_notifications_incident_idx").on(table.incidentId, table.attemptedAt)],
);

/**
 * Published Studio configurations (feature rules). Never updated: a change or rollback is a new
 * version. The latest version is the one in force.
 */
export const studioConfigRevisions = pgTable(
  "studio_config_revisions",
  {
    version: integer("version").primaryKey(),
    config: jsonb("config").$type<StudioConfig>().notNull(),
    /** SHA-256 of the canonical JSON of `config`. */
    checksum: text("checksum").notNull(),
    reason: text("reason").notNull(),
    publishedBy: uuid("published_by").references(() => users.id),
    restoredFrom: integer("restored_from"),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("studio_config_revisions_version_positive", sql`${table.version} > 0`)],
);

/** Requests an observe-mode feature rule would have refused. */
export const studioFeatureObservations = pgTable(
  "studio_feature_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureKey: text("feature_key").notNull(),
    reason: text("reason", { enum: ["disabled", "plan", "rollout"] }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    configVersion: integer("config_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("studio_feature_observations_feature_created_idx").on(table.featureKey, table.createdAt)],
);

/** Scheduled maintenance; active while now() is inside [startsAt, endsAt) and not cancelled. */
export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope", { enum: ["all", "renders", "selections"] }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    message: text("message"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("maintenance_windows_scope_values", sql`${table.scope} IN ('all', 'renders', 'selections')`),
    check("maintenance_windows_order", sql`${table.endsAt} > ${table.startsAt}`),
    index("maintenance_windows_ends_idx").on(table.endsAt),
  ],
);

/** Immutable snapshots of a plan's terms, one per change made from the admin. */
export const billingPlanVersions = pgTable(
  "billing_plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => billingPlans.id),
    version: integer("version").notNull(),
    terms: jsonb("terms").$type<AdminPlanTerms>().notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_plan_versions_plan_version_unique").on(table.planId, table.version),
    check("billing_plan_versions_version_positive", sql`${table.version} > 0`),
  ],
);

/** Immutable snapshots of a credit pack's terms, one per change made from the admin. */
export const creditPackVersions = pgTable(
  "credit_pack_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packId: uuid("pack_id").notNull().references(() => creditPacks.id),
    version: integer("version").notNull(),
    terms: jsonb("terms").$type<AdminCreditPackTerms>().notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("credit_pack_versions_pack_version_unique").on(table.packId, table.version),
    check("credit_pack_versions_version_positive", sql`${table.version} > 0`),
  ],
);

/**
 * Every object the API has written to storage, with its size. Usage is summed from here rather
 * than by listing the bucket, which R2 bills as a Class A operation.
 */
export const storageObjects = pgTable(
  "storage_objects",
  {
    key: text("key").primaryKey(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    kind: text("kind", { enum: ["upload", "render", "watermark", "feedback", "stock", "thumbnail"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("storage_objects_kind_idx").on(table.kind),
    check("storage_objects_bytes_non_negative", sql`${table.bytes} >= 0`),
  ],
);

// ── Beta program ──────────────────────────────────────────────────────────────────
// docs/beta-testing-system.md. A tester is an enrollment, never a role; beta credits are a bucket
// inside users.credit_balance, recorded in credit_ledger.

/** One private testing program: its dates, capacity, credit rules, budget and benefits. */
export const betaPrograms = pgTable(
  "beta_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["draft", "active", "paused", "ended"] }).notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Active and suspended enrollments plus open invitation slots never exceed this. */
    maxTesters: integer("max_testers").notNull().default(10),
    /** Beta credits granted on enrollment. */
    creditsPerTester: integer("credits_per_tester").notNull().default(25),
    /** Ceiling on everything granted to one enrollment, top-ups included. */
    maxCreditsPerTester: integer("max_credits_per_tester").notNull().default(100),
    /** Ceiling on everything granted across the program; null = no pool limit. */
    creditPool: integer("credit_pool"),
    /** Hard cap on the fal cost of beta-funded jobs. Credits granted never raise it. */
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 2 }).notNull().default("10"),
    /** Percent of budgetUsd at which operators are warned; 100% is always reported. */
    budgetWarningPercent: integer("budget_warning_percent").notNull().default(80),
    /** Replace the plan's limits while enrolled; null keeps the plan's. */
    dailyRenderLimit: integer("daily_render_limit"),
    monthlyRenderLimit: integer("monthly_render_limit"),
    concurrentRenderLimit: integer("concurrent_render_limit"),
    /** Studio feature keys usable regardless of plan (operator kill switches still win). */
    featureGrants: text("feature_grants").array().notNull().default(sql`'{}'::text[]`),
    downloadsUnlocked: boolean("downloads_unlocked").notNull().default(true),
    welcome: jsonb("welcome").$type<BetaWelcome>(),
    attachmentBudgetMb: integer("attachment_budget_mb").notNull().default(500),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("beta_programs_status_values", sql`${table.status} IN ('draft', 'active', 'paused', 'ended')`),
    check("beta_programs_dates_order", sql`${table.endsAt} > ${table.startsAt}`),
    check("beta_programs_budget_range", sql`${table.budgetUsd} BETWEEN 0 AND 10000`),
  ],
);

export const betaInvitations = pgTable(
  "beta_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => betaPrograms.id),
    kind: text("kind", { enum: ["email", "link", "existing_user"] }).notNull(),
    email: text("email"),
    userId: uuid("user_id").references(() => users.id),
    /** SHA-256 (hex) of the token; the token itself is shown once and never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    maxRedemptions: integer("max_redemptions").notNull().default(1),
    redemptions: integer("redemptions").notNull().default(0),
    creditsOverride: integer("credits_override"),
    cohort: text("cohort"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("beta_invitations_program_idx").on(table.programId, table.createdAt)],
);

export const betaEnrollments = pgTable(
  "beta_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => betaPrograms.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    invitationId: uuid("invitation_id").references(() => betaInvitations.id),
    status: text("status", { enum: ["active", "suspended", "completed", "revoked"] }).notNull().default("active"),
    cohort: text("cohort"),
    profession: text("profession"),
    /** Everything granted to this enrollment so far, checked against maxCreditsPerTester. */
    creditsGranted: integer("credits_granted").notNull().default(0),
    /** A per-tester extension; null = the program's endsAt. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    welcomeSeenAt: timestamp("welcome_seen_at", { withTimezone: true }),
    tourCompletedAt: timestamp("tour_completed_at", { withTimezone: true }),
    announcementsSeenAt: timestamp("announcements_seen_at", { withTimezone: true }),
    repliesSeenAt: timestamp("replies_seen_at", { withTimezone: true }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("beta_enrollments_program_user_unique").on(table.programId, table.userId),
    // Partial in the migration (status IN active, suspended): one live enrollment per user.
    uniqueIndex("beta_enrollments_one_live_per_user").on(table.userId),
    index("beta_enrollments_program_status_idx").on(table.programId, table.status),
  ],
);

export const betaMissions = pgTable(
  "beta_missions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => betaPrograms.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    rule: jsonb("rule").$type<BetaMissionRule>().notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("beta_missions_program_idx").on(table.programId, table.position)],
);

/** A row exists only once a mission is complete. */
export const betaMissionProgress = pgTable(
  "beta_mission_progress",
  {
    enrollmentId: uuid("enrollment_id").notNull().references(() => betaEnrollments.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").notNull().references(() => betaMissions.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["auto", "tester", "admin"] }).notNull(),
    verifiedBy: uuid("verified_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.enrollmentId, table.missionId] })],
);

export const betaFeedback = pgTable(
  "beta_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Readable number ("BETA-142"); generated by Postgres. */
    number: integer("number").generatedAlwaysAsIdentity(),
    programId: uuid("program_id").notNull().references(() => betaPrograms.id),
    enrollmentId: uuid("enrollment_id").notNull().references(() => betaEnrollments.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: ["bug", "visual_quality", "usability", "suggestion", "praise"] }).notNull(),
    category: text("category", {
      enum: ["architecture_changed", "materials_wrong", "render_failed", "render_stuck", "edit_wrong", "ui_problem", "billing_credits", "other"],
    }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    severityReported: text("severity_reported", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
    severity: text("severity", { enum: ["low", "medium", "high", "critical"] }),
    status: text("status", {
      enum: ["new", "triaged", "investigating", "fix_in_progress", "ready_to_verify", "resolved", "duplicate", "expected", "cannot_reproduce", "declined"],
    }).notNull().default("new"),
    renderId: uuid("render_id").references(() => renders.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    canvasNodeId: text("canvas_node_id"),
    annotations: jsonb("annotations").$type<BetaAnnotations>(),
    /** Built by the server from its own records when the report is filed; never user-supplied. */
    diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
    attachmentKey: text("attachment_key"),
    duplicateOf: uuid("duplicate_of").references((): AnyPgColumn => betaFeedback.id, { onDelete: "set null" }),
    knownIssue: boolean("known_issue").notNull().default(false),
    knownIssueTitle: text("known_issue_title"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    githubUrl: text("github_url"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("beta_feedback_program_status_idx").on(table.programId, table.status, table.createdAt.desc()),
    index("beta_feedback_user_idx").on(table.userId, table.createdAt.desc()),
  ],
);

/** Append-only thread per report: replies, internal notes and status changes. */
export const betaFeedbackComments = pgTable(
  "beta_feedback_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedbackId: uuid("feedback_id").notNull().references(() => betaFeedback.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull().default(""),
    visibility: text("visibility", { enum: ["tester", "internal"] }).notNull(),
    kind: text("kind", { enum: ["comment", "status_change", "request_info"] }).notNull().default("comment"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("beta_feedback_comments_feedback_idx").on(table.feedbackId, table.createdAt)],
);

export const betaAnnouncements = pgTable(
  "beta_announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => betaPrograms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    severity: text("severity", { enum: ["info", "important"] }).notNull().default("info"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [index("beta_announcements_program_idx").on(table.programId, table.publishedAt.desc())],
);
