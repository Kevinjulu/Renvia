-- Shorter prompts render and edit more reliably, so new installs start at 1000 characters.
-- Only the column default changes; the live value is whatever admins set in Settings.
ALTER TABLE "app_settings" ALTER COLUMN "max_prompt_chars" SET DEFAULT 1000;
