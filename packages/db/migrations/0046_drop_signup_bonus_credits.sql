-- app_settings.signup_bonus_credits was never read: new accounts get their plan's monthly allowance
-- as their first credit period (lib/planCredits.ts), which is the one signup grant. Its default of
-- 25 contradicted the Free plan's 20 credits and nothing could change it, so it goes.
-- The ledger reason 'signup_bonus' stays: it labels historical credit_ledger rows.
ALTER TABLE "app_settings" DROP CONSTRAINT IF EXISTS "app_settings_signup_bonus_range";
--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "signup_bonus_credits";
