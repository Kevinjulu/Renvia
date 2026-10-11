-- Version history for plans and credit packs edited in the admin's Plans & Pricing page.
--
-- Additive only. billing_plans and credit_packs stay the live terms every existing query reads;
-- each change also writes an immutable snapshot here, so any past price, allowance or limit can
-- be explained. A plan or pack with no rows yet gets version 1 (its current terms) the first time
-- it is edited.

CREATE TABLE IF NOT EXISTS "billing_plan_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "billing_plans"("id"),
  "version" integer NOT NULL,
  "terms" jsonb NOT NULL,
  "reason" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "approval_id" uuid REFERENCES "approval_requests"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_plan_versions_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plan_versions_plan_version_unique" ON "billing_plan_versions" ("plan_id", "version");

CREATE TABLE IF NOT EXISTS "credit_pack_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pack_id" uuid NOT NULL REFERENCES "credit_packs"("id"),
  "version" integer NOT NULL,
  "terms" jsonb NOT NULL,
  "reason" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "approval_id" uuid REFERENCES "approval_requests"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_pack_versions_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "credit_pack_versions_pack_version_unique" ON "credit_pack_versions" ("pack_id", "version");
