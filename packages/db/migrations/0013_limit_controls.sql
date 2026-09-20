ALTER TABLE "users" ADD COLUMN "daily_render_limit_override" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_segment_limit_override" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_render_limit_override" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_segment_limit_override" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limits_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_daily_render_limit_override_range" CHECK ("daily_render_limit_override" IS NULL OR "daily_render_limit_override" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_daily_segment_limit_override_range" CHECK ("daily_segment_limit_override" IS NULL OR "daily_segment_limit_override" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_monthly_render_limit_override_range" CHECK ("monthly_render_limit_override" IS NULL OR "monthly_render_limit_override" BETWEEN 0 AND 100000);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_monthly_segment_limit_override_range" CHECK ("monthly_segment_limit_override" IS NULL OR "monthly_segment_limit_override" BETWEEN 0 AND 100000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "monthly_render_limit" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "monthly_segment_limit" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_credit_balance" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_projects_per_user" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_upload_mb" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_reference_images" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_prompt_chars" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_selection_prompt_chars" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "low_credit_threshold" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "message_insufficient_credits" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "message_daily_limit" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "message_monthly_limit" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "message_budget_exhausted" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "message_account_disabled" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_monthly_limit_range" CHECK ("monthly_render_limit" IS NULL OR "monthly_render_limit" BETWEEN 1 AND 100000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_monthly_segment_limit_range" CHECK ("monthly_segment_limit" IS NULL OR "monthly_segment_limit" BETWEEN 1 AND 100000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_max_credit_balance_range" CHECK ("max_credit_balance" IS NULL OR "max_credit_balance" BETWEEN 1 AND 1000000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_max_projects_range" CHECK ("max_projects_per_user" IS NULL OR "max_projects_per_user" BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_max_upload_mb_range" CHECK ("max_upload_mb" BETWEEN 1 AND 100);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_max_reference_images_range" CHECK ("max_reference_images" BETWEEN 0 AND 16);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_max_prompt_chars_range" CHECK ("max_prompt_chars" BETWEEN 50 AND 8000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_max_selection_prompt_chars_range" CHECK ("max_selection_prompt_chars" BETWEEN 10 AND 1000);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_low_credit_threshold_range" CHECK ("low_credit_threshold" BETWEEN 0 AND 1000);
