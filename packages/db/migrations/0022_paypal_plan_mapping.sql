ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "paypal_plan_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_paypal_plan_unique"
  ON "billing_plans" ("paypal_plan_id") WHERE "paypal_plan_id" IS NOT NULL;
