-- Free-allowance eligibility and the promotional budget. Additive: balances, ledger rows,
-- credit periods and entitlements are untouched.
--
-- user_entitlements.free_allowance_*: whether the Free plan's monthly allowance may be granted.
-- Every existing account starts approved (the column is added with that default, then the
-- default changes for new accounts only). With app_settings.free_allowance_mode at its default,
-- off, nothing reads it.
--
-- users.email_normalized / email_verified: the evidence the rules use. email_normalized is
-- filled for existing accounts below (derived from the stored email; nothing new is collected).
--
-- renders/segmentations.funding_pool and budget_reservations.pool: jobs paid from the Free
-- allowance count against the promotional budget (app_settings.promo_budget_usd, null = no cap).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_normalized" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_normalized_idx" ON "users" ("email_normalized");
--> statement-breakpoint
-- Same rule as normalizeEmail in apps/api/src/lib/freeAllowance.ts.
UPDATE "users" SET "email_normalized" = CASE
    WHEN split_part(lower(trim("email")), '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(lower(trim("email")), '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE split_part(split_part(lower(trim("email")), '@', 1), '+', 1) || '@' || split_part(lower(trim("email")), '@', 2)
  END
  WHERE "email_normalized" IS NULL;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_status" text DEFAULT 'approved' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ALTER COLUMN "free_allowance_status" SET DEFAULT 'pending';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_free_allowance_status_values" CHECK ("free_allowance_status" IN ('approved', 'pending', 'verification_required', 'review_required', 'denied'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_reason" text;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_decided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_decided_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_rule_version" integer;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_assessed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "free_allowance_approved_until" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "free_allowance_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "outcome" text NOT NULL,
  "mode" text NOT NULL,
  "score" integer,
  "rule_version" integer,
  "signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reason" text NOT NULL,
  "decided_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "free_allowance_assessments_kind_values" CHECK ("kind" IN ('signup', 'renewal', 'evidence', 'operator')),
  CONSTRAINT "free_allowance_assessments_outcome_values" CHECK ("outcome" IN ('approved', 'verification_required', 'review_required', 'denied')),
  CONSTRAINT "free_allowance_assessments_mode_values" CHECK ("mode" IN ('off', 'observe', 'enforce', 'paused'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "free_allowance_assessments_user_created_idx" ON "free_allowance_assessments" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "free_allowance_assessments_kind_created_idx" ON "free_allowance_assessments" ("kind", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "funding_pool" text DEFAULT 'account' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "renders" ADD CONSTRAINT "renders_funding_pool_values" CHECK ("funding_pool" IN ('account', 'beta', 'promo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renders_promo_created_idx" ON "renders" ("created_at") WHERE "funding_pool" = 'promo';
--> statement-breakpoint
ALTER TABLE "segmentations" ADD COLUMN IF NOT EXISTS "funding_pool" text DEFAULT 'account' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "segmentations" ADD CONSTRAINT "segmentations_funding_pool_values" CHECK ("funding_pool" IN ('account', 'beta', 'promo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN IF NOT EXISTS "pool" text DEFAULT 'global' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_pool_values" CHECK ("pool" IN ('global', 'promo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "free_allowance_mode" text DEFAULT 'off' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "free_allowance_daily_approvals" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "promo_budget_usd" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "promo_warning_percent" integer DEFAULT 50 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "promo_critical_percent" integer DEFAULT 80 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_free_allowance_mode_values" CHECK ("free_allowance_mode" IN ('off', 'observe', 'enforce', 'paused'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_free_allowance_daily_approvals_range" CHECK ("free_allowance_daily_approvals" BETWEEN 1 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_promo_budget_range" CHECK ("promo_budget_usd" IS NULL OR "promo_budget_usd" BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_promo_thresholds" CHECK ("promo_warning_percent" BETWEEN 1 AND 99 AND "promo_critical_percent" BETWEEN 2 AND 100 AND "promo_critical_percent" > "promo_warning_percent");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
