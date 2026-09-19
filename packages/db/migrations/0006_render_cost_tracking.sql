ALTER TABLE "renders" ADD COLUMN "model" text;
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "cost_micros" integer DEFAULT 0 NOT NULL;
