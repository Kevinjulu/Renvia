-- Staff roles are text values in Postgres; extending the Drizzle enum is enough
-- for the application, and this index keeps operator-directory queries cheap.
CREATE INDEX IF NOT EXISTS "users_role_disabled_idx" ON "users" ("role", "disabled");

-- PayPal is now a supported billing provider. These columns are additive and
-- make webhook reconciliation deterministic without storing card/payer data.
ALTER TABLE "billing_checkouts" ADD COLUMN IF NOT EXISTS "provider_metadata" jsonb;
ALTER TABLE "billing_payments" ADD COLUMN IF NOT EXISTS "provider_metadata" jsonb;
ALTER TABLE "billing_webhook_events" ADD COLUMN IF NOT EXISTS "verification_status" text;
ALTER TABLE "billing_webhook_events" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "billing_webhook_events" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "billing_webhook_events_pending_idx"
  ON "billing_webhook_events" ("provider", "processed_at", "failed_at", "created_at");
