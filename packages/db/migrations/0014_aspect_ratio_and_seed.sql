ALTER TABLE "renders" RENAME COLUMN "resolution" TO "aspect_ratio";--> statement-breakpoint
ALTER TABLE "renders" ALTER COLUMN "aspect_ratio" SET DEFAULT 'auto';--> statement-breakpoint
UPDATE "renders" SET "aspect_ratio" = 'auto' WHERE "aspect_ratio" NOT IN ('auto', '1:1', '16:9', '4:3', '3:4', '9:16');--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "seed" integer;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_aspect_ratio_values" CHECK ("aspect_ratio" IN ('auto', '1:1', '16:9', '4:3', '3:4', '9:16'));
