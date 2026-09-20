import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { createDb, schema } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrCreateUser, syncUser } from "../lib/users.js";
import { getSettings } from "../lib/settings.js";

export const me = new Hono<AppContext>();

me.use("*", requireAuth);

me.get("/", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  // Called once per studio load, so it also refreshes the stored email from Clerk.
  const [user, settings] = await Promise.all([syncUser(c.env, db, clerkId), getSettings(db)]);

  return c.json({
    ...user,
    creditsPerImage: settings.creditsPerImage,
    creditsPerSelection: settings.creditsPerSelection,
    maintenanceRenders: settings.maintenanceRenders,
    maintenanceSegments: settings.maintenanceSegments,
    maintenanceMessage: settings.maintenanceMessage,
  });
});

/** Balance plus the most recent ledger entries, for the studio's credits page. */
me.get("/credits", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(c.env, db, clerkId);
  const entries = await db
    .select({
      id: schema.creditLedger.id,
      amount: schema.creditLedger.amount,
      reason: schema.creditLedger.reason,
      renderId: schema.creditLedger.renderId,
      note: schema.creditLedger.note,
      createdAt: schema.creditLedger.createdAt,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, user.id))
    .orderBy(desc(schema.creditLedger.createdAt))
    .limit(50);

  // Dates serialize to the ISO strings MeCreditsResponse declares.
  return c.json({ creditBalance: user.creditBalance, entries });
});
