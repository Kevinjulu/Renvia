-- Plan economy: every plan can render all of a project's elevations at once, and edits no longer
-- count toward the daily and monthly render limits (they only spend credits).
--
--   Free (starter)  daily renders 5 -> 10, renders at once 1 -> 4   (20 monthly credits unchanged)
--   Pro (studio)    renders at once 3 -> 6
--   Premium (team)  unchanged (8 at once)
--
-- Each change only touches a plan still on its previous launch value, so a figure an operator has
-- since set from the admin is left alone, and every change is written to billing_plan_versions so
-- the admin history explains it. app_settings' fallback daily limit follows the Free plan's.

WITH changed AS (
  UPDATE "billing_plans"
  SET
    "daily_render_limit" = CASE WHEN "slug" = 'starter' AND "daily_render_limit" = 5 THEN 10 ELSE "daily_render_limit" END,
    "concurrent_render_limit" = CASE
      WHEN "slug" = 'starter' AND "concurrent_render_limit" = 1 THEN 4
      WHEN "slug" = 'studio' AND "concurrent_render_limit" = 3 THEN 6
      ELSE "concurrent_render_limit" END,
    "updated_at" = now()
  WHERE ("slug" = 'starter' AND ("daily_render_limit" = 5 OR "concurrent_render_limit" = 1))
     OR ("slug" = 'studio' AND "concurrent_render_limit" = 3)
  -- The snapshot below must come from these updated rows: a sibling statement of the same query
  -- would still see the plans as they were before the update.
  RETURNING *
)
INSERT INTO "billing_plan_versions" ("plan_id", "version", "terms", "reason")
SELECT p."id", COALESCE((SELECT max(v."version") FROM "billing_plan_versions" v WHERE v."plan_id" = p."id"), 0) + 1, jsonb_build_object(
    'name', p."name", 'description', p."description", 'currency', p."currency", 'priceCents', p."price_cents",
    'yearlyPriceCents', p."yearly_price_cents", 'interval', p."interval", 'monthlyCredits', p."monthly_credits",
    'dailyRenderLimit', p."daily_render_limit", 'monthlyRenderLimit', p."monthly_render_limit", 'maxProjects', p."max_projects",
    'concurrentRenderLimit', p."concurrent_render_limit", 'isActive', p."is_active", 'paypalPlanId', p."paypal_plan_id",
    'paypalYearlyPlanId', p."paypal_yearly_plan_id", 'paystackPlanCode', p."paystack_plan_code", 'paystackYearlyPlanCode', p."paystack_yearly_plan_code"),
  'Plan economy: more renders at once so every elevation renders together; edits no longer count toward the daily and monthly render limits'
FROM "changed" p;
--> statement-breakpoint

ALTER TABLE "app_settings" ALTER COLUMN "daily_render_limit" SET DEFAULT 10;
--> statement-breakpoint
UPDATE "app_settings" SET "daily_render_limit" = 10 WHERE "id" = 1 AND "daily_render_limit" = 5;
