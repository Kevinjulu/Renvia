-- A per-account allowance for uploaded images (sources, references, selection masks), so one
-- account can't fill the shared R2 cap and block uploads and renders for everyone else.
-- Megabytes of 10^6 bytes, like storage_cap_mb. Additive only.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "storage_per_user_mb" integer DEFAULT 500 NOT NULL;
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_storage_per_user_range" CHECK ("storage_per_user_mb" BETWEEN 10 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
