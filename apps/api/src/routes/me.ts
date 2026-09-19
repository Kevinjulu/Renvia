import { Hono } from "hono";
import { createDb } from "@renvia/db";
import type { AppContext } from "../index.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../lib/users.js";

export const me = new Hono<AppContext>();

me.use("*", requireAuth);

me.get("/", async (c) => {
  const { clerkId } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  // Called once per studio load, so it also refreshes the stored email from Clerk.
  const user = await syncUser(c.env, db, clerkId);

  return c.json(user);
});
