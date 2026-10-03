-- The welcome grant remains 25 credits, but a new Free account cannot consume it all
-- in one burst or fill the workspace with unlimited throwaway projects.
ALTER TABLE "app_settings" ALTER COLUMN "daily_render_limit" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "max_projects_per_user" SET DEFAULT 2;--> statement-breakpoint

-- Preserve explicit operator choices. Only install safe Free-tier values where the old
-- installation had an unlimited default.
UPDATE "app_settings"
SET
  "daily_render_limit" = COALESCE("daily_render_limit", 5),
  "max_projects_per_user" = COALESCE("max_projects_per_user", 2)
WHERE "id" = 1;
