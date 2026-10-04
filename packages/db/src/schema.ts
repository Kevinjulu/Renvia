import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, bigint, jsonb, uuid, boolean, index, uniqueIndex, check, numeric } from "drizzle-orm/pg-core";
import type { RenderGenerationSettings } from "@renvia/types";

export const users = pgTable(
  "users",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  role: text("role", { enum: ["user", "analyst", "support", "billing", "admin"] }).notNull().default("user"),
  /** Spendable credits; standard renders cost 1, while premium actions can cost more. Every change is mirrored in credit_ledger. */
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
 * Very short-lived budget holds used while a request converts a budget check into a render
 * or segmentation row. They close the race where simultaneous requests could all observe
 * the same remaining fal budget.
 */
export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: uuid("id").primaryKey(),
    costMicros: integer("cost_micros").notNull(),
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
      enum: ["signup_bonus", "initial_grant", "admin_grant", "render", "render_refund", "segment", "segment_refund", "purchase", "purchase_refund", "subscription_grant", "subscription_expiry"],
    }).notNull(),
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
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Unspent included monthly credits. Purchased and manual credits are not stored here. */
    monthlyCreditsRemaining: integer("monthly_credits_remaining").notNull().default(0),
    nextCreditGrantAt: timestamp("next_credit_grant_at", { withTimezone: true }),
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
