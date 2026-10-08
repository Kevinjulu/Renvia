import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it } from "vitest";
import {
  createChargedRender,
  createChargedSegmentation,
  InsufficientCreditsError,
  refundIfFailed,
  refundSegmentationIfNeeded,
} from "../src/lib/credits.js";
import { balanceOf, db, ledgerFor, makeProject, makeRender, makeSegmentation, makeUser } from "./support/db.js";

const renderValues = (projectId: string) => ({
  projectId,
  sourceImageUrl: "https://example.test/source.png",
  prompt: "a house",
});

async function setup(credits: number) {
  const user = await makeUser({ creditBalance: credits });
  const project = await makeProject(user.id);
  return { user, project };
}

describe("createChargedRender", () => {
  it("debits the balance and records the render and ledger entry together", async () => {
    const { user, project } = await setup(10);
    const render = await createChargedRender(db, user.id, 3, renderValues(project.id));

    expect(render.creditsCharged).toBe(3);
    expect(await balanceOf(user.id)).toBe(7);
    const ledger = await ledgerFor(user.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: -3, reason: "render", renderId: render.id });
  });

  it("allows spending the exact remaining balance", async () => {
    const { user, project } = await setup(2);
    await createChargedRender(db, user.id, 2, renderValues(project.id));
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("rejects an unaffordable render and leaves no trace", async () => {
    const { user, project } = await setup(1);

    await expect(createChargedRender(db, user.id, 2, renderValues(project.id))).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );

    expect(await balanceOf(user.id)).toBe(1);
    expect(await db.select().from(schema.renders)).toHaveLength(0);
    expect(await ledgerFor(user.id)).toHaveLength(0);
  });

  it("never lets concurrent submissions overspend the balance", async () => {
    const { user, project } = await setup(3);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createChargedRender(db, user.id, 1, renderValues(project.id))),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InsufficientCreditsError);
    expect(await balanceOf(user.id)).toBe(0);
    expect(await db.select().from(schema.renders)).toHaveLength(3);
    expect(await ledgerFor(user.id)).toHaveLength(3);
  });

  it("creates a free render without touching the balance or ledger", async () => {
    const { user, project } = await setup(5);
    const render = await createChargedRender(db, user.id, 0, renderValues(project.id));

    expect(render.creditsCharged).toBe(0);
    expect(await balanceOf(user.id)).toBe(5);
    expect(await ledgerFor(user.id)).toHaveLength(0);
  });
});

describe("refundIfFailed", () => {
  async function failedRender(credits = 2) {
    const { user, project } = await setup(10);
    const created = await createChargedRender(db, user.id, credits, renderValues(project.id));
    const [failed] = await db
      .update(schema.renders)
      .set({ status: "failed" })
      .where(eq(schema.renders.id, created.id))
      .returning();
    return { user, render: failed! };
  }

  it("returns the charged credits and records a refund", async () => {
    const { user, render } = await failedRender(2);
    expect(await balanceOf(user.id)).toBe(8);

    await refundIfFailed(db, render);

    expect(await balanceOf(user.id)).toBe(10);
    const refunds = (await ledgerFor(user.id)).filter((l) => l.reason === "render_refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 2, renderId: render.id });
  });

  it("refunds only once when called repeatedly", async () => {
    const { user, render } = await failedRender(2);

    await refundIfFailed(db, render);
    await refundIfFailed(db, render);

    expect(await balanceOf(user.id)).toBe(10);
    expect((await ledgerFor(user.id)).filter((l) => l.reason === "render_refund")).toHaveLength(1);
  });

  it("refunds only once when a poll and the webhook race", async () => {
    const { user, render } = await failedRender(2);

    await Promise.all(Array.from({ length: 5 }, () => refundIfFailed(db, render)));

    expect(await balanceOf(user.id)).toBe(10);
    expect((await ledgerFor(user.id)).filter((l) => l.reason === "render_refund")).toHaveLength(1);
  });

  it("does not refund a render that has not failed", async () => {
    const { user, project } = await setup(10);
    const render = await createChargedRender(db, user.id, 2, renderValues(project.id));

    await refundIfFailed(db, { ...render, status: "processing" });
    await refundIfFailed(db, { ...render, status: "succeeded" });

    expect(await balanceOf(user.id)).toBe(8);
  });

  it("does not refund a render that was never charged", async () => {
    const { user, project } = await setup(10);
    const render = await makeRender(project.id, { status: "failed", creditsCharged: 0 });

    await refundIfFailed(db, render);

    expect(await balanceOf(user.id)).toBe(10);
    expect(await ledgerFor(user.id)).toHaveLength(0);
  });
});

describe("segmentations", () => {
  const values = { imageUrl: "https://example.test/source.png", model: "mock" };

  it("charges credits and records a segment ledger entry", async () => {
    const user = await makeUser({ creditBalance: 4 });
    const segmentation = await createChargedSegmentation(db, user.id, 1, values);

    expect(await balanceOf(user.id)).toBe(3);
    expect((await ledgerFor(user.id))[0]).toMatchObject({ amount: -1, reason: "segment", segmentationId: segmentation.id });
  });

  it("rejects an unaffordable selection", async () => {
    const user = await makeUser({ creditBalance: 0 });
    await expect(createChargedSegmentation(db, user.id, 1, values)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await db.select().from(schema.segmentations)).toHaveLength(0);
  });

  it("refunds a failed selection exactly once", async () => {
    const user = await makeUser({ creditBalance: 4 });
    const created = await createChargedSegmentation(db, user.id, 1, values);
    const failed = { ...created, status: "failed" as const };

    await Promise.all([refundSegmentationIfNeeded(db, failed), refundSegmentationIfNeeded(db, failed)]);
    await refundSegmentationIfNeeded(db, failed);

    expect(await balanceOf(user.id)).toBe(4);
    expect((await ledgerFor(user.id)).filter((l) => l.reason === "segment_refund")).toHaveLength(1);
  });

  it("refunds a successful selection that found nothing, but not one that found objects", async () => {
    const user = await makeUser({ creditBalance: 4 });
    const empty = await createChargedSegmentation(db, user.id, 1, values);
    const found = await createChargedSegmentation(db, user.id, 1, values);
    expect(await balanceOf(user.id)).toBe(2);

    await refundSegmentationIfNeeded(db, { ...found, status: "succeeded", objectCount: 3 });
    expect(await balanceOf(user.id)).toBe(2);

    await refundSegmentationIfNeeded(db, { ...empty, status: "succeeded", objectCount: 0 });
    expect(await balanceOf(user.id)).toBe(3);
  });

  it("does not refund an uncharged selection", async () => {
    const user = await makeUser({ creditBalance: 4 });
    const segmentation = await makeSegmentation(user.id, { status: "failed", creditsCharged: 0 });
    await refundSegmentationIfNeeded(db, segmentation);
    expect(await balanceOf(user.id)).toBe(4);
  });
});
