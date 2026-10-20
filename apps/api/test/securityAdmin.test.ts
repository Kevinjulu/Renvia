import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { verifySvix } from "../src/routes/webhooks/clerk.js";
import root from "../src/index.js";
import { adminEnv, callAdmin } from "./support/admin.js";
import { db, makeUser } from "./support/db.js";

// The Security page's read endpoints and the Clerk deletion webhook. Nothing calls Clerk.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const SECRET = `whsec_${Buffer.from("clerk-webhook-test-secret-0123456789").toString("base64")}`;
const env = { ...adminEnv, CLERK_WEBHOOK_SECRET: SECRET };

async function sign(body: string, id = "msg_1", timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(SECRET.slice(6), "base64"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))).toString("base64");
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` };
}

describe("the Clerk deletion webhook", () => {
  it("accepts only a fresh, correctly signed delivery", async () => {
    const body = '{"type":"user.deleted"}';
    const headers = await sign(body);
    const check = (h: Record<string, string>, b = body) => verifySvix(SECRET, { id: h["svix-id"], timestamp: h["svix-timestamp"], signature: h["svix-signature"] }, b);
    expect(await check(headers)).toBe(true);
    expect(await check(headers, '{"type":"user.created"}')).toBe(false);
    expect(await check(await sign(body, "msg_1", Math.floor(Date.now() / 1000) - 600))).toBe(false);
  });

  it("closes the account and forgets its browser and network links, keeping its history", async () => {
    await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free" });
    const user = await makeUser({ clerkId: "user_gone", email: "gone@studio.co.ke", emailNormalized: "gone@studio.co.ke" });
    await db.insert(schema.securityLinks).values([{ kind: "device", hash: "d1", userId: user.id }, { kind: "network", hash: "n1", userId: user.id }]);
    const body = JSON.stringify({ type: "user.deleted", data: { id: "user_gone", deleted: true } });
    const post = async (headers: Record<string, string>) => root.request("http://localhost/api/webhooks/clerk", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }, env);

    expect((await post({ ...(await sign(body)), "svix-signature": "v1,forged" })).status).toBe(400);
    expect(await db.select().from(schema.securityLinks)).toHaveLength(2);

    const response = await post(await sign(body));
    expect(await response.json()).toEqual({ received: true, closed: true });
    expect(await db.select().from(schema.securityLinks)).toHaveLength(0);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row!.closedAt).not.toBeNull();
    expect(row!.emailNormalized).toBe("gone@studio.co.ke");
  });
});

describe("the Security page", () => {
  it("lists held accounts, masking emails for analysts, and stays closed to customers", async () => {
    await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free" });
    await db.insert(schema.appSettings).values({ id: 1, freeAllowanceMode: "enforce" });
    const held = await makeUser({ email: "architect@gmail.com" });
    await db.update(schema.userEntitlements).set({ freeAllowanceStatus: "review_required", freeAllowanceReason: "Same mailbox", freeAllowanceDecidedAt: new Date() }).where(eq(schema.userEntitlements.userId, held.id));
    await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
    await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
    await makeUser({ clerkId: "customer", email: "customer@renvia.test" });

    const queue = await (await callAdmin("analyst", "GET", "/security/queue?status=review_required")).json();
    expect(queue).toMatchObject({ total: 1, items: [{ userId: held.id, email: "ar•••@gmail.com", reason: "Same mailbox", freePlan: true }] });
    expect((await (await callAdmin("admin", "GET", "/security/queue")).json()).items[0].email).toBe("architect@gmail.com");

    const overview = await (await callAdmin("admin", "GET", "/security/overview")).json();
    expect(overview).toMatchObject({ mode: "enforce", heldFreeAccounts: 1, statuses: { review_required: 1 } });
    expect(overview.daily).toHaveLength(14);

    expect((await callAdmin("customer", "GET", "/security/overview")).status).toBe(403);
  });
});
