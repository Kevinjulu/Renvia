import { asc, eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminIncidentsResponse, AdminPerformanceFailuresResponse, AdminPerformanceSummaryResponse, AdminPerformanceTimeseriesResponse } from "@renvia/types";
import { UPSCALE_COST_MICROS } from "../src/lib/models.js";
import { adminEnv, ago, callAdmin as call, root } from "./support/admin.js";
import { db, makeProject, makeRender, makeSegmentation, makeUser } from "./support/db.js";

// Render telemetry (the renders trigger and generated job type), the Performance API built on
// it, and the leased operations sync behind frequent incident detection.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

let projectId: string;
let ownerId: string;

beforeEach(async () => {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan" });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
  await makeUser({ clerkId: "billing", email: "billing@renvia.test", role: "billing" });
  const owner = await makeUser({ email: "owner@example.test" });
  ownerId = owner.id;
  projectId = (await makeProject(owner.id)).id;
});

const eventsFor = async (renderId: string) =>
  (await db.select().from(schema.renderJobEvents).where(eq(schema.renderJobEvents.renderId, renderId)).orderBy(asc(schema.renderJobEvents.occurredAt))).map((e) => [e.eventType, e.stage]);

const update = (id: string, patch: Partial<typeof schema.renders.$inferInsert>) =>
  db.update(schema.renders).set({ ...patch, updatedAt: new Date() }).where(eq(schema.renders.id, id));

describe("job type", () => {
  it("is derived from settings the same way as renderRouteFor", async () => {
    const cases: [Parameters<typeof makeRender>[1], string, string | null][] = [
      [{}, "photo", null],
      [{ settings: { sourceType: "drawing" } }, "drawing", null],
      [{ settings: { referenceImageUrls: ["https://example.test/r.png"] } }, "references", null],
      [{ settings: { referenceImageUrls: ["https://example.test/r.png"], fidelity: { mode: "strict", protectedFeatures: [] } } }, "fidelity", null],
      [{ settings: { edit: { mode: "region" } as never } }, "edit", null],
      [{ settings: { edit: { mode: "region" } as never, referenceImageUrls: ["https://example.test/r.png"] } }, "edit-references", null],
      [{ settings: { upscale: { target: "8k", parentRenderId: "x" } as never } }, "upscale", "8k"],
      [{ settings: { highRes: { target: "4k" } as never } }, "photo", "4k"],
    ];
    for (const [overrides, jobType, resolution] of cases) {
      const render = await makeRender(projectId, overrides);
      expect([render.jobType, render.outputResolution]).toEqual([jobType, resolution]);
    }
  });
});

describe("lifecycle events", () => {
  it("records a high-resolution render from creation through its upscale", async () => {
    const render = await makeRender(projectId, { model: "fal-ai/flux-pro/kontext", settings: { highRes: { target: "4k" } as never } });
    await update(render.id, { status: "processing", falRequestId: "req-render" });
    await update(render.id, { model: "bria/increase-resolution", falRequestId: "req-upscale", settings: { highRes: { target: "4k", baseImageUrl: "https://example.test/base.png" } as never } });
    await update(render.id, { status: "succeeded", settings: { highRes: { target: "4k", baseImageUrl: "https://example.test/base.png", imageUrl: "https://example.test/4k.png" } as never } });

    expect(await eventsFor(render.id)).toEqual([
      ["created", "render"],
      ["submitted", "render"],
      ["upscale_started", "upscale"],
      ["submitted", "upscale"],
      ["upscale_completed", "upscale"],
      ["completed", "upscale"],
    ]);
    const [submitted] = await db.select().from(schema.renderJobEvents).where(eq(schema.renderJobEvents.eventType, "submitted")).orderBy(asc(schema.renderJobEvents.occurredAt));
    expect(submitted).toMatchObject({ providerRequestId: "req-render", model: "fal-ai/flux-pro/kontext" });
  });

  it("tells a cancellation from a failure, and ignores unrelated updates", async () => {
    const cancelled = await makeRender(projectId);
    await update(cancelled.id, { status: "failed", errorMessage: "Cancelled" });
    const failed = await makeRender(projectId);
    await update(failed.id, { status: "failed", errorMessage: "Render timed out" });
    await db.update(schema.renders).set({ isFavorite: true }).where(eq(schema.renders.id, failed.id));

    expect(await eventsFor(cancelled.id)).toEqual([["created", "render"], ["cancelled", "render"]]);
    expect(await eventsFor(failed.id)).toEqual([["created", "render"], ["failed", "render"]]);
  });
});

describe("GET /performance/summary", () => {
  it("counts outcomes, splits generation from upscale cost and labels estimated timings", async () => {
    // Measured: has events, finished 2s after creation.
    const measured = await makeRender(projectId, { model: "fal-ai/flux-pro/kontext", costMicros: 40_000, creditsCharged: 1 });
    await update(measured.id, { status: "processing", falRequestId: "r1" });
    await update(measured.id, { status: "succeeded" });
    await db.update(schema.renderJobEvents).set({ occurredAt: new Date(measured.createdAt.getTime() + 2_000) }).where(eq(schema.renderJobEvents.eventType, "completed"));
    // High-res 4K render whose upscale ran: part of its cost is the upscale.
    await makeRender(projectId, { model: "bria/increase-resolution", status: "succeeded", costMicros: 40_000 + UPSCALE_COST_MICROS["4k"], settings: { highRes: { target: "4k", imageUrl: "x" } as never } });
    // Legacy render: no events, so only an estimated time (10s between created and updated).
    const legacy = await makeRender(projectId, { model: "fal-ai/flux-pro/kontext", status: "succeeded", costMicros: 40_000, createdAt: ago(60_000), updatedAt: ago(50_000) });
    await db.delete(schema.renderJobEvents).where(eq(schema.renderJobEvents.renderId, legacy.id));
    await makeRender(projectId, { status: "failed", errorMessage: "Render timed out" });
    await makeRender(projectId, { status: "failed", errorMessage: "Cancelled" });
    await makeSegmentation(ownerId, { status: "failed", errorMessage: "boom" });

    const res = await call("analyst", "GET", "/performance/summary?range=24h");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminPerformanceSummaryResponse;

    expect(body.totals).toMatchObject({ total: 5, succeeded: 3, failed: 1, cancelled: 1, successRate: 0.75 });
    expect(body.totals.upscaleUsd).toBeCloseTo(0.04);
    expect(body.totals.generationUsd).toBeCloseTo(0.12);
    expect(body.totals.costPerSuccessUsd).toBeCloseTo(0.16 / 3);
    // Only the measured render has a completion event; the other two are estimated.
    expect(body.totals.endToEnd).toMatchObject({ samples: 1, weak: true });
    expect(body.totals.estimatedEndToEnd).toMatchObject({ samples: 2 });
    expect(body.totals.estimatedEndToEnd.p99Ms).toBeGreaterThan(9_000);
    expect(body.coverage).toEqual({ withEvents: 4, total: 5 });
    expect(body.segmentations).toMatchObject({ total: 1, failed: 1, failureRate: 1 });
    expect(body.rows.find((row) => row.outputResolution === "4k")).toMatchObject({ jobType: "photo", upscaleUsd: 0.04 });
  });

  it("reports measured end-to-end time from lifecycle events", async () => {
    const render = await makeRender(projectId, { model: "fal-ai/flux-pro/kontext" });
    await update(render.id, { status: "processing", falRequestId: "r1" });
    await update(render.id, { status: "succeeded" });
    await db.update(schema.renderJobEvents).set({ occurredAt: new Date(render.createdAt.getTime() + 3_000) }).where(eq(schema.renderJobEvents.eventType, "completed"));

    const body = (await (await call("analyst", "GET", "/performance/summary?range=24h")).json()) as AdminPerformanceSummaryResponse;

    expect(body.totals.endToEnd.samples).toBe(1);
    // Postgres keeps microseconds that the JS Date dropped, so allow a millisecond either way.
    expect(Math.abs(body.totals.endToEnd.p50Ms! - 3_000)).toBeLessThanOrEqual(1);
    expect(body.rows[0]).toMatchObject({ model: "fal-ai/flux-pro/kontext", jobType: "photo" });
  });

  it("validates the range and needs render access", async () => {
    expect((await call("analyst", "GET", "/performance/summary?range=1y")).status).toBe(400);
    for (const path of ["/performance/summary", "/performance/timeseries", "/performance/failures"]) {
      expect((await call("billing", "GET", path)).status).toBe(403);
    }
  });
});

describe("GET /performance/timeseries", () => {
  it("returns a point for every hour of the last day, filled with zeros", async () => {
    await makeRender(projectId, { status: "succeeded" });
    const body = (await (await call("analyst", "GET", "/performance/timeseries?range=24h")).json()) as AdminPerformanceTimeseriesResponse;

    expect(body.bucket).toBe("hour");
    expect(body.points.length).toBeGreaterThanOrEqual(24);
    expect(body.points.reduce((sum, point) => sum + point.total, 0)).toBe(1);
    expect(body.points.at(-1)!.total).toBe(1);
  });
});

describe("GET /performance/failures", () => {
  it("groups repeats of one problem and sorts them into categories", async () => {
    await makeRender(projectId, { status: "failed", errorMessage: "Couldn't download render result (404) for 1f0e4c2a-1111-4222-8333-444455556666" });
    await makeRender(projectId, { status: "failed", errorMessage: "Couldn't download render result (502) for 2a0e4c2a-1111-4222-8333-444455556666" });
    await makeRender(projectId, { status: "failed", errorMessage: "Render failed unexpectedly" });
    await makeRender(projectId, { status: "succeeded", settings: { highRes: { target: "8k", error: "Render timed out" } as never } });
    await makeSegmentation(ownerId, { status: "failed", errorMessage: "fal returned 503" });

    const body = (await (await call("analyst", "GET", "/performance/failures?range=7d")).json()) as AdminPerformanceFailuresResponse;

    const storage = body.groups.find((group) => group.category === "storage")!;
    expect(storage).toMatchObject({ source: "render", count: 2, affectedUsers: 1, message: "couldn't download render result (#) for <id>" });
    expect(body.groups.find((group) => group.source === "upscale")).toMatchObject({ category: "timeout", jobType: "photo" });
    expect(body.groups.find((group) => group.source === "segmentation")).toMatchObject({ category: "provider", jobType: "selection" });
    // "failed" must not read as the provider keyword "fal".
    expect(body.groups.find((group) => group.message === "render failed unexpectedly")!.category).toBe("internal");
    expect(body.byCategory.reduce((sum, row) => sum + row.count, 0)).toBe(5);
  });
});

describe("operations sync", () => {
  const cronEnv = { ...adminEnv, CRON_SECRET: "test-cron-secret" };
  const cron = (path: string, secret?: string) =>
    root.request(`http://localhost/api/cron/${path}`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {} }, cronEnv);

  it("needs the cron secret", async () => {
    expect((await cron("operations-sync")).status).toBe(401);
    expect((await cron("operations-sync", "wrong")).status).toBe(401);
  });

  it("opens incidents for failed work and records the run for the admin", async () => {
    await makeRender(projectId, { status: "failed", errorMessage: "Render timed out" });

    const res = await cron("operations-sync", "test-cron-secret");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ran: true, result: { incidents: { opened: 1 } } });
    const incidents = (await (await call("admin", "GET", "/incidents")).json()) as AdminIncidentsResponse;
    expect(incidents.incidents).toHaveLength(1);
    expect(incidents.sync).toMatchObject({ running: false, lastError: null });
    expect(incidents.sync.lastSuccessAt).not.toBeNull();
  });

  it("skips while another run holds the lease, including a manual sync", async () => {
    await db.insert(schema.scheduledJobs).values({ name: "operations-sync", leaseUntil: new Date(Date.now() + 60_000) });

    expect(await (await cron("operations-sync", "test-cron-secret")).json()).toEqual({ ran: false, reason: "already_running" });
    expect(await (await call("admin", "POST", "/incidents/sync", {})).json()).toEqual({ opened: 0, skipped: "already_running" });
    expect(((await (await call("admin", "GET", "/incidents")).json()) as AdminIncidentsResponse).sync.running).toBe(true);
  });

  it("takes over a lease that has expired", async () => {
    await db.insert(schema.scheduledJobs).values({ name: "operations-sync", leaseUntil: ago(60_000) });
    expect(await (await cron("operations-sync", "test-cron-secret")).json()).toMatchObject({ ran: true });
    const [job] = await db.select().from(schema.scheduledJobs);
    expect(job).toMatchObject({ leaseUntil: null, runCount: 1 });
  });
});
