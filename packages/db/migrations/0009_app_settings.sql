CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"signup_bonus_credits" integer DEFAULT 25 NOT NULL,
	"daily_render_limit" integer,
	"fal_mode" text,
	"fal_budget_usd" numeric(10, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "app_settings_single_row" CHECK ("id" = 1),
	CONSTRAINT "app_settings_signup_bonus_range" CHECK ("signup_bonus_credits" BETWEEN 0 AND 1000),
	CONSTRAINT "app_settings_daily_limit_range" CHECK ("daily_render_limit" IS NULL OR "daily_render_limit" BETWEEN 1 AND 10000),
	CONSTRAINT "app_settings_fal_mode_values" CHECK ("fal_mode" IS NULL OR "fal_mode" IN ('mock', 'dev', 'prod')),
	CONSTRAINT "app_settings_budget_range" CHECK ("fal_budget_usd" IS NULL OR "fal_budget_usd" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "app_settings" ("id") VALUES (1);
