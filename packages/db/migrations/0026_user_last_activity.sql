ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;
CREATE INDEX "users_last_active_idx" ON "users" ("last_active_at");
-- Existing product activity is a truthful baseline until each person next authenticates.
UPDATE "users" u
SET "last_active_at" = activity.last_active_at
FROM (
  SELECT p."owner_id" AS user_id, max(r."created_at") AS last_active_at
  FROM "projects" p
  JOIN "renders" r ON r."project_id" = p."id"
  GROUP BY p."owner_id"
) activity
WHERE u."id" = activity.user_id;
