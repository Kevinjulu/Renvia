import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { callApi } from "./support/api.js";
import { balanceOf, db, makeProject, makeUser, putOnPlan } from "./support/db.js";
import { getUsage } from "../src/lib/limits.js";

// Edits only spend credits: they never count toward the daily or monthly render limits. They run
// on the same engine, so they still wait for a free slot under the plan's concurrent-render cap.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

/** A plan with the given caps, a customer on it with credits, and a project. */
async function setup(caps: { daily?: number | null; monthly?: number | null; concurrent?: number }) {
  await db.insert(schema.billingPlans).values({
    slug: "starter",
    name: "Free",
    description: "Free plan",
    dailyRenderLimit: caps.daily ?? null,
    monthlyRenderLimit: caps.monthly ?? null,
    concurrentRenderLimit: caps.concurrent ?? 10,
  });
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: 20 });
  await putOnPlan(user.id, "starter");
  // putOnPlan only creates a plan that's missing; keep the caps this test set.
  await db.update(schema.billingPlans).set({
    dailyRenderLimit: caps.daily ?? null,
    monthlyRenderLimit: caps.monthly ?? null,
    concurrentRenderLimit: caps.concurrent ?? 10,
  }).where(eq(schema.billingPlans.slug, "starter"));
  const project = await makeProject(user.id);
  return { user, project };
}

const base = (projectId: string) => ({
  projectId,
  sourceImageUrl: "https://example.test/elevation.jpg",
  aspectRatio: "auto",
  style: "Photorealistic",
});

const render = (projectId: string) =>
  callApi("customer", "POST", "/renders", { ...base(projectId), prompt: "warm evening light", generationSettings: { sourceType: "photo" } });

const edit = (projectId: string) =>
  callApi("customer", "POST", "/renders", {
    ...base(projectId),
    prompt: "Replace the front door with a dark oak door",
    generationSettings: { edit: { mode: "prompt", method: "prompt" } },
  });

describe("edits and the daily and monthly render limits", () => {
  it("refuses a render past the daily limit but still takes an edit", async () => {
    const { user, project } = await setup({ daily: 1 });

    expect((await render(project.id)).status).toBe(201);
    const refused = await render(project.id);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "daily_limit_reached" });

    const edited = await edit(project.id);
    expect(edited.status).toBe(201);
    // Edits are charged like any render: 1 credit for the render, 1 for the edit.
    expect(await balanceOf(user.id)).toBe(18);
  });

  it("does not count edits toward the day or the month", async () => {
    const { user, project } = await setup({ daily: 2, monthly: 2 });

    for (let i = 0; i < 4; i += 1) expect((await edit(project.id)).status).toBe(201);
    expect(await getUsage(db, user.id)).toMatchObject({ rendersToday: 0, rendersThisMonth: 0 });

    // The full allowance of renders is still there.
    expect((await render(project.id)).status).toBe(201);
    expect((await render(project.id)).status).toBe(201);
    expect(await getUsage(db, user.id)).toMatchObject({ rendersToday: 2, rendersThisMonth: 2 });
    expect((await render(project.id)).status).toBe(429);
  });

  it("takes an edit after the monthly limit is reached", async () => {
    const { project } = await setup({ monthly: 1 });
    expect((await render(project.id)).status).toBe(201);
    expect(await (await render(project.id)).json()).toMatchObject({ code: "monthly_limit_reached" });
    expect((await edit(project.id)).status).toBe(201);
  });

  it("still makes an edit wait for a free slot when the plan runs one render at a time", async () => {
    const { project } = await setup({ concurrent: 1 });
    expect((await render(project.id)).status).toBe(201);

    const waiting = await edit(project.id);
    expect(waiting.status).toBe(429);
    expect(await waiting.json()).toMatchObject({ code: "concurrency_limit_reached" });
  });

  it("charges nothing for an edit that is refused", async () => {
    const { user, project } = await setup({ concurrent: 1 });
    await render(project.id);
    const before = await balanceOf(user.id);
    expect((await edit(project.id)).status).toBe(429);
    expect(await balanceOf(user.id)).toBe(before);
  });
});

describe("renders waiting for a slot are never lost", () => {
  it("accepts renders one after another as earlier ones finish", async () => {
    const { user, project } = await setup({ concurrent: 1 });
    expect((await render(project.id)).status).toBe(201);
    expect((await render(project.id)).status).toBe(429);

    // The first render ends; the next one the Studio sends goes through.
    await db.update(schema.renders).set({ status: "succeeded" }).where(eq(schema.renders.projectId, project.id));
    expect((await render(project.id)).status).toBe(201);
    expect(await balanceOf(user.id)).toBe(18);
  });
});
