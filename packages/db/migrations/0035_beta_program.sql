-- Private beta program (docs/beta-testing-system.md). Testers are enrollments, never roles; beta
-- credits are a third bucket inside users.credit_balance, recorded in credit_ledger like plan
-- credits; and each program's fal spend has its own hard cap alongside the global one.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "beta_programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  -- draft | active | paused | ended
  "status" text NOT NULL DEFAULT 'draft',
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "max_testers" integer NOT NULL DEFAULT 10,
  "credits_per_tester" integer NOT NULL DEFAULT 25,
  "max_credits_per_tester" integer NOT NULL DEFAULT 100,
  "credit_pool" integer,
  "budget_usd" numeric(10, 2) NOT NULL DEFAULT 10,
  "budget_warning_percent" integer NOT NULL DEFAULT 80,
  "daily_render_limit" integer,
  "monthly_render_limit" integer,
  "concurrent_render_limit" integer,
  "feature_grants" text[] NOT NULL DEFAULT '{}',
  "downloads_unlocked" boolean NOT NULL DEFAULT true,
  "welcome" jsonb,
  "attachment_budget_mb" integer NOT NULL DEFAULT 500,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "beta_programs_status_values" CHECK ("status" IN ('draft', 'active', 'paused', 'ended')),
  CONSTRAINT "beta_programs_dates_order" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "beta_programs_max_testers_range" CHECK ("max_testers" BETWEEN 1 AND 1000),
  CONSTRAINT "beta_programs_credits_range" CHECK ("credits_per_tester" BETWEEN 0 AND 10000 AND "max_credits_per_tester" BETWEEN "credits_per_tester" AND 100000),
  CONSTRAINT "beta_programs_credit_pool_range" CHECK ("credit_pool" IS NULL OR "credit_pool" BETWEEN 0 AND 10000000),
  CONSTRAINT "beta_programs_budget_range" CHECK ("budget_usd" BETWEEN 0 AND 10000),
  CONSTRAINT "beta_programs_warning_range" CHECK ("budget_warning_percent" BETWEEN 1 AND 99),
  CONSTRAINT "beta_programs_daily_limit_range" CHECK ("daily_render_limit" IS NULL OR "daily_render_limit" BETWEEN 1 AND 10000),
  CONSTRAINT "beta_programs_monthly_limit_range" CHECK ("monthly_render_limit" IS NULL OR "monthly_render_limit" BETWEEN 1 AND 100000),
  CONSTRAINT "beta_programs_concurrent_limit_range" CHECK ("concurrent_render_limit" IS NULL OR "concurrent_render_limit" BETWEEN 1 AND 100),
  CONSTRAINT "beta_programs_attachment_budget_range" CHECK ("attachment_budget_mb" BETWEEN 0 AND 10000)
);

CREATE TABLE IF NOT EXISTS "beta_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "program_id" uuid NOT NULL REFERENCES "beta_programs"("id"),
  -- email | link | existing_user
  "kind" text NOT NULL,
  "email" text,
  "user_id" uuid REFERENCES "users"("id"),
  -- SHA-256 (hex) of the token; the token itself is shown once and never stored.
  "token_hash" text NOT NULL UNIQUE,
  "max_redemptions" integer NOT NULL DEFAULT 1,
  "redemptions" integer NOT NULL DEFAULT 0,
  "credits_override" integer,
  "cohort" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid REFERENCES "users"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "beta_invitations_kind_values" CHECK ("kind" IN ('email', 'link', 'existing_user')),
  CONSTRAINT "beta_invitations_target" CHECK (
    ("kind" = 'email' AND "email" IS NOT NULL) OR ("kind" = 'existing_user' AND "user_id" IS NOT NULL) OR "kind" = 'link'
  ),
  CONSTRAINT "beta_invitations_redemptions_range" CHECK ("max_redemptions" BETWEEN 1 AND 1000 AND "redemptions" BETWEEN 0 AND "max_redemptions"),
  CONSTRAINT "beta_invitations_credits_range" CHECK ("credits_override" IS NULL OR "credits_override" BETWEEN 0 AND 10000)
);
CREATE INDEX IF NOT EXISTS "beta_invitations_program_idx" ON "beta_invitations" ("program_id", "created_at");
CREATE INDEX IF NOT EXISTS "beta_invitations_user_idx" ON "beta_invitations" ("user_id") WHERE "user_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "beta_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "program_id" uuid NOT NULL REFERENCES "beta_programs"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "invitation_id" uuid REFERENCES "beta_invitations"("id"),
  -- active | suspended | completed | revoked
  "status" text NOT NULL DEFAULT 'active',
  "cohort" text,
  "profession" text,
  "credits_granted" integer NOT NULL DEFAULT 0,
  -- A per-tester extension; null = the program's ends_at.
  "ends_at" timestamp with time zone,
  "welcome_seen_at" timestamp with time zone,
  "tour_completed_at" timestamp with time zone,
  "announcements_seen_at" timestamp with time zone,
  "replies_seen_at" timestamp with time zone,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "ended_reason" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "beta_enrollments_status_values" CHECK ("status" IN ('active', 'suspended', 'completed', 'revoked')),
  CONSTRAINT "beta_enrollments_credits_non_negative" CHECK ("credits_granted" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "beta_enrollments_program_user_unique" ON "beta_enrollments" ("program_id", "user_id");
-- One live enrollment per user, so users.beta_credits always belongs to exactly one of them.
CREATE UNIQUE INDEX IF NOT EXISTS "beta_enrollments_one_live_per_user" ON "beta_enrollments" ("user_id") WHERE "status" IN ('active', 'suspended');
CREATE INDEX IF NOT EXISTS "beta_enrollments_program_status_idx" ON "beta_enrollments" ("program_id", "status");

CREATE TABLE IF NOT EXISTS "beta_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "program_id" uuid NOT NULL REFERENCES "beta_programs"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "title" text NOT NULL,
  "instructions" text NOT NULL DEFAULT '',
  "rule" jsonb NOT NULL,
  "required" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "beta_missions_program_idx" ON "beta_missions" ("program_id", "position");

CREATE TABLE IF NOT EXISTS "beta_mission_progress" (
  "enrollment_id" uuid NOT NULL REFERENCES "beta_enrollments"("id") ON DELETE CASCADE,
  "mission_id" uuid NOT NULL REFERENCES "beta_missions"("id") ON DELETE CASCADE,
  -- auto | tester | admin
  "source" text NOT NULL,
  "verified_by" uuid REFERENCES "users"("id"),
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("enrollment_id", "mission_id"),
  CONSTRAINT "beta_mission_progress_source_values" CHECK ("source" IN ('auto', 'tester', 'admin'))
);

CREATE TABLE IF NOT EXISTS "beta_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer GENERATED ALWAYS AS IDENTITY,
  "program_id" uuid NOT NULL REFERENCES "beta_programs"("id"),
  "enrollment_id" uuid NOT NULL REFERENCES "beta_enrollments"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "severity_reported" text NOT NULL DEFAULT 'medium',
  "severity" text,
  "status" text NOT NULL DEFAULT 'new',
  "render_id" uuid REFERENCES "renders"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "canvas_node_id" text,
  "annotations" jsonb,
  "diagnostics" jsonb,
  "attachment_key" text,
  "duplicate_of" uuid REFERENCES "beta_feedback"("id") ON DELETE SET NULL,
  "known_issue" boolean NOT NULL DEFAULT false,
  "known_issue_title" text,
  "assignee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "github_url" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "beta_feedback_kind_values" CHECK ("kind" IN ('bug', 'visual_quality', 'usability', 'suggestion', 'praise')),
  CONSTRAINT "beta_feedback_category_values" CHECK ("category" IN ('architecture_changed', 'materials_wrong', 'render_failed', 'render_stuck', 'edit_wrong', 'ui_problem', 'billing_credits', 'other')),
  CONSTRAINT "beta_feedback_severity_values" CHECK ("severity_reported" IN ('low', 'medium', 'high', 'critical') AND ("severity" IS NULL OR "severity" IN ('low', 'medium', 'high', 'critical'))),
  CONSTRAINT "beta_feedback_status_values" CHECK ("status" IN ('new', 'triaged', 'investigating', 'fix_in_progress', 'ready_to_verify', 'resolved', 'duplicate', 'expected', 'cannot_reproduce', 'declined')),
  CONSTRAINT "beta_feedback_title_length" CHECK (char_length("title") BETWEEN 1 AND 120),
  CONSTRAINT "beta_feedback_description_length" CHECK (char_length("description") <= 4000),
  -- Pins, boxes and simplified strokes are small; this is the backstop behind the API's validation.
  CONSTRAINT "beta_feedback_annotations_size" CHECK ("annotations" IS NULL OR pg_column_size("annotations") <= 16384),
  CONSTRAINT "beta_feedback_diagnostics_size" CHECK ("diagnostics" IS NULL OR pg_column_size("diagnostics") <= 16384)
);
CREATE INDEX IF NOT EXISTS "beta_feedback_program_status_idx" ON "beta_feedback" ("program_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "beta_feedback_user_idx" ON "beta_feedback" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "beta_feedback_render_idx" ON "beta_feedback" ("render_id") WHERE "render_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "beta_feedback_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feedback_id" uuid NOT NULL REFERENCES "beta_feedback"("id") ON DELETE CASCADE,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL DEFAULT '',
  -- tester | internal
  "visibility" text NOT NULL,
  -- comment | status_change | request_info
  "kind" text NOT NULL DEFAULT 'comment',
  "detail" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "beta_feedback_comments_visibility_values" CHECK ("visibility" IN ('tester', 'internal')),
  CONSTRAINT "beta_feedback_comments_kind_values" CHECK ("kind" IN ('comment', 'status_change', 'request_info')),
  CONSTRAINT "beta_feedback_comments_body_length" CHECK (char_length("body") <= 4000)
);
CREATE INDEX IF NOT EXISTS "beta_feedback_comments_feedback_idx" ON "beta_feedback_comments" ("feedback_id", "created_at");

CREATE TABLE IF NOT EXISTS "beta_announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "program_id" uuid NOT NULL REFERENCES "beta_programs"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  -- info | important
  "severity" text NOT NULL DEFAULT 'info',
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "beta_announcements_severity_values" CHECK ("severity" IN ('info', 'important')),
  CONSTRAINT "beta_announcements_body_length" CHECK (char_length("body") <= 2000)
);
CREATE INDEX IF NOT EXISTS "beta_announcements_program_idx" ON "beta_announcements" ("program_id", "published_at" DESC);

-- The beta bucket of credit_balance, mirroring plan_credits. Beta-funded charges take only from it.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "beta_credits" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_beta_debit" integer DEFAULT 0 NOT NULL;
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_beta_credits_non_negative" CHECK ("beta_credits" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Plan and beta credits together never exceed the balance, so an account-funded charge can't
-- reach into beta credits and a beta-funded one can't reach into the others.
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_plan_and_beta_within_balance" CHECK ("plan_credits" + "beta_credits" <= "credit_balance");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "beta_amount" integer DEFAULT 0 NOT NULL;
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "beta_enrollment_id" uuid REFERENCES "beta_enrollments"("id");
CREATE INDEX IF NOT EXISTS "credit_ledger_beta_enrollment_idx" ON "credit_ledger" ("beta_enrollment_id") WHERE "beta_enrollment_id" IS NOT NULL;

-- Jobs paid with beta credits, summed to enforce the program's budget.
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "beta_program_id" uuid REFERENCES "beta_programs"("id");
ALTER TABLE "segmentations" ADD COLUMN IF NOT EXISTS "beta_program_id" uuid REFERENCES "beta_programs"("id");
CREATE INDEX IF NOT EXISTS "renders_beta_program_idx" ON "renders" ("beta_program_id") WHERE "beta_program_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "segmentations_beta_program_idx" ON "segmentations" ("beta_program_id") WHERE "beta_program_id" IS NOT NULL;

-- A program's hold. The global cap ignores these rows: the same job's global hold already counts.
ALTER TABLE "budget_reservations" ADD COLUMN IF NOT EXISTS "beta_program_id" uuid;
