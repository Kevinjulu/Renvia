ALTER TABLE "renders" ADD COLUMN "resolution" text DEFAULT '1K' NOT NULL;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "style" text DEFAULT 'Photorealistic' NOT NULL;