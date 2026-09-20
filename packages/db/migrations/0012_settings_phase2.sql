ALTER TABLE "app_settings" ADD COLUMN "daily_segment_limit" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "credits_per_image" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "credits_per_selection" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "maintenance_renders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "maintenance_segments" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "maintenance_message" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "budget_warning_percent" integer DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "budget_critical_percent" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "stuck_timeout_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_daily_segment_limit_range" CHECK ("daily_segment_limit" IS NULL OR "daily_segment_limit" BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_credits_per_image_range" CHECK ("credits_per_image" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_credits_per_selection_range" CHECK ("credits_per_selection" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_budget_warning_range" CHECK ("budget_warning_percent" BETWEEN 1 AND 99);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_budget_critical_range" CHECK ("budget_critical_percent" BETWEEN 2 AND 100);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_budget_thresholds_order" CHECK ("budget_critical_percent" > "budget_warning_percent");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_stuck_timeout_range" CHECK ("stuck_timeout_minutes" BETWEEN 1 AND 1440);
