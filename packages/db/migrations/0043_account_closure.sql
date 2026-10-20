-- When Clerk deleted the account (the user.deleted webhook). The row, its email history and its
-- credit ledger stay, so a re-created account on the same mailbox is still recognised by the
-- free-credit checks; its browser and network links are deleted at that moment. Additive.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
