-- A render request carries a client-generated key per click, so a request retried after a
-- timeout returns the render it already created instead of charging for a second one.
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "renders_project_idempotency_unique"
  ON "renders" ("project_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
