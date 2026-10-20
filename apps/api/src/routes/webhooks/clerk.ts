import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "@renvia/db";
import type { Env } from "../../index.js";
import { forgetSecurityLinks } from "../../lib/securitySignals.js";

export const clerkWebhook = new Hono<{ Bindings: Env }>();

/** Deliveries older (or newer) than this are refused, so a captured one can't be replayed later. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Svix's signature scheme, which Clerk webhooks use: HMAC-SHA256 over "id.timestamp.body" with
 * the base64 secret after "whsec_", compared against each "v1,<base64>" in svix-signature.
 */
export async function verifySvix(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string, now = Date.now()): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;
  const keyBytes = Buffer.from(secret.trim().replace(/^whsec_/, ""), "base64");
  if (keyBytes.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))).toString("base64");
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value || value.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ value.charCodeAt(index);
    return difference === 0;
  });
}

/**
 * Clerk's account events. On user.deleted the account is marked closed and its browser and
 * network links are deleted; its email history, credit ledger and projects stay, so a re-created
 * account on the same mailbox is still recognised. Repeats are harmless. Other events are
 * acknowledged and ignored.
 */
clerkWebhook.post("/", async (c) => {
  const secret = c.env.CLERK_WEBHOOK_SECRET?.trim();
  if (!secret) return c.json({ error: "Clerk webhook isn't configured" }, 503);
  const body = await c.req.text();
  const valid = await verifySvix(secret, { id: c.req.header("svix-id"), timestamp: c.req.header("svix-timestamp"), signature: c.req.header("svix-signature") }, body);
  if (!valid) return c.json({ error: "Invalid signature" }, 400);

  const event = JSON.parse(body) as { type?: string; data?: { id?: string } };
  if (event.type !== "user.deleted" || !event.data?.id) return c.json({ received: true });

  const db = createDb(c.env.DATABASE_URL);
  const [user] = await db
    .update(schema.users)
    .set({ closedAt: sql`coalesce(${schema.users.closedAt}, now())`, updatedAt: sql`now()` })
    .where(eq(schema.users.clerkId, event.data.id))
    .returning({ id: schema.users.id });
  if (user) await forgetSecurityLinks(db, user.id);
  return c.json({ received: true, closed: Boolean(user) });
});
