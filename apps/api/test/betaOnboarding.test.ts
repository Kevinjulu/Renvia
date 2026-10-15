import { eq } from "drizzle-orm";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBetaProgramDetailResponse, BetaMeResponse, BetaTester } from "@renvia/types";
import { grantBetaCredits } from "../src/lib/beta.js";
import { ago, callAdmin, DAY } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { bucketsOf, db, enroll, makeBetaProgram, makeProject, makeRender, makeSegmentation, makeUser } from "./support/db.js";

// The tester's side of the program: what /beta/me reports, missions verified from what they
// actually did (never from tracking), onboarding remembered on the server, and announcements.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

beforeEach(async () => {
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Free" });
  await db.insert(schema.governanceSettings).values({ id: 1, bulkCreditApprovalThreshold: 0, roleChangeApprovalThreshold: 0, refundApprovalThresholdCents: 0, maintenanceApprovalThreshold: 0, studioChangeApprovalThreshold: 0 });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  await makeUser({ clerkId: "support", email: "support@renvia.test", role: "support" });
});

async function tester(programOverrides: Partial<typeof schema.betaPrograms.$inferInsert> = {}) {
  const program = await makeBetaProgram({ name: "Renvia Private Beta", ...programOverrides });
  const user = await makeUser({ clerkId: "tester", email: "tester@example.test", creditBalance: 4 });
  const enrollment = await enroll(program.id, user.id, { enrolledAt: ago(DAY) });
  await grantBetaCredits(db, { enrollmentId: enrollment.id, amount: 25, note: "welcome", idempotencyKey: "w" });
  return { program, user, enrollment };
}

const betaMe = async (clerkId = "tester") => (await (await callApi(clerkId, "GET", "/beta/me")).json()) as BetaMeResponse;
const me = async () => (await betaMe()).tester as BetaTester;
const mission = (programId: string, body: Record<string, unknown>) => callAdmin("admin", "POST", `/beta/programs/${programId}/missions`, body);

describe("/beta/me", () => {
  it("reports the tester's program, credits and dates", async () => {
    const { program } = await tester();

    const response = await me();

    expect(response).toMatchObject({
      status: "active",
      running: true,
      program: { id: program.id, name: "Renvia Private Beta", downloadsUnlocked: true },
      credits: { remaining: 25, granted: 25 },
      welcomeSeenAt: null,
      tourCompletedAt: null,
      missions: [],
      announcements: [],
    });
    expect(response.endsAt).toBe(program.endsAt.toISOString());
  });

  it("is empty for someone outside the program, apart from invitations addressed to them", async () => {
    const program = await makeBetaProgram();
    const customer = await makeUser({ clerkId: "customer", email: "customer@example.test" });
    await callAdmin("admin", "POST", `/beta/programs/${program.id}/invitations`, { kind: "existing_user", userId: customer.id });

    const response = await betaMe("customer");

    expect(response.tester).toBeNull();
    expect(response.invitations).toHaveLength(1);
    expect(response.invitations[0]).toMatchObject({ programName: program.name, credits: 25 });
  });

  it("closes an enrollment past its end and expires its credits", async () => {
    const { user } = await tester({ startsAt: ago(30 * DAY), endsAt: ago(DAY) });

    expect((await betaMe()).tester).toBeNull();
    expect(await bucketsOf(user.id)).toEqual({ balance: 4, plan: 0, beta: 0 });
  });
});

describe("missions", () => {
  it("verify themselves from finished work since enrolling, counting only what qualifies", async () => {
    const { program, user } = await tester();
    const project = await makeProject(user.id);
    expect((await mission(program.id, { title: "Render two references", rule: { kind: "render_succeeded", jobTypes: ["references"], count: 2 }, position: 1 })).status).toBe(201);
    await mission(program.id, { title: "Select something", rule: { kind: "selection_succeeded", count: 1 }, position: 2 });

    // Before enrolling, failed, or the wrong kind: none of these count.
    await makeRender(project.id, { status: "succeeded", settings: { referenceImageUrls: ["https://example.test/r.png"] }, createdAt: ago(3 * DAY) });
    await makeRender(project.id, { status: "failed", settings: { referenceImageUrls: ["https://example.test/r.png"] } });
    await makeRender(project.id, { status: "succeeded", settings: { sourceType: "photo" } });
    await makeRender(project.id, { status: "succeeded", settings: { referenceImageUrls: ["https://example.test/r.png"] } });
    await makeSegmentation(user.id, { status: "succeeded", objectCount: 0 });

    let [renders, selections] = (await me()).missions;
    expect(renders).toMatchObject({ title: "Render two references", count: 1, target: 2, completedAt: null });
    expect(selections).toMatchObject({ count: 0, completedAt: null });

    await makeRender(project.id, { status: "succeeded", settings: { referenceImageUrls: ["https://example.test/r.png"] } });
    await makeSegmentation(user.id, { status: "succeeded", objectCount: 3 });
    [renders, selections] = (await me()).missions;

    expect(renders!.completedAt).not.toBeNull();
    expect(selections!.completedAt).not.toBeNull();
    const progress = await db.select().from(schema.betaMissionProgress);
    expect(progress.map((row) => row.source)).toEqual(["auto", "auto"]);
  });

  it("stay complete once recorded", async () => {
    const { program, user } = await tester();
    const project = await makeProject(user.id);
    await mission(program.id, { title: "One render", rule: { kind: "render_succeeded", count: 1 } });
    const render = await makeRender(project.id, { status: "succeeded" });
    expect((await me()).missions[0]!.completedAt).not.toBeNull();

    await db.update(schema.renders).set({ hiddenAt: new Date(), status: "failed" }).where(eq(schema.renders.id, render.id));

    expect((await me()).missions[0]!.completedAt).not.toBeNull();
  });

  it("can be ticked by the tester only when they are manual", async () => {
    const { program } = await tester();
    await mission(program.id, { title: "Try the edit tools", rule: { kind: "manual" } });
    await mission(program.id, { title: "One render", rule: { kind: "render_succeeded", count: 1 } });
    const [manual, verified] = (await me()).missions;

    expect((await callApi("tester", "POST", `/beta/missions/${verified!.id}/complete`)).status).toBe(409);
    const res = await callApi("tester", "POST", `/beta/missions/${manual!.id}/complete`);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { missions: BetaTester["missions"] }).missions[0]!.completedAt).not.toBeNull();
    const [row] = await db.select().from(schema.betaMissionProgress);
    expect(row!.source).toBe("tester");
  });

  it("are configured by admins, validated, shown with their completions, and audited", async () => {
    const { program } = await tester();

    expect((await callAdmin("support", "POST", `/beta/programs/${program.id}/missions`, { title: "x", rule: { kind: "manual" } })).status).toBe(403);
    expect((await mission(program.id, { title: "Bad", rule: { kind: "render_succeeded", count: 0 } })).status).toBe(400);
    const created = (await (await mission(program.id, { title: "Manual", rule: { kind: "manual" } })).json()) as { id: string };
    await callApi("tester", "POST", `/beta/missions/${created.id}/complete`);

    const detail = (await (await callAdmin("admin", "GET", `/beta/programs/${program.id}`)).json()) as AdminBetaProgramDetailResponse;
    expect(detail.missions).toEqual([expect.objectContaining({ id: created.id, title: "Manual", completions: 1 })]);

    expect((await callAdmin("admin", "PATCH", `/beta/missions/${created.id}`, { title: "Renamed" })).status).toBe(200);
    expect((await callAdmin("admin", "DELETE", `/beta/missions/${created.id}`)).status).toBe(200);
    const events = await db.select().from(schema.adminEvents).where(eq(schema.adminEvents.targetType, "beta_mission"));
    expect(events).toHaveLength(3);
  });
});

describe("onboarding", () => {
  it("remembers the welcome and the tour on the server, keeping the first time", async () => {
    await tester();

    expect((await callApi("tester", "POST", "/beta/me/welcome-seen")).status).toBe(200);
    const first = (await me()).welcomeSeenAt;
    await callApi("tester", "POST", "/beta/me/welcome-seen");
    await callApi("tester", "POST", "/beta/me/tour-complete");

    const after = await me();
    expect(after.welcomeSeenAt).toBe(first);
    expect(after.tourCompletedAt).not.toBeNull();
  });

  it("has nothing to record for someone outside the program", async () => {
    await makeUser({ clerkId: "outsider", email: "outsider@example.test" });

    expect((await callApi("outsider", "POST", "/beta/me/welcome-seen")).status).toBe(404);
  });
});

describe("announcements", () => {
  it("show published, unexpired ones as unread until the tester has read them", async () => {
    const { program } = await tester();
    const post = (body: Record<string, unknown>) => callAdmin("support", "POST", `/beta/programs/${program.id}/announcements`, body);
    expect((await post({ title: "Welcome, testers", body: "Thanks for joining.", severity: "important" })).status).toBe(201);
    await post({ title: "Old news", expiresAt: ago(1000).toISOString() });

    const before = await me();
    expect(before.announcements.map((announcement) => announcement.title)).toEqual(["Welcome, testers"]);
    expect(before.unreadAnnouncements).toBe(1);

    await callApi("tester", "POST", "/beta/me/announcements-seen");
    expect((await me()).unreadAnnouncements).toBe(0);
  });

  it("can be withdrawn", async () => {
    const { program } = await tester();
    const created = (await (await callAdmin("admin", "POST", `/beta/programs/${program.id}/announcements`, { title: "Typo" })).json()) as { id: string };

    expect((await callAdmin("admin", "DELETE", `/beta/announcements/${created.id}`)).status).toBe(200);
    expect((await me()).announcements).toHaveLength(0);
  });
});
