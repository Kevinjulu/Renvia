-- Studio Control: versioned feature rules, scheduled maintenance windows, and the log that
-- observe-mode rules write instead of refusing.
--
-- Additive only. With no published revision the API creates version 1 from
-- defaultStudioConfig() (every feature on for every plan), so behaviour is unchanged until an
-- operator publishes something else.

-- Each published Studio configuration. Rows are never updated: a change or a rollback is a new
-- version, and the checksum lets anyone confirm a stored snapshot hasn't changed.
CREATE TABLE IF NOT EXISTS "studio_config_revisions" (
  "version" integer PRIMARY KEY NOT NULL,
  "config" jsonb NOT NULL,
  "checksum" text NOT NULL,
  "reason" text NOT NULL,
  "published_by" uuid REFERENCES "users"("id"),
  -- Set when this revision restored an earlier one.
  "restored_from" integer,
  -- Set when a second admin approved the publish.
  "approval_id" uuid REFERENCES "approval_requests"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "studio_config_revisions_version_positive" CHECK ("version" > 0)
);

-- Requests an observe-mode rule would have refused. Bounded by the rules an operator is trying.
CREATE TABLE IF NOT EXISTS "studio_feature_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feature_key" text NOT NULL,
  "reason" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "config_version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "studio_feature_observations_feature_created_idx" ON "studio_feature_observations" ("feature_key", "created_at");

-- Scheduled maintenance. Active while now() is inside [starts_at, ends_at) and not cancelled;
-- every request checks the times itself, so nothing has to switch a window on or off.
CREATE TABLE IF NOT EXISTS "maintenance_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "message" text,
  "reason" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "approval_id" uuid REFERENCES "approval_requests"("id"),
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_windows_scope_values" CHECK ("scope" IN ('all', 'renders', 'selections')),
  CONSTRAINT "maintenance_windows_order" CHECK ("ends_at" > "starts_at")
);
CREATE INDEX IF NOT EXISTS "maintenance_windows_ends_idx" ON "maintenance_windows" ("ends_at");

-- The Studio configuration version a job was checked against.
ALTER TABLE "renders" ADD COLUMN IF NOT EXISTS "config_version" integer;
ALTER TABLE "segmentations" ADD COLUMN IF NOT EXISTS "config_version" integer;

-- Off by default so a single admin isn't locked out of Studio Control.
ALTER TABLE "governance_settings" ADD COLUMN IF NOT EXISTS "studio_change_approval_threshold" integer DEFAULT 0 NOT NULL;
