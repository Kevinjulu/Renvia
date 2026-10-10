-- Monthly plan credits. credit_balance stays the one spendable total; plan_credits is the part
-- of it that came from the plan's monthly allowance and expires at renewal. Everything else in
-- the balance (purchases, admin grants) never expires. Spending takes plan credits first.
--
-- Backward compatible: plan_credits starts at 0 for everyone, so code that only updates
-- credit_balance still satisfies the check until the new code starts granting plan credits.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_credits" integer DEFAULT 0 NOT NULL;
-- Scratch value each charge writes in the same statement that moves the balance, so the ledger
-- row written next in that transaction can record how much came from plan credits.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_plan_debit" integer DEFAULT 0 NOT NULL;
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_plan_credits_within_balance"
    CHECK ("plan_credits" >= 0 AND "plan_credits" <= "credit_balance");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How much of each ledger movement was plan credits, so a refund returns them to the same part.
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "plan_amount" integer DEFAULT 0 NOT NULL;
-- One plan grant per user per credit period: the key makes renewals safe to repeat.
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "period_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_user_reason_period_unique"
  ON "credit_ledger" ("user_id", "reason", "period_key")
  WHERE "period_key" IS NOT NULL;

-- The user's current monthly credit period. The anniversary of signup sets the dates; the
-- highest allowance granted in the period caps mid-period upgrade top-ups.
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "credit_period_start" timestamp with time zone;
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "period_credits_granted" integer DEFAULT 0 NOT NULL;
-- Scratch value for a top-up, written and read in one transaction like last_plan_debit.
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "last_topup" integer DEFAULT 0 NOT NULL;

-- Starter's free monthly allowance. Code that predates monthly credits never reads it for
-- Starter, so setting it ahead of the deploy is safe. Only the untouched default changes.
UPDATE "billing_plans" SET "monthly_credits" = 20, "updated_at" = now()
  WHERE "slug" = 'starter' AND "monthly_credits" = 0;
