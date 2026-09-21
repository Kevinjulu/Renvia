ALTER TABLE "renders" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "hidden_at" timestamp with time zone;
