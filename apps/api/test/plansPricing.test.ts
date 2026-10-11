import { asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminModelsResponse, AdminPlansResponse, AdminPricingSimulationResponse, AdminStudioControlResponse, CreditPrices, MeResponse } from "@renvia/types";
import { cancelRender } from "../src/lib/engine.js";
import { callAdmin } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { balanceOf, db, makeProject, makeUser, testEnv } from "./support/db.js";

// Phase 4: published credit prices (with a compatibility gate against the old formula), model
// holds, versioned plan and credit pack terms, and the pricing simulator.
vi.mock("@clerk/backend", async () => {
  const stub = (await import("./support/clerkStub.js")).clerkStub();
  return {
    ...stub,
    createClerkClient: () => ({ users: { getUser: async (id: string) => ({ primaryEmailAddress: { emailAddress: `${id}@example.test` }, emailAddresses: [] }) } }),
  };
});

const objects = new Map<string, Uint8Array>();
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return {
    ...actual,
    getObject: vi.fn(async (_env: unknown, key: string) => {
      const bytes = objects.get(key);
      return bytes ? { body: new Blob([new Uint8Array(bytes)]).stream(), contentType: "image/jpeg" } : null;
    }),
    putObject: vi.fn(async (_env: unknown, key: string, body: ArrayBuffer) => {
      objects.set(key, new Uint8Array(body));
    }),
  };
});

const ORIGIN = "http://localhost";
const REF = [`${ORIGIN}/api/uploads/u/source.jpg`];
const PRICES: CreditPrices = { render: 3, references: 4, fidelity: 6, editPass: 2, upscale4k: 5, upscale8k: 9, selection: 2 };
let customerId: string;
let projectId: string;
let starterId: string;
let studioId: string;

beforeEach(async () => {
  objects.clear();
  objects.set("u/source.jpg", new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).jpeg().toBuffer()));
  const [starter, studio] = await db.insert(schema.billingPlans).values([
    { slug: "starter", name: "Starter", description: "Starter plan", monthlyCredits: 10 },
    { slug: "studio", name: "Studio", description: "Studio plan", priceCents: 3000, interval: "month", monthlyCredits: 100, paypalPlanId: "P-STUDIO-1" },
  ]).returning();
  starterId = starter!.id;
  studioId = studio!.id;
  await db.insert(schema.creditPacks).values([
    { sku: "pack-50", name: "50 credits", priceCents: 1000, credits: 50 },
    { sku: "pack-200", name: "200 credits", priceCents: 3000, credits: 200 },
  ]);
  // Settings' multipliers at 2 per image and 3 per selection, so the legacy prices are visible.
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock", dailyRenderLimit: null, maxProjectsPerUser: null, creditsPerImage: 2, creditsPerSelection: 3 });
  await db.insert(schema.governanceSettings).values({ id: 1, bulkCreditApprovalThreshold: 0, roleChangeApprovalThreshold: 0, refundApprovalThresholdCents: 0, maintenanceApprovalThreshold: 0, studioChangeApprovalThreshold: 0 });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  await makeUser({ clerkId: "admin2", email: "admin2@renvia.test", role: "admin" });
  await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
  await makeUser({ clerkId: "billing", email: "billing@renvia.test", role: "billing" });
  const customer = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 100 });
  customerId = customer.id;
  projectId = (await makeProject(customer.id)).id;
});

function render(generationSettings: Record<string, unknown> = {}) {
  return callApi("customer", "POST", "/renders", {
    projectId,
    sourceImageUrl: `${ORIGIN}/api/uploads/u/source.jpg`,
    prompt: "warm evening light",
    aspectRatio: "auto",
    style: "Photorealistic",
    generationSettings: { sourceType: "photo", ...generationSettings },
  });
}

/** Credits a request was charged, read from the render it created. */
async function charged(generationSettings: Record<string, unknown> = {}) {
  const res = await render(generationSettings);
  expect(res.status).toBe(201);
  const { job } = (await res.json()) as { job: { id: string } };
  // Finished, so the plan's one-at-a-time limit doesn't refuse the next request.
  const [row] = await db.update(schema.renders).set({ status: "succeeded" }).where(eq(schema.renders.id, job.id)).returning();
  return row!.creditsCharged;
}

const control = async () => (await (await callAdmin("admin", "GET", "/studio-control")).json()) as AdminStudioControlResponse;
const plans = async () => (await (await callAdmin("admin", "GET", "/plans")).json()) as AdminPlansResponse;

async function publishPrices(prices: CreditPrices | null) {
  const res = await callAdmin("admin", "PUT", "/pricing/credits", { expectedVersion: (await control()).current.version, prices, reason: "pricing" });
  expect(res.status).toBe(200);
}

describe("credit prices", () => {
  it("charges exactly what Settings' multipliers did until prices are published", async () => {
    expect(await charged()).toBe(2);
    expect(await charged({ referenceImageUrls: REF })).toBe(2);
    expect(await charged({ referenceImageUrls: REF, fidelity: { mode: "strict", protectedFeatures: ["roof"] } })).toBe(4);
    expect(await charged({ highRes: { target: "4k" } })).toBe(4);
    expect(await charged({ highRes: { target: "8k" } })).toBe(6);
    const me = (await (await callApi("customer", "GET", "/me")).json()) as MeResponse;
    expect(me.creditPrices).toEqual({ render: 2, references: 2, fidelity: 4, editPass: 2, upscale4k: 2, upscale8k: 4, selection: 3 });
    expect((await plans()).creditPrices.source).toBe("settings");
  });

  it("charges published prices as they are, with no multiplier on top", async () => {
    await publishPrices(PRICES);

    expect(await charged()).toBe(3);
    expect(await charged({ referenceImageUrls: REF })).toBe(4);
    expect(await charged({ referenceImageUrls: REF, fidelity: { mode: "strict", protectedFeatures: ["roof"] }, highRes: { target: "8k" } })).toBe(15);
    expect(((await (await callApi("customer", "GET", "/me")).json()) as MeResponse).creditPrices).toEqual(PRICES);
    const [event] = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.action, "studio.publish"));
    expect(event!.summary).toBe("Published Studio configuration v2: Credit prices");

    // Handing pricing back to Settings restores the old charges.
    await publishPrices(null);
    expect(await charged()).toBe(2);
  });

  it("refunds a failed upscale at the prices its render was charged", async () => {
    await publishPrices(PRICES);
    const res = await render({ highRes: { target: "4k" } });
    const { job } = (await res.json()) as { job: { id: string } };
    expect(await balanceOf(customerId)).toBe(100 - 8);
    // The render pass finished and the upscale is running; then the upscale is cancelled.
    const [row] = await db.update(schema.renders)
      .set({ status: "processing", resultImageUrl: "x", settings: { sourceType: "photo", highRes: { target: "4k", baseImageUrl: `${ORIGIN}/api/uploads/renders/base.jpg` } } })
      .where(eq(schema.renders.id, job.id)).returning();
    // Prices change after the charge: the refund still uses the ones it was charged at.
    await publishPrices({ ...PRICES, upscale4k: 50 });

    const finished = await cancelRender(testEnv(), db, row!);

    expect(finished.status).toBe("succeeded");
    expect(finished.creditsCharged).toBe(3);
    expect(await balanceOf(customerId)).toBe(100 - 3);
  });

  it("refunds a render charged before prices were published by the old ratio", async () => {
    const res = await render({ highRes: { target: "8k" } });
    const { job } = (await res.json()) as { job: { id: string } };
    const [row] = await db.update(schema.renders)
      .set({ status: "processing", resultImageUrl: "x", configVersion: null, settings: { sourceType: "photo", highRes: { target: "8k", baseImageUrl: `${ORIGIN}/api/uploads/renders/base.jpg` } } })
      .where(eq(schema.renders.id, job.id)).returning();

    const finished = await cancelRender(testEnv(), db, row!);

    // 6 credits = render 2 + 8K 4; the 8K share (2 of 3 units) comes back.
    expect(finished.creditsCharged).toBe(2);
    expect(await balanceOf(customerId)).toBe(100 - 2);
  });

  it("charges selections the published selection price", async () => {
    await publishPrices(PRICES);
    await callApi("customer", "POST", "/segmentations", { imageUrl: `${ORIGIN}/api/uploads/u/source.jpg`, point: { x: 10, y: 10 } });
    const [selection] = await db.select().from(schema.segmentations);
    expect(selection!.creditsCharged).toBe(2);
  });

  it("is admin-only and validates prices", async () => {
    const expectedVersion = (await control()).current.version;
    expect((await callAdmin("billing", "PUT", "/pricing/credits", { expectedVersion, prices: PRICES, reason: "x" })).status).toBe(403);
    expect((await callAdmin("admin", "PUT", "/pricing/credits", { expectedVersion, prices: { ...PRICES, render: -1 }, reason: "x" })).status).toBe(400);
    expect((await callAdmin("admin", "PUT", "/pricing/credits", { expectedVersion, prices: { render: 1 }, reason: "x" })).status).toBe(400);
  });
});

describe("model registry", () => {
  it("lists the models with what they serve and what pausing them would stop", async () => {
    const res = await callAdmin("analyst", "GET", "/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminModelsResponse;
    expect(body.mode).toBe("mock");
    const mock = body.models.find((model) => model.id === "mock")!;
    expect(mock).toMatchObject({ inUse: true, rule: { paused: false } });
    expect(mock.affects).toContain("render.standard");
    expect(body.models.find((model) => model.id === "fal-ai/flux-pro/kontext")).toMatchObject({ inUse: false, provider: "fal", costUsd: 0.04 });
    expect((await callAdmin("billing", "GET", "/models")).status).toBe(403);
  });

  it("refuses new jobs on a paused model and lets them through once resumed", async () => {
    const expectedVersion = (await control()).current.version;
    const paused = await callAdmin("admin", "POST", "/models/hold", { modelId: "mock", paused: true, message: "Investigating slow renders", expectedVersion, reason: "incident" });
    expect(paused.status).toBe(200);

    const refused = await render();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "feature_disabled", reason: "paused", error: "Investigating slow renders" });
    const me = (await (await callApi("customer", "GET", "/me")).json()) as MeResponse;
    expect(me.features["render.standard"]).toEqual({ available: false, reason: "paused", message: "Investigating slow renders" });

    await callAdmin("admin", "POST", "/models/hold", { modelId: "mock", paused: false, message: null, expectedVersion: expectedVersion + 1, reason: "fixed" });
    expect((await render()).status).toBe(201);
    expect((await callAdmin("admin", "POST", "/models/hold", { modelId: "nope", paused: true, message: null, expectedVersion: expectedVersion + 2, reason: "x" })).status).toBe(404);
  });
});

describe("plans and credit packs", () => {
  const studioTerms = (patch: Record<string, unknown> = {}) => ({
    name: "Studio", description: "Studio plan", priceCents: 3000, monthlyCredits: 120, dailyRenderLimit: null, monthlyRenderLimit: null,
    maxProjects: null, concurrentRenderLimit: null, isActive: true, paypalPlanId: "P-STUDIO-1", ...patch,
  });

  it("records the original terms as v1 and each change after, with an audited diff", async () => {
    const res = await callAdmin("admin", "PUT", `/plans/${studioId}`, { expectedVersion: 0, terms: studioTerms(), reason: "more credits" });
    expect(await res.json()).toEqual({ id: studioId, version: 2 });

    const studio = (await plans()).plans.find((plan) => plan.slug === "studio")!;
    expect(studio).toMatchObject({ monthlyCredits: 120, version: 2 });
    expect(studio.versions.map((version) => [version.version, version.terms.monthlyCredits])).toEqual([[2, 120], [1, 100]]);
    const [event] = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.action, "plan.update"));
    expect(event!.summary).toBe("Updated plan studio (v2): monthlyCredits");
    expect(event!.detail).toMatchObject({ before: { monthlyCredits: 100 }, after: { monthlyCredits: 120 } });
  });

  it("refuses stale edits, a PayPal price change without a new PayPal plan, and retiring Starter", async () => {
    await callAdmin("admin", "PUT", `/plans/${studioId}`, { expectedVersion: 0, terms: studioTerms(), reason: "a" });
    expect((await callAdmin("admin", "PUT", `/plans/${studioId}`, { expectedVersion: 0, terms: studioTerms({ monthlyCredits: 150 }), reason: "b" })).status).toBe(409);

    const price = await callAdmin("admin", "PUT", `/plans/${studioId}`, { expectedVersion: 2, terms: studioTerms({ priceCents: 3500 }), reason: "c" });
    expect(price.status).toBe(400);
    expect(await price.json()).toMatchObject({ code: "invalid_terms" });
    expect((await callAdmin("admin", "PUT", `/plans/${studioId}`, { expectedVersion: 2, terms: studioTerms({ priceCents: 3500, paypalPlanId: "P-STUDIO-2" }), reason: "c" })).status).toBe(200);

    const starter = await callAdmin("admin", "PUT", `/plans/${starterId}`, { expectedVersion: 0, terms: { ...studioTerms({ name: "Starter", priceCents: 0, paypalPlanId: null }), isActive: false }, reason: "d" });
    expect(starter.status).toBe(400);
    expect((await callAdmin("billing", "PUT", `/plans/${studioId}`, { expectedVersion: 3, terms: studioTerms({ monthlyCredits: 5 }), reason: "e" })).status).toBe(403);
  });

  it("creates and edits credit packs with history", async () => {
    const created = await callAdmin("admin", "POST", "/credit-packs", { sku: "pack-500", terms: { name: "500 credits", priceCents: 6000, credits: 500, isActive: true }, reason: "bulk pack" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect((await callAdmin("admin", "POST", "/credit-packs", { sku: "pack-500", terms: { name: "x", priceCents: 1, credits: 1, isActive: true }, reason: "dup" })).status).toBe(409);

    expect(await (await callAdmin("admin", "PUT", `/credit-packs/${id}`, { expectedVersion: 1, terms: { name: "500 credits", priceCents: 5500, credits: 500, isActive: true }, reason: "sale" })).json()).toEqual({ id, version: 2 });
    const pack = (await plans()).packs.find((row) => row.sku === "pack-500")!;
    expect(pack).toMatchObject({ priceCents: 5500, version: 2 });
    expect(pack.versions.map((version) => version.terms.priceCents)).toEqual([5500, 6000]);
  });

  it("holds plan changes for a second admin under the Studio/pricing approval rule", async () => {
    await db.update(schema.governanceSettings).set({ studioChangeApprovalThreshold: 1 });
    const held = await callAdmin("admin", "PUT", `/plans/${studioId}`, { expectedVersion: 0, terms: studioTerms(), reason: "more credits" });
    expect(held.status).toBe(202);
    const { approvalId } = (await held.json()) as { approvalId: string };
    expect((await plans()).plans.find((plan) => plan.slug === "studio")!.monthlyCredits).toBe(100);

    await callAdmin("admin2", "POST", `/approvals/${approvalId}/approve`, {});
    expect((await callAdmin("admin2", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(200);
    expect((await plans()).plans.find((plan) => plan.slug === "studio")).toMatchObject({ monthlyCredits: 120, version: 2 });
  });

  it("records a version when Settings changes a monthly allowance", async () => {
    await callAdmin("admin", "PUT", "/settings", { planMonthlyCredits: { studio: 90 } });
    const versions = await db.select().from(schema.billingPlanVersions).where(eq(schema.billingPlanVersions.planId, studioId)).orderBy(asc(schema.billingPlanVersions.version));
    expect(versions.map((row) => [row.version, row.terms.monthlyCredits])).toEqual([[1, 100], [2, 90]]);
  });

  it("shows which Studio features each plan gets", async () => {
    const current = await control();
    await callAdmin("admin", "POST", "/studio-control/publish", {
      expectedVersion: current.current.version,
      config: { ...current.current.config, features: { ...current.current.config.features, "export.8k": { ...current.current.config.features["export.8k"], allowedPlans: ["studio"] } } },
      reason: "8K for Studio",
    });
    const body = await plans();
    expect(body.plans.find((plan) => plan.slug === "starter")!.features.find((feature) => feature.key === "export.8k")!.available).toBe(false);
    expect(body.plans.find((plan) => plan.slug === "studio")!.features.find((feature) => feature.key === "export.8k")!.available).toBe(true);
  });
});

describe("pricing simulator", () => {
  it("prices a month of usage on a plan, topping up with the best-value pack", async () => {
    const res = await callAdmin("billing", "POST", "/pricing/simulate", {
      prices: PRICES,
      planSlug: "studio",
      periodDays: 30,
      usage: { renders: 20, referenceRenders: 10, fidelityRenders: 5, edits: 10, upscale4k: 4, upscale8k: 1, selections: 10 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminPricingSimulationResponse;
    // 60 + 40 + 30 + 20 + 20 + 9 + 20 = 199 credits; 100 included, 99 bought as one 200-credit pack.
    expect(body).toMatchObject({ creditsNeeded: 199, includedCredits: 100, extraCredits: 99, packsNeeded: { sku: "pack-200", count: 1, costCents: 3000 } });
    expect(body.revenueUsd).toBe(60);
    // fal: 20×0.04 + 10×0.048 + 5×0.048 + 10×0.04 + 4×0.04 + 1×0.08 + 10×0.005 = 2.21
    expect(body.providerCostUsd).toBeCloseTo(2.21);
    expect(body.contributionUsd).toBeCloseTo(57.79);
  });

  it("needs billing access", async () => {
    expect((await callAdmin("analyst", "POST", "/pricing/simulate", { planSlug: "studio", periodDays: 30, usage: { renders: 1, referenceRenders: 0, fidelityRenders: 0, edits: 0, upscale4k: 0, upscale8k: 0, selections: 0 } })).status).toBe(403);
  });
});
