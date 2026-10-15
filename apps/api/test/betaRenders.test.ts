import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@renvia/types";
import { grantBetaCredits } from "../src/lib/beta.js";
import { callAdmin } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { bucketsOf, db, enroll, makeBetaProgram, makeProject, makeUser, putOnPlan } from "./support/db.js";

// Beta funding through the real routes: a tester's jobs are paid from beta credits and capped by
// the program budget, never quietly charged to what they paid for, and the global fal cap and
// operator switches still come first.
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

const fal = vi.hoisted(() => ({ requests: 0 }));
vi.mock("@fal-ai/client", async () => {
  const actual = await vi.importActual<typeof import("@fal-ai/client")>("@fal-ai/client");
  return {
    ...actual,
    createFalClient: () => ({
      storage: { upload: async () => "https://fal.test/input.png" },
      // Submitted and left in the queue: these tests are about admission and charging.
      queue: { submit: async () => ({ request_id: `req-${++fal.requests}` }), status: async () => ({ status: "IN_QUEUE" }), result: async () => ({ data: {} }), cancel: async () => undefined },
    }),
  };
});

const ORIGIN = "http://localhost";
const KONTEXT_MICROS = 40_000;

async function setup({ budgetUsd = "100", programBudgetUsd = "10", dailyRenderLimit = null as number | null } = {}) {
  objects.set("u/source.jpg", new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).jpeg().toBuffer()));
  await db.insert(schema.billingPlans).values([
    { slug: "starter", name: "Starter", description: "Free", concurrentRenderLimit: 10 },
    { slug: "studio", name: "Studio", description: "Paid", priceCents: 2000, concurrentRenderLimit: 10 },
  ]);
  await db.insert(schema.appSettings).values({ id: 1, falMode: "prod", falBudgetUsd: budgetUsd, dailyRenderLimit, maxProjectsPerUser: null });
  await db.insert(schema.governanceSettings).values({ id: 1, bulkCreditApprovalThreshold: 0, roleChangeApprovalThreshold: 0, refundApprovalThresholdCents: 0, maintenanceApprovalThreshold: 0, studioChangeApprovalThreshold: 0 });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  const program = await makeBetaProgram({ budgetUsd: programBudgetUsd });
  const user = await makeUser({ clerkId: "tester", email: "tester@example.test", creditBalance: 50 });
  const enrollment = await enroll(program.id, user.id);
  await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 25, note: "welcome", idempotencyKey: "welcome" });
  const project = await makeProject(user.id);
  return { program, user, enrollment, project };
}

function render(projectId: string, extra: Record<string, unknown> = {}, generationSettings: Record<string, unknown> = {}, clerkId = "tester") {
  return callApi(clerkId, "POST", "/renders", {
    projectId,
    sourceImageUrl: `${ORIGIN}/api/uploads/u/source.jpg`,
    prompt: "warm evening light",
    aspectRatio: "auto",
    style: "Photorealistic",
    generationSettings: { sourceType: "photo", ...generationSettings },
    ...extra,
  });
}

const renders = () => db.select().from(schema.renders);
const code = async (response: Response) => ((await response.json()) as { code?: string }).code;

beforeEach(() => {
  objects.clear();
  fal.requests = 0;
});

describe("beta-funded renders", () => {
  it("are paid from beta credits by default and counted against the program", async () => {
    const { program, user, project } = await setup();

    const response = await render(project.id);

    expect(response.status).toBe(201);
    expect(await bucketsOf(user.id)).toEqual({ balance: 74, plan: 0, beta: 24 });
    const [job] = await renders();
    expect(job).toMatchObject({ betaProgramId: program.id, costMicros: KONTEXT_MICROS });
  });

  it("are refused, not charged to the tester's own credits, when beta credits run out", async () => {
    const { user, project } = await setup();
    await db.update(schema.users).set({ creditBalance: 50, betaCredits: 0 }).where(eq(schema.users.id, user.id));

    const response = await render(project.id);

    expect(response.status).toBe(402);
    expect(await code(response)).toBe("beta_credits_exhausted");
    expect(await bucketsOf(user.id)).toEqual({ balance: 50, plan: 0, beta: 0 });
    expect(await renders()).toHaveLength(0);
  });

  it("use the tester's own credits only when they ask for it", async () => {
    const { user, project } = await setup();

    const response = await render(project.id, { funding: "account" });

    expect(response.status).toBe(201);
    expect(await bucketsOf(user.id)).toEqual({ balance: 74, plan: 0, beta: 25 });
    const [job] = await renders();
    expect(job!.betaProgramId).toBeNull();
  });

  it("stop at the program budget while beta credits remain", async () => {
    // $0.05 fits one $0.04 render, not two.
    const { user, project } = await setup({ programBudgetUsd: "0.05" });

    expect((await render(project.id)).status).toBe(201);
    const second = await render(project.id);

    expect(second.status).toBe(402);
    expect(await code(second)).toBe("beta_budget_exhausted");
    expect(await bucketsOf(user.id)).toEqual({ balance: 74, plan: 0, beta: 24 });
  });

  it("never exceed the program budget when submitted together", async () => {
    const { project } = await setup({ programBudgetUsd: "0.10" });

    const responses = await Promise.all(Array.from({ length: 6 }, () => render(project.id)));

    expect(responses.filter((response) => response.status === 201)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 402)).toHaveLength(4);
    expect(await renders()).toHaveLength(2);
  });

  it("still answer to the global fal cap first", async () => {
    const { user, project } = await setup({ budgetUsd: "0.04", programBudgetUsd: "10" });

    expect((await render(project.id)).status).toBe(201);
    const second = await render(project.id);

    expect(second.status).toBe(402);
    expect(await code(second)).toBe("budget_exhausted");
    expect((await bucketsOf(user.id)).beta).toBe(24);
  });

  it("are unavailable, not silently account-funded, while the tester is suspended or the program paused", async () => {
    const { program, enrollment, user, project } = await setup();

    await db.update(schema.betaEnrollments).set({ status: "suspended" }).where(eq(schema.betaEnrollments.id, enrollment.id));
    const suspended = await render(project.id);
    expect(suspended.status).toBe(403);
    expect(await code(suspended)).toBe("beta_unavailable");

    await db.update(schema.betaEnrollments).set({ status: "active" }).where(eq(schema.betaEnrollments.id, enrollment.id));
    await db.update(schema.betaPrograms).set({ status: "paused" }).where(eq(schema.betaPrograms.id, program.id));
    const paused = await render(project.id);
    expect(paused.status).toBe(403);
    expect(await code(paused)).toBe("beta_unavailable");

    expect(await bucketsOf(user.id)).toEqual({ balance: 75, plan: 0, beta: 25 });
    expect((await render(project.id, { funding: "account" })).status).toBe(201);
  });

  it("are refused for someone who isn't a tester", async () => {
    await setup();
    const outsider = await makeUser({ clerkId: "outsider", email: "outsider@example.test", creditBalance: 10 });
    const project = await makeProject(outsider.id);

    const asked = await render(project.id, { funding: "beta" }, {}, "outsider");
    expect(asked.status).toBe(403);
    expect(await code(asked)).toBe("beta_unavailable");
    expect((await render(project.id, {}, {}, "outsider")).status).toBe(201);
  });

  it("warn operators when the program crosses its warning threshold", async () => {
    // Two $0.04 renders are 80% of $0.10.
    const { program, project } = await setup({ programBudgetUsd: "0.10" });

    await render(project.id);
    await render(project.id);

    const incidents = await db.select().from(schema.incidents).where(eq(schema.incidents.sourceId, program.id));
    expect(incidents.map((row) => row.fingerprint)).toEqual([`beta-budget:${program.id}:80`]);
  });
});

describe("program limits and grants", () => {
  it("replace the plan's daily render limit while enrolled", async () => {
    const { program, project } = await setup({ dailyRenderLimit: 1 });
    await db.update(schema.betaPrograms).set({ dailyRenderLimit: 10 }).where(eq(schema.betaPrograms.id, program.id));

    expect((await render(project.id)).status).toBe(201);
    expect((await render(project.id)).status).toBe(201);
  });

  it("unlock a plan-restricted export, but never past an operator's switch", async () => {
    const { program, project } = await setup();
    const publish = async (rule: Record<string, unknown>) => {
      const current = (await (await callAdmin("admin", "GET", "/studio-control")).json()) as { current: { version: number; config: { features: Record<string, Record<string, unknown>> } } };
      const features = { ...current.current.config.features, "export.4k": { ...current.current.config.features["export.4k"], ...rule } };
      const res = await callAdmin("admin", "POST", "/studio-control/publish", { expectedVersion: current.current.version, config: { features }, reason: "test" });
      expect(res.status).toBe(200);
    };
    await publish({ allowedPlans: ["studio"] });

    const locked = await render(project.id, {}, { highRes: { target: "4k" } });
    expect(locked.status).toBe(403);

    await db.update(schema.betaPrograms).set({ featureGrants: ["export.4k"] }).where(eq(schema.betaPrograms.id, program.id));
    expect((await render(project.id, {}, { highRes: { target: "4k" } })).status).toBe(201);
    const me = (await (await callApi("tester", "GET", "/me")).json()) as MeResponse;
    expect(me.features["export.4k"].available).toBe(true);

    await publish({ enabled: false });
    expect((await render(project.id, {}, { highRes: { target: "4k" } })).status).toBe(403);
  });

  it("report the tester's beta state in /me", async () => {
    const { user } = await setup();
    await putOnPlan(user.id, "starter");

    const me = (await (await callApi("tester", "GET", "/me")).json()) as MeResponse;

    expect(me.betaCredits).toBe(25);
    expect(me.beta).toMatchObject({ running: true, downloadsUnlocked: true, status: "active" });
  });
});

describe("beta-funded selections", () => {
  // The mock engine runs selections inline and still charges their credits.
  const mockEngine = () => db.update(schema.appSettings).set({ falMode: "mock" });

  it("are paid from beta credits and counted against the program", async () => {
    const { program, user } = await setup();
    await mockEngine();

    const response = await callApi("tester", "POST", "/segmentations", { imageUrl: `${ORIGIN}/api/uploads/u/source.jpg`, point: { x: 10, y: 10 } });

    expect(response.status).toBeLessThan(300);
    expect((await bucketsOf(user.id)).beta).toBe(24);
    const [selection] = await db.select().from(schema.segmentations);
    expect(selection!.betaProgramId).toBe(program.id);
  });

  it("are refused with the beta code when beta credits run out", async () => {
    const { user } = await setup();
    await mockEngine();
    await db.update(schema.users).set({ creditBalance: 50, betaCredits: 0 }).where(eq(schema.users.id, user.id));

    const response = await callApi("tester", "POST", "/segmentations", { imageUrl: `${ORIGIN}/api/uploads/u/source.jpg`, point: { x: 10, y: 10 } });

    expect(response.status).toBe(402);
    expect(await code(response)).toBe("beta_credits_exhausted");
    expect((await bucketsOf(user.id)).balance).toBe(50);
  });
});
