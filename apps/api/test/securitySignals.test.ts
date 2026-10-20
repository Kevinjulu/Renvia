import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { networkPrefix, requestSignals } from "../src/lib/securitySignals.js";
import root from "../src/index.js";
import { adminEnv } from "./support/admin.js";
import { db } from "./support/db.js";

// Browser and network evidence for the free-credit checks, and the human-check claim. Clerk and
// Cloudflare are stubbed; nothing leaves the machine.
const clerk = vi.hoisted(() => ({ users: new Map<string, string>() }));
vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(async (token: string) => ({ sub: token })),
  createClerkClient: vi.fn(() => ({
    users: {
      getUser: vi.fn(async (id: string) => {
        const address = { emailAddress: clerk.users.get(id)!, verification: { status: "verified" } };
        return { primaryEmailAddress: address, emailAddresses: [address] };
      }),
    },
  })),
}));

const env = { ...adminEnv, SECURITY_HASH_KEY: "k".repeat(40), TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
const BROWSER = "browser-id-0123456789";

async function setup(settings: Partial<typeof schema.appSettings.$inferInsert>) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free", monthlyCredits: 20 });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock", ...settings });
}

async function me(clerkId: string, email: string, browser: string | null = BROWSER, ip = "41.90.12.34") {
  clerk.users.set(clerkId, email);
  const response = await root.request("http://localhost/api/me", { headers: { Authorization: `Bearer ${clerkId}`, ...(browser ? { "X-Client-Id": browser } : {}), "x-real-ip": ip, "x-forwarded-for": "6.6.6.6" } }, env);
  return (await response.json()) as { id: string; creditBalance: number; freeCredits: { status: string; held: boolean; canClaim: boolean } };
}

afterEach(() => vi.unstubAllGlobals());

describe("signals", () => {
  it("keeps only the network prefix, from the platform's header", () => {
    expect(networkPrefix("41.90.12.34")).toBe("41.90.12.0/24");
    expect(networkPrefix("::ffff:41.90.12.34")).toBe("41.90.12.0/24");
    expect(networkPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(networkPrefix("not-an-ip")).toBeNull();
    const headers: Record<string, string> = { "x-real-ip": "41.90.12.34", "x-forwarded-for": "6.6.6.6", "x-client-id": "short" };
    expect(requestSignals(env, (name) => headers[name.toLowerCase()])).toEqual({ clientId: null, networkPrefix: "41.90.12.0/24" });
  });

  it("records nothing while switched off, and only hashes when on", async () => {
    await setup({ freeAllowanceMode: "observe" });
    await me("off", "off@studio.co.ke");
    expect(await db.select().from(schema.securityLinks)).toHaveLength(0);

    await db.update(schema.appSettings).set({ securitySignalsEnabled: true });
    await me("on", "on@studio.co.ke");
    const links = await db.select().from(schema.securityLinks);
    expect(links.map((link) => link.kind).sort()).toEqual(["device", "network"]);
    expect(JSON.stringify(links)).not.toContain(BROWSER);
    expect(JSON.stringify(links)).not.toContain("41.90");
  });
});

describe("the same browser across accounts", () => {
  it("holds a third account from a browser two others already had credits on, and lets it clear the hold", async () => {
    await setup({ freeAllowanceMode: "enforce", securitySignalsEnabled: true });
    expect((await me("one", "one@studio.co.ke")).creditBalance).toBe(20);
    expect((await me("two", "two@studio.co.ke")).creditBalance).toBe(20);
    const third = await me("three", "three@studio.co.ke");
    expect(third).toMatchObject({ creditBalance: 0, freeCredits: { status: "verification_required", held: true, canClaim: true } });
    // A different browser on a different network is unaffected.
    expect((await me("other", "other@studio.co.ke", "another-browser-98765", "102.1.1.1")).creditBalance).toBe(20);

    // A failed check releases nothing.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] })));
    const claim = (token: string) => root.request("http://localhost/api/me/free-credits/claim", { method: "POST", headers: { Authorization: "Bearer three", "content-type": "application/json", "x-real-ip": "41.90.12.34" }, body: JSON.stringify({ turnstileToken: token }) }, env);
    expect((await claim("bad")).status).toBe(400);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, action: "claim_free_credits" })));
    const passed = await claim("good");
    expect(passed.status).toBe(200);
    expect(await passed.json()).toMatchObject({ status: "approved", granted: true, creditBalance: 20 });
    const kinds = (await db.select().from(schema.freeAllowanceAssessments).where(eq(schema.freeAllowanceAssessments.userId, third.id))).map((row) => row.kind).sort();
    expect(kinds).toEqual(["claim", "claim", "signup"]);
  });
});
