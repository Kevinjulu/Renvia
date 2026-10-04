ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "payment_id" uuid REFERENCES "billing_payments"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_payment_reason_unique" ON "credit_ledger" ("payment_id", "reason") WHERE "payment_id" IS NOT NULL;
