import { Hono } from "hono";
import { createDb } from "@renvia/db";
import type { AppContext } from "../index";
import { requireAuth } from "../middleware/auth";
import { getOrCreateUser } from "../lib/users";

export const me = new Hono<AppContext>();

me.use("*", requireAuth);

me.get("/", async (c) => {
  const { clerkId, email } = c.get("auth");
  const db = createDb(c.env.DATABASE_URL);

  const user = await getOrCreateUser(db, clerkId, email);

  return c.json(user);
});
