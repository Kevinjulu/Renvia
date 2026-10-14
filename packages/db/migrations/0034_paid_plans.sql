-- Paid plans: Free, Pro and Premium, billed monthly or yearly through PayPal or Paystack
-- (card and M-Pesa).
--
-- Slugs stay starter / studio / team so Studio Control rules and admin overrides keep working;
-- only the customer-facing names and terms change. Each terms change is also written to
-- billing_plan_versions, so the admin history explains it.

ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "yearly_price_cents" integer;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "paypal_yearly_plan_id" text;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "paystack_plan_code" text;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "paystack_yearly_plan_code" text;
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_paypal_yearly_plan_unique" ON "billing_plans" ("paypal_yearly_plan_id");
DO $$ BEGIN
  ALTER TABLE "billing_plans" ADD CONSTRAINT "billing_plans_yearly_price_non_negative" CHECK ("yearly_price_cents" IS NULL OR "yearly_price_cents" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How the current subscription is billed; null on Free.
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "billing_interval" text;
-- Provider references needed to manage a subscription later (e.g. Paystack's email token).
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "provider_metadata" jsonb;
DO $$ BEGIN
  ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_billing_interval_valid" CHECK ("billing_interval" IS NULL OR "billing_interval" IN ('month', 'year'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "user_entitlements_period_end_idx" ON "user_entitlements" ("current_period_end");

ALTER TABLE "billing_checkouts" ADD COLUMN IF NOT EXISTS "billing_interval" text;
DO $$ BEGIN
  ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_billing_interval_valid" CHECK ("billing_interval" IS NULL OR "billing_interval" IN ('month', 'year'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Version 1 for any plan never edited before: its terms as they stand now.
INSERT INTO "billing_plan_versions" ("plan_id", "version", "terms", "reason")
SELECT p."id", 1, jsonb_build_object(
    'name', p."name", 'description', p."description", 'currency', p."currency", 'priceCents', p."price_cents",
    'interval', p."interval", 'monthlyCredits', p."monthly_credits", 'dailyRenderLimit', p."daily_render_limit",
    'monthlyRenderLimit', p."monthly_render_limit", 'maxProjects', p."max_projects",
    'concurrentRenderLimit', p."concurrent_render_limit", 'isActive', p."is_active", 'paypalPlanId', p."paypal_plan_id"),
  'Terms before the first admin edit'
FROM "billing_plans" p
WHERE p."slug" IN ('starter', 'studio', 'team')
  AND NOT EXISTS (SELECT 1 FROM "billing_plan_versions" v WHERE v."plan_id" = p."id");

UPDATE "billing_plans" SET "name" = 'Free', "description" = 'Try Renvia with monthly credits. Renders stay in the Studio.', "updated_at" = now()
WHERE "slug" = 'starter';

UPDATE "billing_plans" SET
  "name" = 'Pro', "description" = 'For quickly visualising your designs.',
  "price_cents" = 2900, "yearly_price_cents" = 29000, "monthly_credits" = 300,
  "daily_render_limit" = 60, "monthly_render_limit" = NULL, "max_projects" = 50, "concurrent_render_limit" = 3,
  "is_active" = true, "updated_at" = now()
WHERE "slug" = 'studio';

UPDATE "billing_plans" SET
  "name" = 'Premium', "description" = 'For professional visualisations at volume.',
  "price_cents" = 7900, "yearly_price_cents" = 79000, "monthly_credits" = 1000,
  "daily_render_limit" = 250, "monthly_render_limit" = NULL, "max_projects" = 500, "concurrent_render_limit" = 8,
  "is_active" = true, "updated_at" = now()
WHERE "slug" = 'team';

-- The new terms as the next version of each plan.
INSERT INTO "billing_plan_versions" ("plan_id", "version", "terms", "reason")
SELECT p."id", (SELECT max(v."version") FROM "billing_plan_versions" v WHERE v."plan_id" = p."id") + 1, jsonb_build_object(
    'name', p."name", 'description', p."description", 'currency', p."currency", 'priceCents', p."price_cents",
    'yearlyPriceCents', p."yearly_price_cents", 'interval', p."interval", 'monthlyCredits', p."monthly_credits",
    'dailyRenderLimit', p."daily_render_limit", 'monthlyRenderLimit', p."monthly_render_limit", 'maxProjects', p."max_projects",
    'concurrentRenderLimit', p."concurrent_render_limit", 'isActive', p."is_active", 'paypalPlanId', p."paypal_plan_id",
    'paypalYearlyPlanId', p."paypal_yearly_plan_id", 'paystackPlanCode', p."paystack_plan_code", 'paystackYearlyPlanCode', p."paystack_yearly_plan_code"),
  'Launch paid plans: Free, Pro and Premium with yearly billing'
FROM "billing_plans" p
WHERE p."slug" IN ('starter', 'studio', 'team');
