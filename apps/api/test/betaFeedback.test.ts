import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "@renvia/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBetaFeedbackDetail, AdminBetaFeedbackListResponse, BetaFeedbackDetail, BetaMeResponse } from "@renvia/types";
import root from "../src/index.js";
import { adminEnv, callAdmin } from "./support/admin.js";
import { callApi } from "./support/api.js";
import { db, enroll, makeBetaProgram, makeProject, makeRender, makeUser } from "./support/db.js";

// Beta feedback: reports about a tester's own renders with marks and diagnostics from Renvia's
// records, private compressed screenshots within quotas, threads with the team, known issues and
// duplicates — and testers only ever seeing their own reports.
vi.mock("@clerk/backend", async () => (await import("./support/clerkStub.js")).clerkStub());

const stored = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../src/lib/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/storage.js")>("../src/lib/storage.js");
  return { ...actual, putObject: vi.fn(async (_env: unknown, key: string, body: ArrayBuffer) => void stored.set(key, new Uint8Array(body))) };
});

let programId: string;
let renderId: string;

beforeEach(async () => {
  stored.clear();
  await db.insert(schema.billingPlans).values({ slug: "starter", name: "Starter", description: "Free" });
  await makeUser({ clerkId: "admin", email: "admin@renvia.test", role: "admin" });
  await makeUser({ clerkId: "support", email: "support@renvia.test", role: "support" });
  await makeUser({ clerkId: "analyst", email: "analyst@renvia.test", role: "analyst" });
  const program = await makeBetaProgram();
  programId = program.id;
  for (const name of ["alice", "bob"]) {
    const user = await makeUser({ clerkId: name, email: `${name}@example.test` });
    await enroll(program.id, user.id);
    if (name === "alice") {
      const project = await makeProject(user.id);
      const render = await makeRender(project.id, { status: "failed", model: "fal-ai/flux-pro/kontext", errorMessage: "Provider timed out", costMicros: 0, creditsCharged: 1 });
      renderId = render.id;
      // The renders trigger has already recorded "created".
      await db.insert(schema.renderJobEvents).values({ renderId: render.id, eventType: "failed", stage: "render" });
    }
  }
});

const report = (clerkId: string, body: Record<string, unknown>) => callApi(clerkId, "POST", "/beta/feedback", { kind: "visual_quality", category: "architecture_changed", title: "Roof changed", ...body });
const fileReport = async (clerkId = "alice", body: Record<string, unknown> = {}) => {
  const res = await report(clerkId, body);
  expect(res.status).toBe(201);
  return (await res.json()) as BetaFeedbackDetail;
};
const pin = { v: 1, image: "result", pins: [{ x: 0.6241, y: 0.318, label: "Roof" }], boxes: [], strokes: [] };

function attach(clerkId: string, id: string, bytes: Uint8Array, contentType = "image/png") {
  return root.request(`http://localhost/api/beta/feedback/${id}/attachment`, { method: "POST", headers: { Authorization: `Bearer ${clerkId}`, "Content-Type": contentType }, body: new Blob([new Uint8Array(bytes)]) }, adminEnv);
}
const png = async (size: number) => new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: "#4477aa" } }).png().toBuffer());
const adminDetail = async (id: string) => (await (await callAdmin("admin", "GET", `/beta/feedback/${id}`)).json()) as AdminBetaFeedbackDetail;
const testerDetail = async (clerkId: string, id: string) => (await (await callApi(clerkId, "GET", `/beta/feedback/${id}`)).json()) as BetaFeedbackDetail;

describe("filing a report", () => {
  it("about one of the tester's renders, with diagnostics from Renvia's own records", async () => {
    const created = await fileReport("alice", { renderId, annotations: pin, appVersion: "d456517", requestId: "req-123" });

    expect(created).toMatchObject({ title: "Roof changed", status: "new", renderId, annotations: { pins: [{ x: 0.624, y: 0.318, label: "Roof" }] } });
    const detail = await adminDetail(created.id);
    expect(detail.diagnostics).toMatchObject({
      render: { status: "failed", model: "fal-ai/flux-pro/kontext", errorMessage: "Provider timed out", creditsCharged: 1 },
      events: [{ type: "created" }, { type: "failed" }],
      client: { appVersion: "d456517", requestId: "req-123" },
    });
    expect(JSON.stringify(detail.diagnostics)).not.toContain("signature");
    expect(detail.testerEmail).toBe("alice@example.test");
  });

  it("can't be about someone else's render, and needs a render for marks", async () => {
    expect((await report("bob", { renderId })).status).toBe(404);
    expect((await report("bob", { annotations: pin })).status).toBe(400);
  });

  it("keeps marks within their limits", async () => {
    const pins = Array.from({ length: 11 }, () => ({ x: 0.5, y: 0.5 }));
    expect((await report("alice", { renderId, annotations: { ...pin, pins } })).status).toBe(400);
    expect((await report("alice", { renderId, annotations: { ...pin, pins: [{ x: 1.4, y: 0.5 }] } })).status).toBe(400);
  });

  it("is for testers only", async () => {
    await makeUser({ clerkId: "outsider", email: "outsider@example.test" });
    expect((await report("outsider", {})).status).toBe(403);
  });

  it("counts toward a feedback mission", async () => {
    await callAdmin("admin", "POST", `/beta/programs/${programId}/missions`, { title: "Report one problem", rule: { kind: "feedback_submitted", count: 1 } });
    await fileReport();

    const me = (await (await callApi("alice", "GET", "/beta/me")).json()) as BetaMeResponse;
    expect(me.tester!.missions[0]!.completedAt).not.toBeNull();
  });
});

describe("privacy between testers", () => {
  it("lets a tester see only their own reports", async () => {
    const mine = await fileReport("alice");

    expect((await callApi("bob", "GET", `/beta/feedback/${mine.id}`)).status).toBe(404);
    expect((await callApi("bob", "POST", `/beta/feedback/${mine.id}/comments`, { body: "hi" })).status).toBe(404);
    const list = (await (await callApi("bob", "GET", "/beta/feedback")).json()) as { feedback: unknown[] };
    expect(list.feedback).toHaveLength(0);
  });
});

describe("screenshots", () => {
  it("are compressed to a private WebP, one per report", async () => {
    const created = await fileReport();

    const res = await attach("alice", created.id, await png(3000));

    expect(res.status).toBe(200);
    const [key] = [...stored.keys()];
    expect(key).toBe(`feedback/${programId}/${created.id}.webp`);
    const meta = await sharp(Buffer.from(stored.get(key!)!)).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 2048 });
    expect(stored.get(key!)!.byteLength).toBeLessThanOrEqual(1_000_000);
    expect(((await res.json()) as BetaFeedbackDetail).attachmentUrl).toMatch(/signature=/);
    expect((await attach("alice", created.id, await png(10))).status).toBe(409);
  });

  it("refuse other files, oversized files and other people's reports", async () => {
    const created = await fileReport();
    expect((await attach("alice", created.id, new Uint8Array([1, 2, 3]), "application/pdf")).status).toBe(400);
    expect((await attach("alice", created.id, new Uint8Array(6 * 1024 * 1024))).status).toBe(413);
    expect((await attach("alice", created.id, new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await attach("bob", created.id, await png(10))).status).toBe(404);
  });

  it("stop at the program's storage allowance and the tester's quota, keeping the report", async () => {
    const created = await fileReport();
    await db.update(schema.betaPrograms).set({ attachmentBudgetMb: 0 }).where(eq(schema.betaPrograms.id, programId));
    const full = await attach("alice", created.id, await png(10));
    expect(full.status).toBe(409);
    expect(((await full.json()) as { code: string }).code).toBe("attachment_budget");

    await db.update(schema.betaPrograms).set({ attachmentBudgetMb: 500 }).where(eq(schema.betaPrograms.id, programId));
    const [enrollment] = await db.select().from(schema.betaEnrollments).where(eq(schema.betaEnrollments.id, (await db.select().from(schema.betaFeedback))[0]!.enrollmentId));
    await db.insert(schema.betaFeedback).values(Array.from({ length: 20 }, (_, i) => ({ programId, enrollmentId: enrollment!.id, userId: enrollment!.userId, kind: "bug" as const, category: "other" as const, title: `Old ${i}`, attachmentKey: `feedback/${programId}/old-${i}.webp` })));
    expect(((await (await attach("alice", created.id, await png(10))).json()) as { code: string }).code).toBe("attachment_limit");
    expect((await testerDetail("alice", created.id)).title).toBe("Roof changed");
  });
});

describe("the thread", () => {
  it("shows replies but never internal notes, and marks a question as waiting on the tester", async () => {
    const created = await fileReport();
    await callAdmin("support", "POST", `/beta/feedback/${created.id}/comments`, { body: "Checking the model logs", visibility: "internal" });
    await callAdmin("support", "POST", `/beta/feedback/${created.id}/request-info`, { body: "Which elevation was it?" });

    let seen = await testerDetail("alice", created.id);
    expect(seen.comments.map((comment) => comment.body)).toEqual(["Which elevation was it?"]);
    expect(seen).toMatchObject({ status: "investigating", awaitingTester: true });
    expect(((await (await callApi("alice", "GET", "/beta/me")).json()) as BetaMeResponse).tester!.unreadReplies).toBe(1);

    await callApi("alice", "POST", `/beta/feedback/${created.id}/comments`, { body: "The front one" });
    await callApi("alice", "POST", "/beta/me/replies-seen");
    seen = await testerDetail("alice", created.id);
    expect(seen.awaitingTester).toBe(false);
    expect(((await (await callApi("alice", "GET", "/beta/me")).json()) as BetaMeResponse).tester!.unreadReplies).toBe(0);
    expect((await adminDetail(created.id)).comments.map((comment) => comment.visibility)).toEqual(["internal", "tester", "tester"]);
  });

  it("asks the tester to confirm a fix, and reopens it when it isn't fixed", async () => {
    const first = await fileReport();
    const second = await fileReport();
    for (const { id } of [first, second]) {
      expect((await callAdmin("support", "PATCH", `/beta/feedback/${id}`, { status: "ready_to_verify", severity: "high" })).status).toBe(200);
    }

    const fixed = (await (await callApi("alice", "POST", `/beta/feedback/${first.id}/confirm-fix`, { fixed: true })).json()) as BetaFeedbackDetail;
    const notFixed = (await (await callApi("alice", "POST", `/beta/feedback/${second.id}/confirm-fix`, { fixed: false, comment: "Still on the back elevation" })).json()) as BetaFeedbackDetail;

    expect(fixed.status).toBe("resolved");
    expect((await adminDetail(first.id)).resolvedAt).not.toBeNull();
    expect(notFixed.status).toBe("triaged");
    expect(notFixed.comments.at(-1)!.body).toBe("Still on the back elevation");
    expect((await callApi("alice", "POST", `/beta/feedback/${first.id}/confirm-fix`, { fixed: true })).status).toBe(409);
  });

  it("is managed by support and admins; analysts only read", async () => {
    const created = await fileReport();
    expect((await callAdmin("analyst", "GET", "/beta/feedback")).status).toBe(200);
    expect((await callAdmin("analyst", "PATCH", `/beta/feedback/${created.id}`, { status: "triaged" })).status).toBe(403);
    expect((await callAdmin("support", "PATCH", `/beta/feedback/${created.id}`, { assigneeId: (await db.select().from(schema.users).where(eq(schema.users.clerkId, "alice")))[0]!.id })).status).toBe(400);

    const list = (await (await callAdmin("admin", "GET", `/beta/feedback?programId=${programId}&status=new`)).json()) as AdminBetaFeedbackListResponse;
    expect(list.feedback.map((row) => row.id)).toEqual([created.id]);
    expect(list.counts).toEqual({ new: 1 });
  });
});

describe("known issues and duplicates", () => {
  it("let other testers say they have it too, once each", async () => {
    const created = await fileReport("alice");
    await callAdmin("support", "PATCH", `/beta/feedback/${created.id}`, { knownIssue: true, knownIssueTitle: "Roof pitch drifts on hipped roofs", status: "fix_in_progress" });

    const { issues } = (await (await callApi("bob", "GET", "/beta/known-issues?category=architecture_changed")).json()) as { issues: { id: string; title: string; plusOnes: number; mine: boolean }[] };
    expect(issues).toEqual([expect.objectContaining({ id: created.id, title: "Roof pitch drifts on hipped roofs", plusOnes: 0, mine: false })]);

    await callApi("bob", "POST", `/beta/feedback/${created.id}/plus-one`);
    const again = await callApi("bob", "POST", `/beta/feedback/${created.id}/plus-one`);
    expect(await again.json()).toMatchObject({ alreadyCounted: true });
    expect((await callApi("alice", "POST", `/beta/feedback/${created.id}/plus-one`)).status).toBe(404);
    expect((await adminDetail(created.id)).plusOnes).toBe(1);
    const after = (await (await callApi("bob", "GET", "/beta/known-issues")).json()) as { issues: { plusOnes: number; mine: boolean }[] };
    expect(after.issues[0]).toMatchObject({ plusOnes: 1, mine: true });
  });

  it("merge a duplicate into the original, telling the tester and counting them there", async () => {
    const original = await fileReport("alice");
    const copy = await fileReport("bob");

    const res = await callAdmin("support", "POST", `/beta/feedback/${copy.id}/duplicate`, { of: original.id });

    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminBetaFeedbackDetail).duplicateOf).toMatchObject({ id: original.id, number: original.number });
    expect((await testerDetail("bob", copy.id)).status).toBe("duplicate");
    expect((await adminDetail(original.id)).duplicates).toBe(1);
    expect((await adminDetail(original.id)).plusOnes).toBe(1);
    expect((await callAdmin("support", "POST", `/beta/feedback/${original.id}/duplicate`, { of: original.id })).status).toBe(400);
  });
});
