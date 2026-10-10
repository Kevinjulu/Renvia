-- A plan an admin grants by hand (client demos, partners, testers) sits on top of the user's
-- base plan until it ends. The base plan (Starter, later a PayPal subscription) is never
-- overwritten, so an override expiring simply lets the base plan apply again.
-- All columns are nullable: code that predates them keeps reading planId as before.
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "override_plan_id" uuid REFERENCES "billing_plans"("id");
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "override_ends_at" timestamp with time zone;
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "override_reason" text;
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "override_set_by" uuid REFERENCES "users"("id");
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "override_set_at" timestamp with time zone;
