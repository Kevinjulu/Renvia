import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStudioConfig, rolloutBucket, type AdminStudioControlResponse, type MeResponse, type StudioConfig } from "@renvia/types";
import { callAdmin } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeUser, putOnPlan } from "./support/db.js";

// Studio Control: versioned feature rules enforced by the API, observe mode, approvals for
// publishing, and scheduled maintenance windows.
// /me looks the user's email up in Clerk; answer with one built from the Clerk id.
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
let customerId: string;
let projectId: string;

beforeEach(async () => {
  objects.clear();
  objects.set("u/source.jpg", new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).jpeg().toBuffer()));
  await db.insert(schema.billingPlans).values([
    { slug: "starter", name: "Starter", description: "Starter plan" },
    { slug: "studio", name: "Studio", description: "Studio plan", priceCents: 2000 },
  ]);
  await db.insert(schema.appSettings).values({ id: 1, falMode: "mock", dailyRenderLimit: null, maxProjectsPerUser: null });
  // Approvals off unless a test turns one on.
  await db.insert(schema.governanceSettings).values({ id: 1, bulkCreditApprovalThreshold: 0, roleChangeApprovalThreshold: 0, refundApprovalThresholdCents: 0, maintenanceApprovalThreshold: 0, studioChangeApprovalThreshold: 0 });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin", creditBalance: 50 });
  await makeUser({ clerkId: "admin2", email: "admin2@renvia.test", role: "admin" });
  await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
  await makeUser({ clerkId: "billing", email: "billing@renvia.test", role: "billing" });
  const customer = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 50 });
  customerId = customer.id;
  // On Premium, so every feature is in the plan and only Studio Control's rules decide.
  await putOnPlan(customer.id, "team");
  projectId = (await makeProject(customer.id)).id;
});

function render(clerkId: string, generationSettings: Record<string, unknown> = {}, project = projectId) {
  return callApi(clerkId, "POST", "/renders", {
    projectId: project,
    sourceImageUrl: `${ORIGIN}/api/uploads/u/source.jpg`,
    prompt: "warm evening light",
    aspectRatio: "auto",
    style: "Photorealistic",
    generationSettings: { sourceType: "photo", ...generationSettings },
  });
}

const select = (body: Record<string, unknown>) => callApi("customer", "POST", "/segmentations", { imageUrl: `${ORIGIN}/api/uploads/u/source.jpg`, ...body });
const control = async () => (await (await callAdmin("admin", "GET", "/studio-control")).json()) as AdminStudioControlResponse;
const me = async () => (await (await callApi("customer", "GET", "/me")).json()) as MeResponse;

/** The current config with one feature's rule changed. */
async function withRule(key: keyof StudioConfig["features"], patch: Partial<StudioConfig["features"]["render.standard"]>) {
  const current = await control();
  return { expectedVersion: current.current.version, config: { features: { ...current.current.config.features, [key]: { ...current.current.config.features[key], ...patch } } } };
}

async function publish(key: keyof StudioConfig["features"], patch: Partial<StudioConfig["features"]["render.standard"]>, reason = "test") {
  const res = await callAdmin("admin", "POST", "/studio-control/publish", { ...(await withRule(key, patch)), reason });
  expect(res.status).toBe(200);
  return (await res.json()) as { version: number };
}

describe("defaults", () => {
  it("starts at version 1 with every feature on, so nothing changes for customers", async () => {
    const state = await control();
    expect(state.current).toMatchObject({ version: 1, config: defaultStudioConfig() });
    const profile = await me();
    expect(profile.configVersion).toBe(1);
    expect(Object.values(profile.features).every((feature) => feature.available)).toBe(true);
    const res = await render("customer");
    expect(res.status).toBe(201);
    const [row] = await db.select().from(schema.renders);
    expect(row!.configVersion).toBe(1);
  });
});

describe("feature rules", () => {
  it("refuses a switched-off feature, with the operator's message, and lets admins through", async () => {
    await publish("export.8k", { enabled: false, message: "8K is resting this week." });

    const refused = await render("customer", { highRes: { target: "8k" } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "feature_disabled", error: "8K is resting this week.", feature: "export.8k", reason: "disabled" });
    expect((await render("customer", { highRes: { target: "4k" } })).status).toBe(201);
    const adminProject = await makeProject((await db.select().from(schema.users).where(eq(schema.users.clerkId, "admin")))[0]!.id);
    expect((await render("admin", { highRes: { target: "8k" } }, adminProject.id)).status).toBe(201);
    expect((await me()).features["export.8k"]).toEqual({ available: false, reason: "disabled", message: "8K is resting this week." });
  });

  it("keeps 4K and 8K output to the plans that include them, whatever the rules say", async () => {
    // Several renders below; only the plan should decide, not the one-at-a-time cap.
    await db.update(schema.users).set({ limitsExempt: true }).where(eq(schema.users.id, customerId));
    await putOnPlan(customerId, "starter");
    const free = await render("customer", { highRes: { target: "4k" } });
    expect(free.status).toBe(403);
    expect(await free.json()).toMatchObject({ code: "feature_disabled", feature: "export.4k", reason: "plan" });
    expect((await me()).features["export.8k"]).toMatchObject({ available: false, reason: "plan" });
    expect((await render("customer")).status).toBe(201);

    await putOnPlan(customerId, "studio");
    expect((await render("customer", { highRes: { target: "4k" } })).status).toBe(201);
    expect(await (await render("customer", { highRes: { target: "8k" } })).json()).toMatchObject({ feature: "export.8k", reason: "plan" });
    // Observe mode doesn't open it up either.
    await publish("export.8k", { enforcement: "observe" });
    expect((await render("customer", { highRes: { target: "8k" } })).status).toBe(403);

    await putOnPlan(customerId, "team");
    expect((await render("customer", { highRes: { target: "8k" } })).status).toBe(201);
  });

  it("limits a feature to chosen plans", async () => {
    await publish("render.references", { allowedPlans: ["studio"] });
    const refused = await render("customer", { referenceImageUrls: [`${ORIGIN}/api/uploads/u/source.jpg`] });
    expect(await refused.json()).toMatchObject({ code: "feature_disabled", reason: "plan" });
  });

  it("rolls a feature out to a stable share of users", async () => {
    await publish("export.4k", { rolloutPercent: 0 });
    expect(await (await render("customer", { highRes: { target: "4k" } })).json()).toMatchObject({ reason: "rollout" });
    const bucket = rolloutBucket(customerId, "export.4k");
    await publish("export.4k", { rolloutPercent: bucket + 1 });
    expect((await render("customer", { highRes: { target: "4k" } })).status).toBe(201);
  });

  it("only logs what an observe-mode rule would refuse", async () => {
    await publish("render.standard", { enabled: false, enforcement: "observe" });

    expect((await render("customer")).status).toBe(201);
    expect((await me()).features["render.standard"].available).toBe(true);
    expect((await control()).observations).toEqual([{ key: "render.standard", reason: "disabled", last24h: 1, last7d: 1, users7d: 1 }]);
  });

  it("applies to automatic selections by how they select", async () => {
    await publish("selection.prompt", { enabled: false });
    expect(await (await select({ prompt: "windows" })).json()).toMatchObject({ code: "feature_disabled", feature: "selection.prompt" });
    expect((await select({ point: { x: 10, y: 10 } })).status).not.toBe(403);
  });
});

describe("publishing", () => {
  it("records each version immutably, with a checksum and an audited change list", async () => {
    const { version } = await publish("export.8k", { enabled: false }, "upscaler incident");
    expect(version).toBe(2);
    const state = await control();
    expect(state.revisions.map((revision) => revision.version)).toEqual([2, 1]);
    expect(state.current.checksum).toMatch(/^[0-9a-f]{64}$/);
    const [event] = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.action, "studio.publish"));
    expect(event!.summary).toBe("Published Studio configuration v2: 8K output");
    expect(event!.detail).toMatchObject({ reason: "upscaler incident", changes: [{ key: "export.8k", before: { enabled: true }, after: { enabled: false } }] });
  });

  it("refuses a stale version, an unchanged config, an unknown plan and a malformed config", async () => {
    const stale = await withRule("export.8k", { enabled: false });
    await publish("export.4k", { enabled: false });
    const conflict = await callAdmin("admin", "POST", "/studio-control/publish", { ...stale, reason: "x" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "config_version_conflict" });

    const current = await control();
    expect(await (await callAdmin("admin", "POST", "/studio-control/publish", { expectedVersion: 2, config: current.current.config, reason: "x" })).json()).toMatchObject({ code: "no_changes" });
    expect((await callAdmin("admin", "POST", "/studio-control/publish", { ...(await withRule("export.8k", { allowedPlans: ["gold"] })), reason: "x" })).status).toBe(400);
    const partial = Object.fromEntries(Object.entries(current.current.config.features).filter(([key]) => key !== "export.8k"));
    expect((await callAdmin("admin", "POST", "/studio-control/publish", { expectedVersion: 2, config: { features: partial }, reason: "x" })).status).toBe(400);
    expect((await control()).current.version).toBe(2);
  });

  it("restores an earlier version as a new one", async () => {
    await publish("export.8k", { enabled: false });
    const res = await callAdmin("admin", "POST", "/studio-control/restore", { version: 1, expectedVersion: 2, reason: "roll back" });
    expect(await res.json()).toMatchObject({ version: 3 });
    const state = await control();
    expect(state.current).toMatchObject({ version: 3, restoredFrom: 1, config: defaultStudioConfig() });
    expect(state.current.checksum).toBe(state.revisions.find((revision) => revision.version === 1)!.checksum);
  });

  it("holds a publish for a second admin when the Studio rule is on, and rechecks the version", async () => {
    await db.update(schema.governanceSettings).set({ studioChangeApprovalThreshold: 1 });
    const held = await callAdmin("admin", "POST", "/studio-control/publish", { ...(await withRule("export.8k", { enabled: false })), reason: "incident" });
    expect(held.status).toBe(202);
    const { approvalId } = (await held.json()) as { approvalId: string };
    expect((await control()).pendingApprovals).toMatchObject([{ id: approvalId, action: "studio_change", status: "pending" }]);

    await callAdmin("admin2", "POST", `/approvals/${approvalId}/approve`, {});
    const executed = await callAdmin("admin2", "POST", `/approvals/${approvalId}/execute`, {});
    expect(executed.status).toBe(200);
    const state = await control();
    expect(state.current).toMatchObject({ version: 2, approvalId });
    expect(state.current.config.features["export.8k"].enabled).toBe(false);
  });

  it("won't execute an approved publish once a newer version exists", async () => {
    await db.update(schema.governanceSettings).set({ studioChangeApprovalThreshold: 1 });
    const { approvalId } = (await (await callAdmin("admin", "POST", "/studio-control/publish", { ...(await withRule("export.8k", { enabled: false })), reason: "a" })).json()) as { approvalId: string };
    await callAdmin("admin2", "POST", `/approvals/${approvalId}/approve`, {});
    // Someone publishes another change in between (approval rule switched off for them).
    await db.update(schema.governanceSettings).set({ studioChangeApprovalThreshold: 0 });
    await publish("export.4k", { enabled: false });

    const executed = await callAdmin("admin2", "POST", `/approvals/${approvalId}/execute`, {});
    expect(executed.status).toBe(409);
    expect(await executed.json()).toMatchObject({ code: "config_version_conflict" });
    const [request] = await db.select().from(schema.approvalRequests);
    expect(request!.status).toBe("approved");
  });

  it("lets analysts and support read Studio Control but only admins change it", async () => {
    expect((await callAdmin("analyst", "GET", "/studio-control")).status).toBe(200);
    expect((await callAdmin("billing", "GET", "/studio-control")).status).toBe(403);
    expect((await callAdmin("analyst", "POST", "/studio-control/publish", { ...(await withRule("export.8k", { enabled: false })), reason: "x" })).status).toBe(403);
  });
});

describe("maintenance windows", () => {
  const window = (startOffsetMs: number, endOffsetMs: number, scope = "renders") => ({
    scope,
    startsAt: new Date(Date.now() + startOffsetMs).toISOString(),
    endsAt: new Date(Date.now() + endOffsetMs).toISOString(),
    message: "Upgrading the render pipeline",
    reason: "planned upgrade",
  });

  it("pauses its scope while it runs and lifts when cancelled", async () => {
    const created = await callAdmin("admin", "POST", "/maintenance-windows", window(-60_000, 3_600_000));
    expect(created.status).toBe(201);
    const { window: row } = (await created.json()) as { window: { id: string; state: string } };
    expect(row.state).toBe("active");

    const refused = await render("customer");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: "maintenance", error: "Upgrading the render pipeline" });
    expect(await me()).toMatchObject({ maintenanceRenders: true, maintenanceSegments: false, maintenanceMessage: "Upgrading the render pipeline" });
    expect((await select({ point: { x: 10, y: 10 } })).status).not.toBe(503);

    expect((await callAdmin("admin", "POST", `/maintenance-windows/${row.id}/cancel`, { reason: "done early" })).status).toBe(200);
    expect((await render("customer")).status).toBe(201);
  });

  it("announces an upcoming window without pausing anything yet", async () => {
    await callAdmin("admin", "POST", "/maintenance-windows", window(3_600_000, 7_200_000, "all"));
    const profile = await me();
    expect(profile.maintenanceRenders).toBe(false);
    expect(profile.upcomingMaintenance).toMatchObject({ scope: "all", message: "Upgrading the render pipeline" });
    expect((await render("customer")).status).toBe(201);
  });

  it("validates times and follows the maintenance approval rule", async () => {
    expect((await callAdmin("admin", "POST", "/maintenance-windows", window(3_600_000, 60_000))).status).toBe(400);
    expect((await callAdmin("admin", "POST", "/maintenance-windows", window(0, 8 * 24 * 3_600_000))).status).toBe(400);
    expect((await callAdmin("analyst", "POST", "/maintenance-windows", window(0, 3_600_000))).status).toBe(403);

    await db.update(schema.governanceSettings).set({ maintenanceApprovalThreshold: 1 });
    const held = await callAdmin("admin", "POST", "/maintenance-windows", window(-60_000, 3_600_000));
    expect(held.status).toBe(202);
    expect((await render("customer")).status).toBe(201);
    const { approvalId } = (await held.json()) as { approvalId: string };
    await callAdmin("admin2", "POST", `/approvals/${approvalId}/approve`, {});
    expect((await callAdmin("admin2", "POST", `/approvals/${approvalId}/execute`, {})).status).toBe(200);
    expect((await render("customer")).status).toBe(503);
  });
});

describe("multi-elevation rendering", () => {
  it("is on for every plan until a rule narrows it", async () => {
    const profile = await me();
    expect(profile.features["render.multiElevation"]).toMatchObject({ available: true });
    expect((await render("customer", { multiElevation: true })).status).toBe(201);
  });

  it("can be limited to some plans, with a plan reason the Studio turns into an upgrade prompt", async () => {
    await publish("render.multiElevation", { allowedPlans: ["team"] });
    await putOnPlan(customerId, "studio");

    expect((await me()).features["render.multiElevation"]).toMatchObject({ available: false, reason: "plan" });
    const refused = await render("customer", { multiElevation: true });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "feature_disabled", feature: "render.multiElevation", reason: "plan" });

    // A single-elevation render is a different request and is untouched.
    expect((await render("customer")).status).toBe(201);

    await putOnPlan(customerId, "team");
    expect((await render("customer", { multiElevation: true })).status).toBe(201);
  });

  it("lets admins through whatever the rule says", async () => {
    await publish("render.multiElevation", { enabled: false });
    const adminProject = await makeProject((await db.select().from(schema.users).where(eq(schema.users.clerkId, "admin")))[0]!.id);
    expect((await render("customer", { multiElevation: true })).status).toBe(403);
    expect((await render("admin", { multiElevation: true }, adminProject.id)).status).toBe(201);
  });
});
