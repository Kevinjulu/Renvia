import { and, eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelRender, getBudget, reconcileProviderCosts, refreshRender } from "../src/lib/engine.js";
import { getUsage } from "../src/lib/limits.js";
import { callApi } from "./support/api.js";
import { db, makeProject, makeRender, makeUser, testEnv } from "./support/db.js";

// Provider cost is accounted separately from the customer's credits: deleting a project keeps its
// spend and usage, and a render that ends here before fal's outcome is known keeps its cost
// counted until reconcileProviderCosts reads that outcome back. No real fal call is made.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

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

const fal = vi.hoisted(() => ({ submit: vi.fn(), status: vi.fn(), result: vi.fn(), cancel: vi.fn(), requests: 0 }));
vi.mock("@fal-ai/client", async () => {
  const actual = await vi.importActual<typeof import("@fal-ai/client")>("@fal-ai/client");
  return {
    ...actual,
    createFalClient: () => ({
      storage: { upload: async () => "https://fal.test/input.jpg" },
      queue: { submit: fal.submit, status: fal.status, result: fal.result, cancel: fal.cancel },
    }),
  };
});

const ORIGIN = "http://localhost";
const KONTEXT_MICROS = 40_000;
const env = testEnv({ FAL_KEY: "test" });
const { ApiError } = await vi.importActual<typeof import("@fal-ai/client")>("@fal-ai/client");

async function setup({ mode = "prod", plan = {}, settings = {} }: { mode?: "prod" | "mock"; plan?: Partial<typeof schema.billingPlans.$inferInsert>; settings?: Partial<typeof schema.appSettings.$inferInsert> } = {}) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Starter plan", ...plan });
  await db.insert(schema.appSettings).values({ id: 1, falMode: mode, falBudgetUsd: "100", ...settings });
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 10 });
  const project = await makeProject(user.id);
  return { user, project };
}

function postRender(projectId: string, sourceImageUrl = "https://example.test/source.jpg") {
  return callApi("customer", "POST", "/renders", {
    projectId,
    sourceImageUrl,
    prompt: "",
    aspectRatio: "auto",
    style: "Photorealistic",
    generationSettings: { sourceType: "photo" },
  });
}

async function createRender(projectId: string) {
  const response = await postRender(projectId);
  expect(response.status).toBe(201);
  return ((await response.json()) as { job: { id: string } }).job.id;
}

const row = async (id: string) => (await db.select().from(schema.renders).where(eq(schema.renders.id, id)))[0]!;
const balance = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!.creditBalance;
const refunds = async (renderId: string) =>
  (await db.select().from(schema.creditLedger).where(and(eq(schema.creditLedger.renderId, renderId), eq(schema.creditLedger.reason, "render_refund")))).length;
const reservations = async () => (await db.select().from(schema.budgetReservations)).length;
const spentUsd = async () => (await getBudget(testEnv({ FAL_BUDGET_USD: "100" }), db)).spentUsd;

beforeEach(() => {
  fal.requests = 0;
  fal.submit.mockReset().mockImplementation(async () => ({ request_id: `req-${++fal.requests}` }));
  fal.status.mockReset().mockResolvedValue({ status: "IN_PROGRESS" });
  fal.result.mockReset().mockImplementation(async (_model: string, { requestId }: { requestId: string }) => ({
    data: { images: [{ url: `https://fal.test/out/${requestId}.jpg` }] },
  }));
  fal.cancel.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }));
});
afterEach(() => vi.unstubAllGlobals());

describe("deleting a project", () => {
  it("keeps its provider spend, usage and credit history, and hides it from its owner", async () => {
    const { user, project } = await setup();
    const id = await createRender(project.id);
    const spentBefore = await spentUsd();
    expect(spentBefore).toBeCloseTo(KONTEXT_MICROS / 1e6);

    expect((await callApi("customer", "DELETE", `/projects/${project.id}`)).status).toBe(200);

    // Spend, usage and the charge all survive.
    expect(await spentUsd()).toBe(spentBefore);
    const usage = await getUsage(db, user.id);
    expect(usage).toMatchObject({ rendersToday: 1, rendersThisMonth: 1, rendersInFlight: 1, projects: 0 });
    const [charge] = await db.select().from(schema.creditLedger).where(and(eq(schema.creditLedger.renderId, id), eq(schema.creditLedger.reason, "render")));
    expect(charge?.amount).toBe(-1);
    expect((await row(id)).hiddenAt).not.toBeNull();

    // The owner no longer reaches the project or anything in it.
    const list = (await (await callApi("customer", "GET", "/projects")).json()) as { projects: { id: string }[] };
    expect(list.projects.map((p) => p.id)).not.toContain(project.id);
    expect((await callApi("customer", "GET", `/projects/${project.id}`)).status).toBe(404);
    expect((await callApi("customer", "GET", `/renders/${id}`)).status).toBe(404);
    expect((await callApi("customer", "GET", `/renders?projectId=${project.id}`)).status).toBe(404);
    expect((await callApi("customer", "GET", `/canvas-nodes?projectId=${project.id}`)).status).toBe(404);
    expect((await postRender(project.id)).status).toBe(404);
    expect((await callApi("customer", "DELETE", `/projects/${project.id}`)).status).toBe(404);
  });

  it("frees the project slot but not the day's render allowance", async () => {
    const { project } = await setup({ plan: { maxProjects: 1, dailyRenderLimit: 1, concurrentRenderLimit: 5 } });
    const id = await createRender(project.id);
    await db.update(schema.renders).set({ status: "succeeded", costState: "settled" }).where(eq(schema.renders.id, id));
    expect((await callApi("customer", "DELETE", `/projects/${project.id}`)).status).toBe(200);

    const created = await callApi("customer", "POST", "/projects", { name: "Second" });
    expect(created.status).toBe(201);
    const second = ((await created.json()) as { id: string }).id;
    const refused = await postRender(second);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "daily_limit_reached" });
  });

  it("doesn't let another account reach the deleted project's renders", async () => {
    const { project } = await setup();
    const id = await createRender(project.id);
    await callApi("customer", "DELETE", `/projects/${project.id}`);
    await makeUser({ clerkId: "intruder", email: "intruder@example.test" });

    expect((await callApi("intruder", "GET", `/renders/${id}`)).status).toBe(404);
    expect((await callApi("intruder", "GET", `/projects/${project.id}`)).status).toBe(404);
  });
});

describe("provider cost when a render fails", () => {
  it("releases the cost when fal refuses the submit, and refunds the user", async () => {
    const { user, project } = await setup();
    fal.submit.mockRejectedValueOnce(new ApiError({ message: "bad input", status: 422, body: { detail: "Invalid image" } }));
    const id = await createRender(project.id);

    expect(await row(id)).toMatchObject({ status: "failed", costMicros: 0, costState: "settled", uncertainCostMicros: 0 });
    expect(await balance(user.id)).toBe(10);
    expect(await reservations()).toBe(0);
  });

  it("releases the cost when the render fails before anything reaches fal", async () => {
    const { user, project } = await setup();
    // One of our own uploads that is missing: reading it fails before the queue call.
    const response = await postRender(project.id, `${ORIGIN}/api/uploads/elevations/customer/missing.jpg`);
    expect(response.status).toBe(201);
    const { job } = (await response.json()) as { job: { id: string } };

    expect(fal.submit).not.toHaveBeenCalled();
    expect(await row(job.id)).toMatchObject({ status: "failed", costMicros: 0, costState: "settled" });
    expect(await balance(user.id)).toBe(10);
    expect(await reservations()).toBe(0);
  });

  it("keeps the cost when the submit's answer is lost, since fal may have the job", async () => {
    const { user, project } = await setup();
    fal.submit.mockRejectedValueOnce(new Error("socket hang up"));
    const id = await createRender(project.id);

    expect(await row(id)).toMatchObject({ status: "failed", costMicros: KONTEXT_MICROS, costState: "uncertain", uncertainCostMicros: KONTEXT_MICROS });
    expect(await balance(user.id)).toBe(10);
  });

  it("keeps the cost of a render cancelled after submission, refunding the user once", async () => {
    const { user, project } = await setup();
    const id = await createRender(project.id);

    const cancelled = await cancelRender(env, db, await row(id));
    expect(cancelled).toMatchObject({ status: "failed", errorMessage: "Cancelled", costMicros: KONTEXT_MICROS, costState: "uncertain", uncertainCostMicros: KONTEXT_MICROS });
    expect(fal.cancel).toHaveBeenCalledWith("fal-ai/flux-pro/kontext", { requestId: "req-1" });

    // Cancelling again changes nothing.
    await cancelRender(env, db, await row(id));
    await cancelRender(env, db, cancelled);
    expect(await row(id)).toMatchObject({ costMicros: KONTEXT_MICROS, costState: "uncertain" });
    expect(await refunds(id)).toBe(1);
    expect(await balance(user.id)).toBe(10);
    expect(await spentUsd()).toBeCloseTo(KONTEXT_MICROS / 1e6);
  });

  it("settles a cancelled mock render at zero: nothing went to fal", async () => {
    const { user, project } = await setup({ mode: "mock" });
    const id = await createRender(project.id);

    const cancelled = await cancelRender(env, db, await row(id));
    expect(cancelled).toMatchObject({ status: "failed", costMicros: 0, costState: "settled" });
    expect(await balance(user.id)).toBe(10);
  });

  it("keeps the cost of a render that times out while fal is still on it", async () => {
    const { project } = await setup();
    const id = await createRender(project.id);
    await db.update(schema.renders).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(schema.renders.id, id));

    const timedOut = await refreshRender(env, db, await row(id), ORIGIN);
    expect(timedOut).toMatchObject({ status: "failed", errorMessage: "Render timed out", costMicros: KONTEXT_MICROS, costState: "uncertain" });
  });

  it("releases the cost when fal reports the render failed", async () => {
    const { project } = await setup();
    const id = await createRender(project.id);
    fal.status.mockResolvedValue({ status: "COMPLETED" });
    fal.result.mockRejectedValueOnce(new ApiError({ message: "safety", status: 422, body: { detail: "Content flagged" } }));

    const failed = await refreshRender(env, db, await row(id), ORIGIN);
    expect(failed).toMatchObject({ status: "failed", costMicros: 0, costState: "settled" });
  });

  it("settles a completed render once, however often it's refreshed", async () => {
    const { user, project } = await setup();
    const id = await createRender(project.id);
    fal.status.mockResolvedValue({ status: "COMPLETED" });

    const created = await row(id);
    await Promise.all([refreshRender(env, db, created, ORIGIN), refreshRender(env, db, created, ORIGIN)]);
    await refreshRender(env, db, await row(id), ORIGIN);

    expect(await row(id)).toMatchObject({ status: "succeeded", costMicros: KONTEXT_MICROS, costState: "settled", uncertainCostMicros: 0 });
    expect(await refunds(id)).toBe(0);
    expect(await balance(user.id)).toBe(9);
  });

  it("keeps a render cancelled during its submit cancelled, and remembers fal's request for reconciliation", async () => {
    const { user, project } = await setup();
    // The user cancels while the queue call is still in flight.
    fal.submit.mockImplementationOnce(async () => {
      const [pending] = await db.select().from(schema.renders);
      await cancelRender(env, db, pending!);
      return { request_id: "req-late" };
    });
    const id = await createRender(project.id);

    expect(await row(id)).toMatchObject({ status: "failed", errorMessage: "Cancelled", falRequestId: "req-late", costState: "uncertain", costMicros: KONTEXT_MICROS });
    expect(fal.cancel).toHaveBeenCalledWith("fal-ai/flux-pro/kontext", { requestId: "req-late" });
    expect(await refunds(id)).toBe(1);
    expect(await balance(user.id)).toBe(10);
  });
});

describe("reconciling uncertain provider cost", () => {
  async function uncertainRender(overrides: Partial<typeof schema.renders.$inferInsert> = {}) {
    const { user, project } = await setup();
    const render = await makeRender(project.id, {
      status: "failed", errorMessage: "Cancelled", model: "fal-ai/flux-pro/kontext", falRequestId: "req-1",
      costMicros: 2 * KONTEXT_MICROS, uncertainCostMicros: KONTEXT_MICROS, costState: "uncertain", ...overrides,
    });
    return { user, render };
  }

  it("keeps the cost once fal shows the pass completed, and settles it only once", async () => {
    const { user, render } = await uncertainRender();
    fal.status.mockResolvedValue({ status: "COMPLETED" });
    const before = await balance(user.id);

    expect(await reconcileProviderCosts(env, db)).toMatchObject({ checked: 1, charged: 1 });
    expect(await row(render.id)).toMatchObject({ costMicros: 2 * KONTEXT_MICROS, uncertainCostMicros: 0, costState: "settled" });
    expect(await reconcileProviderCosts(env, db)).toMatchObject({ checked: 0 });
    expect(await balance(user.id)).toBe(before);
  });

  it("releases only the uncertain part when fal reports the pass failed, even when runs overlap", async () => {
    const { render } = await uncertainRender();
    fal.status.mockResolvedValue({ status: "COMPLETED" });
    fal.result.mockRejectedValue(new ApiError({ message: "cancelled", status: 400, body: { detail: "Request was cancelled" } }));

    const [first, second] = await Promise.all([reconcileProviderCosts(env, db), reconcileProviderCosts(env, db)]);
    expect(first.released + second.released).toBe(1);
    expect(await row(render.id)).toMatchObject({ costMicros: KONTEXT_MICROS, uncertainCostMicros: 0, costState: "settled" });
    await reconcileProviderCosts(env, db);
    expect((await row(render.id)).costMicros).toBe(KONTEXT_MICROS);
  });

  it("keeps waiting while fal is still on it, then keeps the cost for good", async () => {
    const { render } = await uncertainRender();

    expect(await reconcileProviderCosts(env, db)).toMatchObject({ checked: 1, charged: 0, released: 0, unresolved: 0 });
    expect((await row(render.id)).costState).toBe("uncertain");

    const later = new Date(Date.now() + 25 * 60 * 60_000);
    expect(await reconcileProviderCosts(env, db, later)).toMatchObject({ unresolved: 1 });
    expect(await row(render.id)).toMatchObject({ costMicros: 2 * KONTEXT_MICROS, uncertainCostMicros: 0, costState: "unresolved" });
  });

  it("keeps the cost of a pass whose request id never arrived, once the window has passed", async () => {
    const { render } = await uncertainRender({ falRequestId: null });

    expect(await reconcileProviderCosts(env, db)).toMatchObject({ unresolved: 0 });
    expect(fal.status).not.toHaveBeenCalled();
    expect(await reconcileProviderCosts(env, db, new Date(Date.now() + 25 * 60 * 60_000))).toMatchObject({ unresolved: 1 });
    expect((await row(render.id)).costMicros).toBe(2 * KONTEXT_MICROS);
  });
});

describe("usage caps under concurrent requests", () => {
  it("never runs more renders at once than the concurrency limit allows", async () => {
    const { user, project } = await setup({ plan: { concurrentRenderLimit: 1 } });

    const responses = await Promise.all(Array.from({ length: 5 }, () => postRender(project.id)));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 429, 429, 429, 429]);
    for (const response of responses.filter((r) => r.status === 429)) {
      expect(await response.json()).toMatchObject({ code: "concurrency_limit_reached" });
    }
    expect(await balance(user.id)).toBe(9);
    expect((await db.select().from(schema.renders)).length).toBe(1);
  });

  it("never creates more renders in a day than the daily limit allows", async () => {
    const { user, project } = await setup({ plan: { concurrentRenderLimit: 10, dailyRenderLimit: 2 } });

    const responses = await Promise.all(Array.from({ length: 5 }, () => postRender(project.id)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(2);
    expect(await balance(user.id)).toBe(8);
  });

  it("frees the concurrency slot once a render finishes", async () => {
    const { project } = await setup({ plan: { concurrentRenderLimit: 1 } });
    const id = await createRender(project.id);
    expect((await postRender(project.id)).status).toBe(429);

    fal.status.mockResolvedValue({ status: "COMPLETED" });
    await refreshRender(env, db, await row(id), ORIGIN);
    expect((await postRender(project.id)).status).toBe(201);
  });

  it("counts a render cancelled after submission toward the daily limit, but not one fal refused", async () => {
    const { project } = await setup({ plan: { concurrentRenderLimit: 5, dailyRenderLimit: 1 } });
    fal.submit.mockRejectedValueOnce(new ApiError({ message: "bad input", status: 422, body: { detail: "Invalid image" } }));
    await createRender(project.id);

    // The refused one didn't use fal, so the day's one render is still available.
    const id = await createRender(project.id);
    await cancelRender(env, db, await row(id));

    const refused = await postRender(project.id);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "daily_limit_reached" });
  });
});
