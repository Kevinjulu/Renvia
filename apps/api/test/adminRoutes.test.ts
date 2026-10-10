import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settlePaypalCapture } from "../src/lib/paypalSettlement.js";
import { ago, callAdmin, DAY, MISSING_ID, ROLES, root } from "./support/admin.js";
import { db, makeCreditPack, makePaypalCheckout, makeProject, makeRender, makeSegmentation, makeUser } from "./support/db.js";

// Characterization tests for /api/admin/*. They pin the route table, the permission each role
// gets on every endpoint, and the shape of every read response, so the admin router can be
// reorganised without silently changing behaviour.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const call = callAdmin;

/** Replaces values that legitimately differ between runs (ids, timestamps, signatures). */
function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<timestamp>")
      .replace(/\d{4}-\d{2}-\d{2}/g, "<day>");
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}

async function seed() {
  const [starter] = await db
    .insert(schema.billingPlans)
    .values({ slug: "starter", name: "Starter", description: "Starter plan" })
    .returning();
  expect(starter).toBeDefined();

  const staff = {} as Record<(typeof ROLES)[number], Awaited<ReturnType<typeof makeUser>>>;
  for (const role of ROLES) {
    staff[role] = await makeUser({ clerkId: role, email: `${role}@renvia.test`, role, creditBalance: 10 });
  }
  const customer = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 40, lastActiveAt: ago(60_000) });
  const other = await makeUser({ clerkId: "other", email: "other@example.test", creditBalance: 0, disabled: true });

  const project = await makeProject(customer.id);
  const otherProject = await makeProject(other.id);
  const succeeded = await makeRender(project.id, {
    status: "succeeded", model: "mock", costMicros: 40_000, creditsCharged: 1, prompt: "modern house",
    resultImageUrl: "https://example.test/result.png", createdAt: ago(2 * DAY), updatedAt: ago(2 * DAY),
  });
  // A second successful render keeps the customers' render counts distinct, so ranked lists have no ties.
  await makeRender(project.id, {
    status: "succeeded", model: "mock", costMicros: 30_000, creditsCharged: 1, prompt: "second render",
    resultImageUrl: "https://example.test/result-2.png", createdAt: ago(2.5 * DAY), updatedAt: ago(2.5 * DAY),
  });
  await makeRender(project.id, {
    status: "failed", model: "mock", costMicros: 40_000, creditsCharged: 1, prompt: "failed one",
    errorMessage: "model error", createdAt: ago(3 * DAY), updatedAt: ago(3 * DAY),
  });
  await makeRender(otherProject.id, {
    status: "processing", model: "mock", costMicros: 20_000, creditsCharged: 1, prompt: "stuck one",
    createdAt: ago(DAY), updatedAt: ago(DAY),
  });
  const segmentation = await makeSegmentation(customer.id, {
    status: "succeeded", objectCount: 2, costMicros: 5_000, creditsCharged: 1, createdAt: ago(4 * DAY),
  });

  await db.insert(schema.creditLedger).values([
    { userId: customer.id, amount: 25, reason: "signup_bonus", createdAt: ago(10 * DAY) },
    { userId: customer.id, amount: -1, reason: "render", renderId: succeeded.id, createdAt: ago(2 * DAY) },
    { userId: customer.id, amount: -1, reason: "segment", segmentationId: segmentation.id, createdAt: ago(4 * DAY) },
    { userId: customer.id, amount: 5, reason: "admin_grant", note: "goodwill", actorId: staff.admin.id, createdAt: ago(5 * DAY) },
  ]);

  const pack = await makeCreditPack({ credits: 50, priceCents: 1000 });
  const checkout = await makePaypalCheckout(customer.id, pack.id);
  await settlePaypalCapture(db, {
    eventId: "WH-SEED", captureId: "CAPTURE-SEED", orderId: checkout.providerCheckoutId!, amountCents: 1000, currency: "USD",
  });
  await db.insert(schema.billingWebhookEvents).values({
    provider: "paypal", providerEventId: "WH-FAILED", eventType: "PAYMENT.CAPTURE.COMPLETED", payload: { id: "WH-FAILED" },
    failedAt: ago(DAY), failureMessage: "No Renvia PayPal checkout matches this order", verificationStatus: "verified", attempts: 1,
  });

  await db.insert(schema.adminEvents).values([
    { actorId: staff.admin.id, action: "credits.adjust", targetType: "user", targetId: customer.id, summary: "Granted 5 credits", detail: { amount: 5 }, createdAt: ago(5 * DAY) },
    { actorId: staff.admin.id, action: "user.update", targetType: "user", targetId: other.id, summary: "Disabled other@example.test", createdAt: ago(DAY) },
  ]);

  return { staff, customer, other, project, succeeded, segmentation };
}

type Seeded = Awaited<ReturnType<typeof seed>>;
let seeded: Seeded;

beforeEach(async () => {
  seeded = await seed();
});

/** Every admin route, in registration order: reorganising files must not reorder or drop any. */
describe("admin route table", () => {
  it("registers the same routes in the same order", () => {
    const routes = root.routes
      .filter((r) => r.path.startsWith("/api/admin"))
      .map((r) => `${r.method} ${r.path.replace("/api/admin", "") || "/"}`);
    expect(routes).toMatchSnapshot();
  });
});

describe("admin authentication", () => {
  it("rejects a request with no token", async () => {
    expect((await call(null, "GET", "/overview")).status).toBe(401);
  });

  it("rejects a signed-in user who is not staff", async () => {
    expect((await call("customer", "GET", "/overview")).status).toBe(403);
  });

  it("rejects disabled staff", async () => {
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.clerkId, "admin"));
    expect((await call("admin", "GET", "/overview")).status).toBe(403);
  });
});

function readEndpoints(s: Seeded): [string, string][] {
  return [
    ["overview", "/overview"],
    ["users", "/users"],
    ["users search", "/users?search=customer"],
    ["user detail", `/users/${s.customer.id}`],
    ["governance", "/governance"],
    ["renders", "/renders"],
    ["renders failed", "/renders?status=failed"],
    ["render detail", `/renders/${s.succeeded.id}`],
    ["settings", "/settings"],
    ["projects", "/projects"],
    ["project detail", `/projects/${s.project.id}`],
    ["credits", "/credits"],
    ["billing", "/billing"],
    ["financials", "/financials"],
    ["operations queue", "/operations/queue"],
    ["segmentations", "/segmentations"],
    ["segmentation detail", `/segmentations/${s.segmentation.id}`],
    ["incidents", "/incidents"],
    ["audit", "/audit"],
    ["audit export (missing)", `/audit/exports/${MISSING_ID}`],
  ];
}

/** Writes aimed at ids that do not exist with an empty body: they never change data, but a
 * denied role must be stopped (403) before validation or lookup (400/404). */
function writeProbes(): [string, string, string, unknown][] {
  return [
    ["bulk credits", "POST", "/users/bulk-credits", {}],
    ["governance update", "PUT", "/governance", {}],
    ["approve", "POST", `/approvals/${MISSING_ID}/approve`, {}],
    ["reject", "POST", `/approvals/${MISSING_ID}/reject`, {}],
    ["execute", "POST", `/approvals/${MISSING_ID}/execute`, {}],
    ["note", "POST", `/users/${MISSING_ID}/notes`, {}],
    ["tag", "POST", `/users/${MISSING_ID}/tags`, {}],
    ["revoke sessions", "POST", `/users/${MISSING_ID}/revoke-sessions`, {}],
    ["grant credits", "POST", `/users/${MISSING_ID}/credits`, {}],
    ["update user", "PATCH", `/users/${MISSING_ID}`, {}],
    ["refresh render", "POST", `/renders/${MISSING_ID}/refresh`, {}],
    ["cancel render", "POST", `/renders/${MISSING_ID}/cancel`, {}],
    ["update settings", "PUT", "/settings", { signupBonusCredits: -1 }],
    ["refund payment", "POST", `/billing/payments/${MISSING_ID}/refund`, {}],
    ["replay webhook", "POST", `/billing/webhooks/${MISSING_ID}/replay`, {}],
    ["recover segmentation", "POST", `/segmentations/${MISSING_ID}/recover`, {}],
    ["assign incident", "POST", `/incidents/${MISSING_ID}/assign`, {}],
    ["acknowledge incident", "POST", `/incidents/${MISSING_ID}/acknowledge`, {}],
    ["incident severity", "POST", `/incidents/${MISSING_ID}/severity`, {}],
    ["resolve incident", "POST", `/incidents/${MISSING_ID}/resolve`, {}],
    ["notify incident", "POST", `/incidents/${MISSING_ID}/notify`, {}],
    ["create audit export", "POST", "/audit/exports", { range: "nonsense" }],
  ];
}

describe("admin permission matrix", () => {
  it("grants each role the same read access as before", async () => {
    const matrix: Record<string, Record<string, number>> = {};
    for (const [name, path] of readEndpoints(seeded)) {
      matrix[name] = {};
      for (const role of ROLES) matrix[name]![role] = (await call(role, "GET", path)).status;
    }
    expect(matrix).toMatchSnapshot();
  });

  it("grants each role the same write access as before", async () => {
    const matrix: Record<string, Record<string, string>> = {};
    for (const [name, method, path, body] of writeProbes()) {
      matrix[name] = {};
      for (const role of ROLES) {
        const response = await call(role, method, path, body);
        const json = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
        matrix[name]![role] = `${response.status}${json?.error ? ` ${json.error}` : ""}`;
      }
    }
    expect(matrix).toMatchSnapshot();
  });
});

describe("admin read responses", () => {
  it("returns the same data for every read endpoint", async () => {
    const bodies: Record<string, unknown> = {};
    for (const [name, path] of readEndpoints(seeded)) {
      const response = await call("admin", "GET", path);
      bodies[name] = { status: response.status, body: normalize(await response.json().catch(() => null)) };
    }
    expect(bodies).toMatchSnapshot();
  });
});

describe("admin list ordering", () => {
  it("ranks top users by renders, then spend, then email", async () => {
    // Three more one-render customers: spend orders them, and email breaks the amy/zed tie.
    for (const [email, cost] of [["zed@example.test", 90_000], ["amy@example.test", 90_000], ["bob@example.test", 10_000]] as const) {
      const user = await makeUser({ email });
      const project = await makeProject(user.id);
      await makeRender(project.id, { status: "succeeded", model: "mock", costMicros: cost, createdAt: ago(DAY), updatedAt: ago(DAY) });
    }

    const first = (await (await call("admin", "GET", "/overview")).json()) as { topUsers: { email: string }[] };
    const emails = first.topUsers.map((u) => u.email);

    expect(emails).toEqual([
      "customer@example.test", // 2 renders
      "amy@example.test", // 1 render, $0.09: ties with zed, email breaks it
      "zed@example.test",
      "other@example.test", // 1 render, $0.02
      "bob@example.test", // 1 render, $0.01
    ]);
    for (let i = 0; i < 3; i++) {
      const again = (await (await call("admin", "GET", "/overview")).json()) as { topUsers: { email: string }[] };
      expect(again.topUsers.map((u) => u.email)).toEqual(emails);
    }
  });

  it("lists customers with equal revenue alphabetically by email", async () => {
    const body = (await (await call("admin", "GET", "/financials")).json()) as {
      margins: { byCustomer: { email: string; revenueUsd: number }[] };
    };
    const rows = body.margins.byCustomer;

    // The one paying customer leads; everyone else has $0 and follows in email order.
    expect(rows[0]).toMatchObject({ email: "customer@example.test", revenueUsd: 10 });
    const rest = rows.slice(1).map((r) => r.email);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(new Set(rows.slice(1).map((r) => r.revenueUsd))).toEqual(new Set([0]));
  });
});

describe("admin financial figures", () => {
  type Financials = {
    revenue: { conversionRate: number };
    margins: { byPlan: object[]; byPack: object[]; byCustomer: { email: string; revenueUsd: number; estimatedCostUsd: number; marginUsd: number }[] };
  };
  const financials = async () => (await (await call("admin", "GET", "/financials")).json()) as Financials;

  it("reports product revenue without an invented cost or margin", async () => {
    const body = await financials();
    // The seeded pack purchase counts once, under its pack, and not again as an unattributed plan.
    expect(body.margins.byPack).toEqual([{ label: expect.any(String), revenueUsd: 10 }]);
    expect(body.margins.byPack[0]).not.toMatchObject({ label: "Unattributed" });
    expect(body.margins.byPlan).toEqual([]);
  });

  it("measures customer revenue over the same 30 days as cost", async () => {
    // The seeded $10 capture moves outside the window; its customer still has recent render cost.
    await db.update(schema.billingPayments).set({ createdAt: ago(40 * DAY) });
    const rows = (await financials()).margins.byCustomer;

    expect(rows.find((row) => row.email === "customer@example.test")).toEqual(
      expect.objectContaining({ revenueUsd: 0, estimatedCostUsd: 0.07, marginUsd: -0.07 }),
    );
    // Customers with neither revenue nor cost in the window are left out.
    expect(rows.map((row) => row.email).sort()).toEqual(["customer@example.test", "other@example.test"]);
  });

  it("computes conversion from checkouts started, not payments recorded", async () => {
    expect((await financials()).revenue.conversionRate).toBe(1);
    const pack = await makeCreditPack({ credits: 10, priceCents: 500 });
    await makePaypalCheckout(seeded.customer.id, pack.id, { status: "created" });
    expect((await financials()).revenue.conversionRate).toBe(0.5);
  });

  it("counts webhook health over every event, not only the listed ones", async () => {
    await db.insert(schema.billingWebhookEvents).values(
      Array.from({ length: 35 }, (_, i) => ({
        provider: "paypal" as const, providerEventId: `WH-OLD-${i}`, eventType: "PAYMENT.CAPTURE.COMPLETED", payload: {},
        failedAt: ago(DAY), failureMessage: "old failure", verificationStatus: "verified", attempts: 1,
      })),
    );
    const body = (await (await call("admin", "GET", "/billing")).json()) as { summary: { failedWebhooks: number }; webhooks: object[] };
    expect(body.webhooks).toHaveLength(30);
    expect(body.summary.failedWebhooks).toBe(36);
  });
});
