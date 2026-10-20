-- Durable render cost accounting. Additive only: no existing row is rewritten.
--
-- projects.deleted_at: deleting a project hides it instead of deleting its renders, whose
-- cost_micros the fal budget, beta budgets and usage limits are summed from.
--
-- renders.cost_state / uncertain_cost_micros: provider-cost settlement, separate from the job's
-- status and the customer's credits. A cancel or timeout after submission keeps the job's cost
-- counted ("uncertain") until fal's own outcome is read back. Existing rows keep NULL (untracked):
-- their cost_micros already follow the old rule, which zeroed every failure.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_owner_live_idx" ON "projects" ("owner_id", "created_at" DESC) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "cost_state" text;
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "uncertain_cost_micros" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "renders" ADD CONSTRAINT "renders_cost_state_values" CHECK ("cost_state" IS NULL OR "cost_state" IN ('pending', 'settled', 'uncertain', 'unresolved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "renders" ADD CONSTRAINT "renders_uncertain_cost_within_cost" CHECK ("uncertain_cost_micros" >= 0 AND "uncertain_cost_micros" <= "cost_micros");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renders_cost_uncertain_idx" ON "renders" ("updated_at") WHERE "cost_state" = 'uncertain';
