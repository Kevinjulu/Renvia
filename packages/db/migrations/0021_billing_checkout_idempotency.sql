ALTER TABLE "billing_checkouts" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkouts_user_idempotency_unique"
  ON "billing_checkouts" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
