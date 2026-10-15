import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { describe, expect, it, vi } from "vitest";
import { grantBetaCredits } from "../src/lib/beta.js";
import { runBetaHousekeeping } from "../src/lib/betaHousekeeping.js";
import { ago, DAY } from "./support/admin.js";
import { bucketsOf, db, enroll, makeBetaProgram, makeUser, testEnv } from "./support/db.js";

// The daily beta sweep: testers who never come back still have their enrollment closed and beta
// credits expired, and screenshots go 90 days after their report is closed.
const deleted = vi.hoisted(() => [] as string[]);
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return { ...actual, deleteObject: vi.fn(async (_env: unknown, key: string) => void deleted.push(key)) };
});

async function testerIn(program: typeof schema.betaPrograms.$inferSelect, credits = 25) {
  const user = await makeUser({ creditBalance: 3 });
  const enrollment = await enroll(program.id, user.id);
  await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: credits, note: "welcome", idempotencyKey: enrollment.id });
  return { user, enrollment };
}

describe("the daily beta sweep", () => {
  it("completes testers past their end and expires their credits, leaving running and extended ones", async () => {
    const ended = await makeBetaProgram({ startsAt: ago(30 * DAY), endsAt: ago(DAY) });
    const running = await makeBetaProgram();
    const gone = await testerIn(ended);
    const extended = await testerIn(ended);
    await db.update(schema.betaEnrollments).set({ endsAt: new Date(Date.now() + 3 * DAY) }).where(eq(schema.betaEnrollments.id, extended.enrollment.id));
    const current = await testerIn(running);

    const result = await runBetaHousekeeping(testEnv(), db);

    expect(result.completed).toBe(1);
    expect(await bucketsOf(gone.user.id)).toEqual({ balance: 3, plan: 0, beta: 0 });
    expect((await bucketsOf(extended.user.id)).beta).toBe(25);
    expect((await bucketsOf(current.user.id)).beta).toBe(25);
    expect(await runBetaHousekeeping(testEnv(), db)).toEqual({ completed: 0, creditsExpired: 0, attachmentsDeleted: 0 });
  });

  it("expires beta credits left without a live enrollment", async () => {
    const program = await makeBetaProgram();
    const { user, enrollment } = await testerIn(program, 10);
    await db.update(schema.betaEnrollments).set({ status: "revoked" }).where(eq(schema.betaEnrollments.id, enrollment.id));

    expect((await runBetaHousekeeping(testEnv(), db)).creditsExpired).toBe(10);
    expect(await bucketsOf(user.id)).toEqual({ balance: 3, plan: 0, beta: 0 });
  });

  it("deletes screenshots of reports closed over 90 days ago, keeping the reports", async () => {
    const program = await makeBetaProgram();
    const { user, enrollment } = await testerIn(program);
    const base = { programId: program.id, enrollmentId: enrollment.id, userId: user.id, kind: "bug" as const, category: "other" as const };
    const [old] = await db.insert(schema.betaFeedback).values({ ...base, title: "Old", status: "resolved", resolvedAt: ago(91 * DAY), attachmentKey: "feedback/p/old.webp" }).returning();
    await db.insert(schema.betaFeedback).values([
      { ...base, title: "Recent", status: "declined", resolvedAt: ago(10 * DAY), attachmentKey: "feedback/p/recent.webp" },
      { ...base, title: "Open", status: "investigating", attachmentKey: "feedback/p/open.webp" },
    ]);
    deleted.length = 0;

    const result = await runBetaHousekeeping(testEnv(), db);

    expect(result.attachmentsDeleted).toBe(1);
    expect(deleted).toEqual(["feedback/p/old.webp"]);
    const [after] = await db.select().from(schema.betaFeedback).where(eq(schema.betaFeedback.id, old!.id));
    expect(after).toMatchObject({ title: "Old", attachmentKey: null });
  });
});
