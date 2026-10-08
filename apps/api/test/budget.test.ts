import { sql } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it } from "vitest";
import { getBudget, releaseBudgetReservation, reserveBudget, wouldExceedBudget } from "../src/lib/engine.js";
import { db, makeProject, makeRender, makeSegmentation, makeUser, testEnv } from "./support/db.js";

const USD = 1_000_000; // micros per dollar

async function reservationCount() {
  return (await db.select().from(schema.budgetReservations)).length;
}

describe("reserveBudget", () => {
  it("lets free jobs through without taking a hold", async () => {
    expect(await reserveBudget(db, 0, 0)).toBe("free");
    expect(await reservationCount()).toBe(0);
  });

  it("grants a hold that fits under the cap", async () => {
    const id = await reserveBudget(db, 4 * USD, 10);
    expect(id).toEqual(expect.any(String));
    expect(await reservationCount()).toBe(1);
  });

  it("refuses a hold that would exceed the cap", async () => {
    expect(await reserveBudget(db, 11 * USD, 10)).toBeNull();
    expect(await reservationCount()).toBe(0);
  });

  it("allows a hold that lands exactly on the cap", async () => {
    expect(await reserveBudget(db, 10 * USD, 10)).not.toBeNull();
  });

  it("refuses everything when no budget is configured", async () => {
    expect(await reserveBudget(db, 1, 0)).toBeNull();
  });

  it("counts existing renders but ignores failed ones", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    await makeRender(project.id, { status: "succeeded", costMicros: 6 * USD });
    await makeRender(project.id, { status: "failed", costMicros: 100 * USD });

    expect(await reserveBudget(db, 5 * USD, 10)).toBeNull();
    expect(await reserveBudget(db, 4 * USD, 10)).not.toBeNull();
  });

  it("counts segmentations toward the cap, ignoring failed ones", async () => {
    const user = await makeUser();
    await makeSegmentation(user.id, { status: "succeeded", costMicros: 7 * USD });
    await makeSegmentation(user.id, { status: "failed", costMicros: 100 * USD });

    expect(await reserveBudget(db, 4 * USD, 10)).toBeNull();
    expect(await reserveBudget(db, 3 * USD, 10)).not.toBeNull();
  });

  it("counts open reservations toward the cap", async () => {
    expect(await reserveBudget(db, 6 * USD, 10)).not.toBeNull();
    expect(await reserveBudget(db, 5 * USD, 10)).toBeNull();
    expect(await reserveBudget(db, 4 * USD, 10)).not.toBeNull();
  });

  it("discards stale reservations instead of counting them", async () => {
    await db.execute(sql`
      insert into budget_reservations (id, cost_micros, created_at)
      values (gen_random_uuid(), ${9 * USD}, now() - interval '20 minutes')
    `);

    expect(await reserveBudget(db, 9 * USD, 10)).not.toBeNull();
    expect(await reservationCount()).toBe(1);
  });

  it("never grants more than the cap when requests arrive together", async () => {
    // Cap of $10 and $3 holds: only three can ever fit.
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveBudget(db, 3 * USD, 10)));

    expect(results.filter((id) => id !== null)).toHaveLength(3);
    expect(await reservationCount()).toBe(3);
  });
});

describe("releaseBudgetReservation", () => {
  it("frees the held amount", async () => {
    const id = await reserveBudget(db, 8 * USD, 10);
    expect(await reserveBudget(db, 8 * USD, 10)).toBeNull();

    await releaseBudgetReservation(db, id);

    expect(await reserveBudget(db, 8 * USD, 10)).not.toBeNull();
  });

  it("ignores null and free markers", async () => {
    await releaseBudgetReservation(db, null);
    await releaseBudgetReservation(db, "free");
    expect(await reservationCount()).toBe(0);
  });
});

describe("spend accounting", () => {
  it("handles cumulative spend beyond the 32-bit integer range", async () => {
    // Two jobs near the per-row integer limit: $4,000 in total, far above int4's ~$2,147.
    const user = await makeUser();
    const project = await makeProject(user.id);
    await makeRender(project.id, { status: "succeeded", costMicros: 2_000_000_000 });
    await makeRender(project.id, { status: "succeeded", costMicros: 2_000_000_000 });

    const budget = await getBudget(testEnv({ FAL_BUDGET_USD: "10000" }), db);
    expect(budget.spentUsd).toBe(4000);
  });

  it("combines render and segmentation spend", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    await makeRender(project.id, { status: "succeeded", costMicros: 3 * USD });
    await makeSegmentation(user.id, { status: "succeeded", costMicros: 2 * USD });
    await makeRender(project.id, { status: "failed", costMicros: 50 * USD });

    expect((await getBudget(testEnv({ FAL_BUDGET_USD: "100" }), db)).spentUsd).toBe(5);
  });

  it("reports whether another job would break the budget", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id);
    await makeRender(project.id, { status: "succeeded", costMicros: 8 * USD });
    const env = testEnv({ FAL_BUDGET_USD: "10" });

    expect(await wouldExceedBudget(env, db, 2 * USD)).toBe(false);
    expect(await wouldExceedBudget(env, db, 2 * USD + 1)).toBe(true);
    expect(await wouldExceedBudget(env, db, 0)).toBe(false);
  });
});
