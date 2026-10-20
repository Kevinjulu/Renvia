import { createMiddleware } from "hono/factory";
import { createDb } from "@renvia/db";
import type { AppContext } from "../index.js";
import { refuseDisabled } from "../lib/limits.js";
import { getSettings } from "../lib/settings.js";
import { getOrCreateUser } from "../lib/users.js";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuses changes from a disabled account (403 account_disabled) while still letting it read
 * its own data. Rendering already checks this itself; this covers uploads, projects, references,
 * canvas and checkouts. Needs requireAuth first.
 */
export const requireActiveAccount = createMiddleware<AppContext>(async (c, next) => {
  if (!WRITES.has(c.req.method)) return next();
  const db = createDb(c.env.DATABASE_URL);
  const user = await getOrCreateUser(c.env, db, c.get("auth").clerkId);
  if (user.disabled) {
    const refusal = refuseDisabled(await getSettings(db));
    return c.json(refusal, refusal.status);
  }
  await next();
});
