import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { countRequest, RATE_LIMITS } from "../src/lib/rateLimit.js";
import { reserveUpload } from "../src/lib/storage.js";
import root from "../src/index.js";
import { adminEnv } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { db, makeUser } from "./support/db.js";

// The caps that used to be read-then-write now hold under parallel requests, disabled accounts
// can't change anything, masks must be real PNGs, and expensive routes are rate limited.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

async function setup(plan: Partial<typeof schema.billingPlans.$inferInsert> = {}) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free", ...plan });
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock" });
  return makeUser({ clerkId: "customer", email: "customer@studio.co.ke", creditBalance: 10 });
}

describe("caps under parallel requests", () => {
  it("never lets the Polish daily cap be passed", async () => {
    const user = await setup();
    await db.insert(schema.promptPolishes).values(Array.from({ length: 29 }, () => ({ userId: user.id, kind: "render" as const, engine: "rules" as const, status: "succeeded" as const })));

    const responses = await Promise.all(Array.from({ length: 5 }, () => callApi("customer", "POST", "/renders/polish-prompt", { prompt: "modern house with large windows", kind: "render" })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429, 429, 429, 429]);
    expect(await db.select().from(schema.promptPolishes).where(eq(schema.promptPolishes.userId, user.id))).toHaveLength(30);
  });

  it("never creates more projects than the plan allows", async () => {
    await setup({ maxProjects: 2 });
    const responses = await Promise.all(Array.from({ length: 5 }, (_, index) => callApi("customer", "POST", "/projects", { name: `Project ${index}` })));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(2);
    expect(await db.select().from(schema.projects)).toHaveLength(2);
  });

  it("never reserves more upload storage than the account's allowance", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      reserveUpload(db, { key: `elevations/customer/${index}.jpg`, bytes: 300, contentType: "image/jpeg", clerkId: "customer", perUserBytes: 1_000, capMb: 9_000 })));
    expect(results.filter((result) => result.result === "reserved")).toHaveLength(3);
    expect(results.filter((result) => result.result === "quota")).toHaveLength(2);
  });
});

describe("disabled accounts and masks", () => {
  it("refuses changes from a disabled account but still lets it read", async () => {
    const user = await setup();
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, user.id));

    const created = await callApi("customer", "POST", "/projects", { name: "Nope" });
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({ code: "account_disabled" });
    expect((await callApi("customer", "GET", "/projects")).status).toBe(200);
  });

  it("refuses a selection mask that isn't a real PNG", async () => {
    await setup();
    const response = await root.request("http://localhost/api/uploads", {
      method: "POST",
      headers: { Authorization: "Bearer customer", "Content-Type": "image/png", "X-Upload-Kind": "mask" },
      body: new TextEncoder().encode("this is not an image"),
    }, adminEnv);
    expect(response.status).toBe(400);
    expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
  });
});

describe("rate limits", () => {
  it("refuses requests past the minute's limit, with Retry-After", async () => {
    await setup();
    const now = new Date();
    for (let index = 0; index < RATE_LIMITS.project; index += 1) await countRequest(db, "project", "customer", now);

    const refused = await callApi("customer", "POST", "/projects", { name: "One too many" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "rate_limited" });
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Other people, and other kinds of request, aren't affected.
    expect((await countRequest(db, "project", "someone-else", now)).hits).toBe(1);
    expect((await countRequest(db, "render", "customer", now)).hits).toBe(1);
  });
});
