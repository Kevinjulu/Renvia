import { eq, inArray } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { runThrottled } from "../../studio/src/canvas/utils/runThrottled";
import { callApi } from "./support/api.js";
import { balanceOf, db, makeProject, makeUser, putOnPlan } from "./support/db.js";

// The Studio's Generate against the real render route: four elevations on a plan that runs two
// renders at once must all get through, never more than two at a time, with nothing refused to
// the end and nothing charged twice.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

class Refused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function setup(concurrent: number, credits = 20) {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Free", description: "Free plan", concurrentRenderLimit: concurrent });
  const user = await makeUser({ clerkId: "customer", email: "customer@example.test", creditBalance: credits });
  await putOnPlan(user.id, "starter");
  await db.update(schema.billingPlans).set({ concurrentRenderLimit: concurrent }).where(eq(schema.billingPlans.slug, "starter"));
  return { user, project: await makeProject(user.id) };
}

/** One elevation's request, as the Studio sends it. A refusal is thrown with its code. */
function createRender(projectId: string, view: string, onAccepted: () => void) {
  return async () => {
    const response = await callApi("customer", "POST", "/renders", {
      projectId,
      sourceImageUrl: `https://example.test/${view}.jpg`,
      prompt: "",
      aspectRatio: "auto",
      style: "Photorealistic",
      viewKey: view,
      viewLabel: view,
      idempotencyKey: crypto.randomUUID(),
      generationSettings: { sourceType: "photo", multiElevation: true },
    });
    if (response.status !== 201) throw new Refused(((await response.json()) as { code: string }).code);
    onAccepted();
    return response.status;
  };
}

describe("Generate with more elevations than the plan runs at once", () => {
  it("renders every elevation, a few at a time, as earlier ones finish", async () => {
    const { user, project } = await setup(2);
    let inFlight = 0;
    let peak = 0;

    // Renders finish in the background; the Studio learns of it when its jobs refresh.
    const finisher = setInterval(async () => {
      const running = await db.select({ id: schema.renders.id }).from(schema.renders).where(eq(schema.renders.status, "processing"));
      if (running.length === 0) return;
      await db.update(schema.renders).set({ status: "succeeded" }).where(inArray(schema.renders.id, running.map((row) => row.id)));
      inFlight -= running.length;
    }, 40);

    const tasks = ["front", "right", "back", "left"].map((view) =>
      createRender(project.id, view, () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
      }),
    );
    const results = await runThrottled(tasks, {
      freeSlots: () => 2 - inFlight,
      waitForChange: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 30))),
      isBusy: (error) => error instanceof Refused && error.code === "concurrency_limit_reached",
      isFatal: (error) => error instanceof Refused && error.code !== "concurrency_limit_reached",
      busyCooldownMs: 20,
    });
    clearInterval(finisher);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    expect(peak).toBeLessThanOrEqual(2);
    const rows = await db.select().from(schema.renders).where(eq(schema.renders.projectId, project.id));
    expect(rows.map((row) => row.viewKey).sort()).toEqual(["back", "front", "left", "right"]);
    expect(await balanceOf(user.id)).toBe(16);
  });

  it("without the queue, the same Generate on a one-at-a-time plan only gets its first render", async () => {
    const { user, project } = await setup(1);
    const results = await Promise.allSettled(["front", "right", "back", "left"].map((view) => createRender(project.id, view, () => {})()));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected").map((result) => (result as PromiseRejectedResult).reason.code)).toEqual([
      "concurrency_limit_reached",
      "concurrency_limit_reached",
      "concurrency_limit_reached",
    ]);
    expect(await balanceOf(user.id)).toBe(19);
  });

  it("stops the line, charging nothing more, when the credits run out", async () => {
    const { user, project } = await setup(1, 2);
    let inFlight = 0;
    const finisher = setInterval(async () => {
      await db.update(schema.renders).set({ status: "succeeded" }).where(eq(schema.renders.status, "processing"));
      inFlight = 0;
    }, 40);

    const tasks = ["front", "right", "back", "left"].map((view) => createRender(project.id, view, () => (inFlight += 1)));
    const results = await runThrottled(tasks, {
      freeSlots: () => 1 - inFlight,
      waitForChange: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 30))),
      isBusy: (error) => error instanceof Refused && error.code === "concurrency_limit_reached",
      isFatal: (error) => error instanceof Refused && error.code !== "concurrency_limit_reached",
      busyCooldownMs: 20,
    });
    clearInterval(finisher);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected", "rejected"]);
    expect((results[2] as PromiseRejectedResult).reason.code).toBe("insufficient_credits");
    expect(await balanceOf(user.id)).toBe(0);
    expect(await db.select().from(schema.renders)).toHaveLength(2);
  });
});
